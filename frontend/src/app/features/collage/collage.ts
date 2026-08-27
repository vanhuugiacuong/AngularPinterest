import { CommonModule } from '@angular/common';
import {
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { CollageCanvasComponent } from './components/collage-canvas/collage-canvas';
import { ImagePickerComponent } from './components/image-picker/image-picker';
import { LayerCropComponent, LayerCropRect } from './components/layer-crop/layer-crop';
import { LayerListComponent } from './components/layer-list/layer-list';
import { SubjectSelectorComponent } from './components/subject-selector/subject-selector';
import {
  COLLAGE_HEIGHT,
  COLLAGE_WIDTH,
  CollageImageLayer,
  CollageImageSource,
  DEFAULT_LAYER_CROP,
  SegmentationResult,
  isImageLayer,
} from './collage.types';
import { CollageDraftService } from './services/collage-draft.service';
import { CollageStoreService } from './services/collage-store.service';
import { CollageTransferService } from './services/collage-transfer.service';
import { SEGMENTATION_PROVIDER } from './services/segmentation-provider';
import { InteractiveSegmentationService } from './services/interactive-segmentation.service';
import { SELECTION_ENGINE, SMART_CUT_ENGINE } from './services/selection-engine';
import { RegionGrowingSelectionEngine } from './services/region-growing-selection-engine';
import { ToastService } from '../../core/services/toast';

@Component({
  selector: 'app-collage',
  standalone: true,
  imports: [
    CommonModule,
    Navbar,
    CollageCanvasComponent,
    LayerListComponent,
    ImagePickerComponent,
    SubjectSelectorComponent,
    LayerCropComponent,
  ],
  providers: [
    CollageStoreService,
    { provide: SEGMENTATION_PROVIDER, useExisting: InteractiveSegmentationService },
    { provide: SELECTION_ENGINE, useExisting: RegionGrowingSelectionEngine },
    { provide: SMART_CUT_ENGINE, useExisting: RegionGrowingSelectionEngine },
  ],
  templateUrl: './collage.html',
  styleUrl: './collage.css',
})
export class Collage implements OnInit, OnDestroy {
  @ViewChild(CollageCanvasComponent) private canvas?: CollageCanvasComponent;
  /** The picker owns file validation and the CollageImageSource shape, so the
   * canvas "add image" tool delegates to it instead of duplicating that. */
  @ViewChild(ImagePickerComponent) private picker?: ImagePickerComponent;

  /** Surfaced for the canvas hint and the ··· export label — the export size is
   * a real constraint worth showing, just not worth a permanent subtitle. */
  readonly collageWidth = COLLAGE_WIDTH;
  readonly collageHeight = COLLAGE_HEIGHT;

  readonly showOverflow = signal(false);

  readonly store = inject(CollageStoreService);
  private readonly draftService = inject(CollageDraftService);
  private readonly transferService = inject(CollageTransferService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly selectedSource = signal<CollageImageSource | null>(null);
  /** The layer currently open in the re-crop tool (null = tool closed).
   * Kept as the whole layer (not just its id) so the crop dialog's inputs
   * don't flicker if the layer briefly disappears from the store mid-edit.
   * Image-only by type: cropping a text or drawing layer is meaningless, and
   * the tool needs `cutoutImageUrl`. */
  readonly cropTarget = signal<CollageImageLayer | null>(null);
  readonly isSaving = signal(false);
  readonly isExporting = signal(false);
  /** Set once the draft has been written at least this session — drives the
   * "Đã lưu" state so the bar is empty (not falsely reassuring) before the
   * first save. */
  readonly savedAt = signal<number | null>(null);

  private autosaveTimer?: ReturnType<typeof setTimeout>;

  /** Autosave: the draft is written a beat after edits settle, so closing the
   * tab or hitting X never silently loses work. Debounced because a drag emits
   * a transform per frame and each save serialises every layer's blob.
   *
   * Deliberately skips the toast that manual saveDraft() shows — an autosave
   * firing a toast after every edit would bury the ones that matter. */
  private readonly autosaveEffect = effect(() => {
    const layers = this.store.layers();
    if (!layers.length) return;
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => void this.persistDraft(), 1200);
  });

  async ngOnInit(): Promise<void> {
    try {
      const layers = await this.draftService.load();
      if (layers?.length) {
        this.store.replaceAll(layers);
        this.showToast('Đã khôi phục bản nháp ảnh ghép gần nhất.');
      }
    } catch (error) {
      console.error('Unable to restore collage draft:', error);
      this.showToast('Không thể khôi phục bản nháp trên trình duyệt này.', 'error');
    }
  }

  ngOnDestroy(): void {
    // Không để autosave nổ sau khi component đã bị hủy — store lúc đó đã dọn
    // object URL, ghi tiếp là serialize dữ liệu đã giải phóng.
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveEffect.destroy();
    this.releaseSelectedSource(false);
    this.store.disposeObjectUrls();
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (
      target?.matches('input, textarea, select') ||
      target?.isContentEditable ||
      this.selectedSource()
    ) {
      return;
    }

    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.store.redo();
      else this.store.undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.store.redo();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.store.selectedId()) {
      event.preventDefault();
      this.store.remove();
    }
  }

  toggleOverflow(event: Event): void {
    event.stopPropagation();
    this.showOverflow.update((open) => !open);
  }

  /** Bấm ra ngoài / Escape thì đóng menu ···. Escape khi menu đóng vẫn để
   * nguyên cho các modal bên dưới xử lý. */
  @HostListener('document:click')
  closeOverflow(): void {
    if (this.showOverflow()) this.showOverflow.set(false);
  }

  /** Thoát editor. Nếu đang có layer thì lưu nháp trước, để người dùng bấm X
   * không mất việc đang làm — nháp sẽ được khôi phục ở ngOnInit lần sau. */
  async exit(): Promise<void> {
    if (this.store.layers().length) {
      try {
        await this.draftService.save(this.store.layers());
      } catch (error) {
        console.error('Unable to save collage draft before exit:', error);
      }
    }
    void this.router.navigate(['/feed']);
  }

  /** Mở hộp thoại chọn tệp của panel ảnh — không tự dựng lại phần kiểm tra
   * kiểu/kích cỡ tệp, vốn đã nằm trong ImagePickerComponent.selectFile. */
  addImage(): void {
    this.picker?.openFileDialog();
  }

  openSubjectSelector(source: CollageImageSource): void {
    this.releaseSelectedSource(false);
    this.selectedSource.set(source);
  }

  cancelSubjectSelector(): void {
    this.releaseSelectedSource(false);
  }

  addCutout(result: SegmentationResult): void {
    const source = this.selectedSource();
    if (!source) return;
    const scale = Math.min(
      (COLLAGE_WIDTH * 0.72) / result.width,
      (COLLAGE_HEIGHT * 0.62) / result.height,
      1,
    );
    const cutoutImageUrl = URL.createObjectURL(result.blob);
    const layer: CollageImageLayer = {
      id: crypto.randomUUID(),
      kind: 'image',
      sourceImageUrl: source.sourceImageUrl,
      cutoutImageUrl,
      cutoutBlob: result.blob,
      x: COLLAGE_WIDTH / 2,
      y: COLLAGE_HEIGHT / 2,
      width: result.width,
      height: result.height,
      scaleX: scale,
      scaleY: scale,
      rotation: 0,
      zIndex: this.store.layers().length,
      ...DEFAULT_LAYER_CROP,
    };
    this.store.add(layer);
    const keepLocalSourceUrl = source.sourceImageUrl === source.temporaryUrl;
    this.releaseSelectedSource(keepLocalSourceUrl);
    this.showToast(
      result.isWholeImage
        ? 'Đã thêm nguyên bức ảnh vào khung.'
        : 'Đã thêm vật thể có nền trong suốt vào khung.',
    );
  }

  /** Opens the re-crop tool for the currently selected layer — lets the
   * user pick a different region of that layer's own image after it's
   * already on the canvas. */
  openLayerCrop(): void {
    const layer = this.store.selectedLayer();
    // Only image layers have a region to re-pick; the scissors button is hidden
    // for the others, so this is just the guard that makes that a type fact.
    if (!layer || !isImageLayer(layer)) return;
    this.cropTarget.set(layer);
  }

  applyLayerCrop(rect: LayerCropRect): void {
    const layer = this.cropTarget();
    if (!layer) return;
    this.store.updateCrop(layer.id, rect);
    this.cropTarget.set(null);
  }

  cancelLayerCrop(): void {
    this.cropTarget.set(null);
  }

  /** Manual save from the ··· menu — same write as the autosave, plus a toast
   * because here the user asked for it and expects an answer. */
  async saveDraft(): Promise<void> {
    if (!this.store.layers().length || this.isSaving()) return;
    const saved = await this.persistDraft();
    this.showToast(
      saved ? 'Đã lưu bản nháp trên trình duyệt.' : 'Không thể lưu bản nháp. Vui lòng thử lại.',
      saved ? 'success' : 'error',
    );
  }

  /** Single write path for both autosave and manual save. Returns whether it
   * succeeded so only the manual caller has to decide about messaging. */
  private async persistDraft(): Promise<boolean> {
    if (!this.store.layers().length || this.isSaving()) return false;
    this.isSaving.set(true);
    try {
      await this.draftService.save(this.store.layers());
      this.savedAt.set(Date.now());
      return true;
    } catch (error) {
      console.error('Unable to save collage draft:', error);
      return false;
    } finally {
      this.isSaving.set(false);
    }
  }

  async downloadPng(): Promise<void> {
    if (!this.store.layers().length || this.isExporting()) return;
    this.isExporting.set(true);
    try {
      const blob = await this.requireCanvas().exportPng();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `novaframe-collage-${Date.now()}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.showToast('Đã xuất ảnh PNG 1080 × 1920 px.');
    } catch (error) {
      console.error('Unable to export collage:', error);
      this.showToast('Không thể xuất PNG. Vui lòng thử lại.', 'error');
    } finally {
      this.isExporting.set(false);
    }
  }

  async finish(): Promise<void> {
    if (!this.store.layers().length || this.isExporting()) return;
    this.isExporting.set(true);
    try {
      const blob = await this.requireCanvas().exportPng();
      const file = new File([blob], `novaframe-collage-${Date.now()}.png`, {
        type: 'image/png',
      });
      await this.draftService.save(this.store.layers());
      this.transferService.set(file);
      const navigated = await this.router.navigate(['/create']);
      if (!navigated) throw new Error('Navigation was cancelled');
    } catch (error) {
      console.error('Unable to continue collage to publishing:', error);
      this.showToast('Không thể chuyển ảnh sang trang đăng bài.', 'error');
      this.isExporting.set(false);
    }
  }

  private requireCanvas(): CollageCanvasComponent {
    if (!this.canvas) throw new Error('Khung ảnh chưa sẵn sàng.');
    return this.canvas;
  }

  private releaseSelectedSource(keepTemporaryUrl: boolean): void {
    const source = this.selectedSource();
    if (source?.temporaryUrl?.startsWith('blob:') && !keepTemporaryUrl) {
      URL.revokeObjectURL(source.temporaryUrl);
    }
    this.selectedSource.set(null);
  }

  private showToast(message: string, kind: 'success' | 'error' = 'success'): void {
    if (kind === 'error') this.toast.error(message);
    else this.toast.success(message);
  }
}
