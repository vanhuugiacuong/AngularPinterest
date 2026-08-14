import {
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CaptionAlign,
  CaptionPositionPreset,
  CaptionSettings,
  COLOR_PRESETS,
  ColorAdjustments,
  ColorPreset,
  DEFAULT_ADJUSTMENTS,
  DEFAULT_CAPTION,
  EditorSnapshot,
  FontOption,
  SUPPORTED_FONTS,
} from './editor-types';
import { EditorHistory } from './editor-history';
import { canvasToBlob, loadImage, renderEditedImage } from './editor-render';

const PREVIEW_MAX_DIMENSION = 1000;
const EXPORT_MAX_DIMENSION = 2400;

function clamp01(v: number): number {
  return Math.min(0.94, Math.max(0.06, v));
}

@Component({
  selector: 'app-image-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './image-editor.html',
  styleUrl: './image-editor.css',
})
export class ImageEditor implements OnChanges, OnDestroy {
  /** Object URL (upload) or remote URL (AI generation) of the source image. */
  @Input({ required: true }) sourceUrl!: string;
  /** Set true for cross-origin sources (e.g. the AI generator) so the canvas isn't tainted. */
  @Input() sourceCrossOrigin = false;

  @ViewChild('previewCanvas') previewCanvasRef!: ElementRef<HTMLCanvasElement>;

  public readonly fonts: FontOption[] = SUPPORTED_FONTS;
  public readonly presets: ColorPreset[] = COLOR_PRESETS;

  public readonly colorSliders: {
    key: keyof ColorAdjustments;
    label: string;
    min: number;
    max: number;
    step: number;
    unit: string;
  }[] = [
    { key: 'brightness', label: 'Độ sáng', min: 0, max: 200, step: 1, unit: '%' },
    { key: 'contrast', label: 'Độ tương phản', min: 0, max: 200, step: 1, unit: '%' },
    { key: 'saturation', label: 'Độ bão hòa', min: 0, max: 200, step: 1, unit: '%' },
    { key: 'warmth', label: 'Nhiệt độ màu', min: -100, max: 100, step: 1, unit: '' },
    { key: 'hue', label: 'Sắc độ (Hue)', min: -180, max: 180, step: 1, unit: '°' },
    { key: 'blur', label: 'Làm mờ', min: 0, max: 8, step: 0.5, unit: 'px' },
    { key: 'grayscale', label: 'Trắng đen', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'sepia', label: 'Sepia', min: 0, max: 100, step: 1, unit: '%' },
  ];

  public activeTool = signal<'color' | 'caption'>('color');
  public adjustments = signal<ColorAdjustments>({ ...DEFAULT_ADJUSTMENTS });
  public caption = signal<CaptionSettings>({ ...DEFAULT_CAPTION });

  public isLoadingImage = signal(true);
  public loadError = signal<string | null>(null);
  public isDraggingCaption = signal(false);

  public canUndo = signal(false);
  public canRedo = signal(false);

  public isDirty = computed(() => {
    const a = this.adjustments();
    const changedColor = (Object.keys(DEFAULT_ADJUSTMENTS) as (keyof ColorAdjustments)[]).some(
      (k) => a[k] !== DEFAULT_ADJUSTMENTS[k]
    );
    const c = this.caption();
    const changedCaption = c.enabled && c.text.trim().length > 0;
    return changedColor || changedCaption;
  });

