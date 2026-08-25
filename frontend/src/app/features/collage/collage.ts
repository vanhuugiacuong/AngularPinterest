import { CommonModule } from '@angular/common';
import {
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
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
  CollageImageSource,
  CollageLayer,
  DEFAULT_LAYER_CROP,
  SegmentationResult,
} from './collage.types';
import { CollageDraftService } from './services/collage-draft.service';
import { CollageStoreService } from './services/collage-store.service';
import { CollageTransferService } from './services/collage-transfer.service';
import { SEGMENTATION_PROVIDER } from './services/segmentation-provider';
import { InteractiveSegmentationService } from './services/interactive-segmentation.service';
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
  ],
  templateUrl: './collage.html',
  styleUrl: './collage.css',
})
export class Collage implements OnInit, OnDestroy {
  @ViewChild(CollageCanvasComponent) private canvas?: CollageCanvasComponent;

  readonly store = inject(CollageStoreService);
  private readonly draftService = inject(CollageDraftService);
  private readonly transferService = inject(CollageTransferService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly selectedSource = signal<CollageImageSource | null>(null);
  /** The layer currently open in the re-crop tool (null = tool closed).
   * Kept as the whole layer (not just its id) so the crop dialog's inputs
   * don't flicker if the layer briefly disappears from the store mid-edit. */
  readonly cropTarget = signal<CollageLayer | null>(null);
  readonly isSaving = signal(false);
  readonly isExporting = signal(false);

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
    const layer: CollageLayer = {
      id: crypto.randomUUID(),
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
    if (!layer) return;
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

  async saveDraft(): Promise<void> {
    if (!this.store.layers().length || this.isSaving()) return;
    this.isSaving.set(true);
    try {
      await this.draftService.save(this.store.layers());
      this.showToast('Đã lưu bản nháp trên trình duyệt.');
    } catch (error) {
      console.error('Unable to save collage draft:', error);
      this.showToast('Không thể lưu bản nháp. Vui lòng thử lại.', 'error');
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