  private history = new EditorHistory();
  private pending: EditorSnapshot | null = null;
  private imageEl: HTMLImageElement | null = null;
  private rafHandle: number | null = null;
  private draggingPointerId: number | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['sourceUrl'] && this.sourceUrl) {
      void this.loadSource();
    }
  }

  ngOnDestroy(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
    }
  }

  private async loadSource(): Promise<void> {
    this.isLoadingImage.set(true);
    this.loadError.set(null);
    this.imageEl = null;
    this.adjustments.set({ ...DEFAULT_ADJUSTMENTS });
    this.caption.set({ ...DEFAULT_CAPTION });
    this.history.reset();
    this.pending = null;
    this.refreshHistoryFlags();

    try {
      this.imageEl = await loadImage(this.sourceUrl, this.sourceCrossOrigin);
      this.isLoadingImage.set(false);
      this.scheduleRender();
    } catch (err: any) {
      this.isLoadingImage.set(false);
      this.loadError.set(err?.message || 'Không thể tải ảnh để chỉnh sửa.');
    }
  }

  // ---------- render scheduling ----------

  private scheduleRender(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
    }
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.renderPreview();
    });
  }

  private renderPreview(): void {
    const canvas = this.previewCanvasRef?.nativeElement;
    if (!canvas || !this.imageEl) return;
    renderEditedImage({
      image: this.imageEl,
      canvas,
      adjustments: this.adjustments(),
      caption: this.caption(),
      maxDimension: PREVIEW_MAX_DIMENSION,
    }).catch((err) => console.error('Lỗi khi render preview trong editor:', err));
  }

  // ---------- history plumbing ----------

  private snapshotValue(): EditorSnapshot {
    return { adjustments: this.adjustments(), caption: this.caption() };
  }

  private refreshHistoryFlags(): void {
    this.canUndo.set(this.history.canUndo());
    this.canRedo.set(this.history.canRedo());
  }

  private beginPendingIfNeeded(): void {
    if (!this.pending) {
      this.pending = this.snapshotValue();
    }
  }

  /** Commits a continuous-drag change (slider/caption drag) as ONE history entry. */
  public commitLiveChange(): void {
    if (this.pending) {
      this.history.commit(this.pending);
      this.pending = null;
      this.refreshHistoryFlags();
    }
  }

  /** Applies + commits a discrete, instantaneous change (toggle/select/preset). */
  private applyChange(mutator: () => void): void {
    const before = this.snapshotValue();
    mutator();
    this.history.commit(before);
    this.refreshHistoryFlags();
    this.scheduleRender();
  }

  public undo(): void {
    const prev = this.history.undo(this.snapshotValue());
    if (!prev) return;
    this.adjustments.set(prev.adjustments);
    this.caption.set(prev.caption);
    this.refreshHistoryFlags();
    this.scheduleRender();
  }

  public redo(): void {
    const next = this.history.redo(this.snapshotValue());
    if (!next) return;
    this.adjustments.set(next.adjustments);
    this.caption.set(next.caption);
    this.refreshHistoryFlags();
    this.scheduleRender();
  }

  // ---------- color controls ----------

  public setActiveTool(tool: 'color' | 'caption'): void {
    this.activeTool.set(tool);
  }

  public setAdjustmentLive(key: keyof ColorAdjustments, value: number): void {
    this.beginPendingIfNeeded();
    this.adjustments.update((a) => ({ ...a, [key]: value }));
    this.scheduleRender();
  }

  public resetAdjustment(key: keyof ColorAdjustments): void {
    this.applyChange(() => this.adjustments.update((a) => ({ ...a, [key]: DEFAULT_ADJUSTMENTS[key] })));
  }

  public applyPreset(preset: ColorPreset): void {
    this.applyChange(() => this.adjustments.set({ ...DEFAULT_ADJUSTMENTS, ...preset.adjustments }));
  }

  public resetColor(): void {
    this.applyChange(() => this.adjustments.set({ ...DEFAULT_ADJUSTMENTS }));
  }

  // ---------- caption controls ----------

  public setCaptionFieldLive<K extends keyof CaptionSettings>(key: K, value: CaptionSettings[K]): void {
    this.beginPendingIfNeeded();
    this.caption.update((c) => ({ ...c, [key]: value }));
    this.scheduleRender();
  }

  public setCaptionFieldInstant<K extends keyof CaptionSettings>(key: K, value: CaptionSettings[K]): void {
    this.applyChange(() => this.caption.update((c) => ({ ...c, [key]: value })));
  }

  public setCaptionAlign(align: CaptionAlign): void {
    this.setCaptionFieldInstant('align', align);
  }

  public setCaptionPosition(preset: CaptionPositionPreset): void {
    const map: Record<CaptionPositionPreset, { x: number; y: number }> = {
      top: { x: 0.5, y: 0.14 },
      center: { x: 0.5, y: 0.5 },
      bottom: { x: 0.5, y: 0.86 },
    };
    const target = map[preset];
    this.applyChange(() => this.caption.update((c) => ({ ...c, x: target.x, y: target.y })));
  }

  public resetCaption(): void {
    this.applyChange(() => this.caption.set({ ...DEFAULT_CAPTION }));
  }

  public resetAll(): void {
    this.applyChange(() => {
      this.adjustments.set({ ...DEFAULT_ADJUSTMENTS });
      this.caption.set({ ...DEFAULT_CAPTION });
    });
  }

  // ---------- drag-to-position caption ----------

  public onCanvasPointerDown(ev: PointerEvent): void {
    if (this.activeTool() !== 'caption' || !this.caption().enabled) return;
    const canvas = this.previewCanvasRef.nativeElement;
    canvas.setPointerCapture(ev.pointerId);
    this.draggingPointerId = ev.pointerId;
    this.isDraggingCaption.set(true);
    this.beginPendingIfNeeded();
    this.updateCaptionPositionFromEvent(ev);
  }

  public onCanvasPointerMove(ev: PointerEvent): void {
    if (this.draggingPointerId !== ev.pointerId) return;
    this.updateCaptionPositionFromEvent(ev);
  }

  public onCanvasPointerUp(ev: PointerEvent): void {
    if (this.draggingPointerId !== ev.pointerId) return;
    this.draggingPointerId = null;
    this.isDraggingCaption.set(false);
    const canvas = this.previewCanvasRef.nativeElement;
    try {
      canvas.releasePointerCapture(ev.pointerId);
    } catch {
      /* pointer capture already released */
    }
    this.commitLiveChange();
  }

  private updateCaptionPositionFromEvent(ev: PointerEvent): void {
    const canvas = this.previewCanvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = clamp01((ev.clientX - rect.left) / rect.width);
    const y = clamp01((ev.clientY - rect.top) / rect.height);
    this.caption.update((c) => ({ ...c, x, y }));
    this.scheduleRender();
  }

  // ---------- export ----------

  /** Renders the current edits at full resolution and returns a File ready
   * for the existing multipart upload flow. */
  public async exportFile(filenameBase: string, preferredMime?: string): Promise<File> {
    if (!this.imageEl) {
      throw new Error('Ảnh chưa sẵn sàng để xuất.');
    }
    const mime = preferredMime === 'image/png' ? 'image/png' : 'image/jpeg';
    const exportCanvas = document.createElement('canvas');
    await renderEditedImage({
      image: this.imageEl,
      canvas: exportCanvas,
      adjustments: this.adjustments(),
      caption: this.caption(),
      maxDimension: EXPORT_MAX_DIMENSION,
    });
    const blob = await canvasToBlob(exportCanvas, mime, mime === 'image/jpeg' ? 0.92 : undefined);
    const ext = mime === 'image/png' ? 'png' : 'jpg';
    return new File([blob], `${filenameBase}.${ext}`, { type: mime });
  }
}
