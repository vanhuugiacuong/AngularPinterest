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
  CropSettings,
  DEFAULT_ADJUSTMENTS,
  DEFAULT_CAPTION,
  DEFAULT_CROP,
  EditorSnapshot,
  FontOption,
  isDefaultCrop,
  SUPPORTED_FONTS,
} from './editor-types';
import { EditorHistory } from './editor-history';
import { canvasToBlob, loadImage, renderEditedImage } from './editor-render';
import { RangeControl } from '../../../shared/range-control/range-control';
import { clampNormalizedRect } from '../../../core/utils/image-crop';

const PREVIEW_MAX_DIMENSION = 1000;
const EXPORT_MAX_DIMENSION = 2400;

// Smallest crop box allowed, as a fraction of the source image on either
// axis — keeps width/height comfortably away from 0 (never 0, NaN, Infinity).
const MIN_CROP_SIZE = 0.08;

type CropHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

function clamp01(v: number): number {
  return Math.min(0.94, Math.max(0.06, v));
}

/** Clamps a crop rectangle so it always has a sane, finite size AND always
 * stays fully inside the source image bounds [0,1] — this is what
 * guarantees empty space can never appear inside the crop box (there is
 * nothing to clamp against outside the image, so an in-bounds rect can
 * never reveal a gap). Used for every pan/resize update. Delegates to the
 * same shared clamp collage's layer-crop tool uses (core/utils/image-crop)
 * so the two re-crop tools can't drift apart. */
function clampCropRect(x: number, y: number, width: number, height: number): CropSettings {
  return clampNormalizedRect({ x, y, width, height }, MIN_CROP_SIZE);
}

@Component({
  selector: 'app-image-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, RangeControl],
  templateUrl: './image-editor.html',
  styleUrl: './image-editor.css',
})
export class ImageEditor implements OnChanges, OnDestroy {
  /** Object URL (upload) or remote URL (AI generation) of the source image. */
  @Input({ required: true }) sourceUrl!: string;
  /** Set true for cross-origin sources (e.g. the AI generator) so the canvas isn't tainted. */
  @Input() sourceCrossOrigin = false;

  @ViewChild('previewCanvas') previewCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('cropCanvas') cropCanvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('cropStageWrap') cropStageWrapRef?: ElementRef<HTMLDivElement>;

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

  /** Color sliders are organized into a single-open accordion so the tool
   * panel never needs its own internal scrollbar — it just flows with the
   * page like the rest of the studio. */
  public readonly sliderGroups: { id: string; label: string; icon: string; keys: (keyof ColorAdjustments)[] }[] = [
    { id: 'light', label: 'Ánh sáng & tương phản', icon: 'brightness_6', keys: ['brightness', 'contrast'] },
    { id: 'color', label: 'Màu sắc', icon: 'palette', keys: ['saturation', 'warmth', 'hue'] },
    { id: 'fx', label: 'Hiệu ứng', icon: 'blur_on', keys: ['blur', 'grayscale', 'sepia'] },
  ];

  public expandedGroup = signal<string>('light');

  public activeTool = signal<'color' | 'caption' | 'crop'>('color');
  public adjustments = signal<ColorAdjustments>({ ...DEFAULT_ADJUSTMENTS });
  public activePresetLabel = computed(() => {
    const current = this.adjustments();
    const keys = Object.keys(DEFAULT_ADJUSTMENTS) as (keyof ColorAdjustments)[];
    const activePreset = this.presets.find((preset) => {
      const target = { ...DEFAULT_ADJUSTMENTS, ...preset.adjustments };
      return keys.every((key) => current[key] === target[key]);
    });
    return activePreset?.label ?? null;
  });
  public caption = signal<CaptionSettings>({ ...DEFAULT_CAPTION });

  // Applied crop (drives the real preview/export). While the user is
  // actively cropping, edits happen on `draftCrop` only — `crop` is only
  // overwritten on Apply, so Cancel is a no-op on the real editor state.
  public crop = signal<CropSettings>({ ...DEFAULT_CROP });
  public draftCrop = signal<CropSettings>({ ...DEFAULT_CROP });
  public isCroppingMode = signal(false);

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
    const changedCrop = !isDefaultCrop(this.crop());
    return changedColor || changedCaption || changedCrop;
  });

  private history = new EditorHistory();
  private pending: EditorSnapshot | null = null;
  private imageEl: HTMLImageElement | null = null;
  private rafHandle: number | null = null;
  private draggingPointerId: number | null = null;

  // ---------- crop-drag state (not part of Angular change detection) ----------
  private cropDragMode: CropHandle | null = null;
  private cropDragPointerId: number | null = null;
  private cropDragStart: { clientX: number; clientY: number; rect: CropSettings } = {
    clientX: 0,
    clientY: 0,
    rect: { ...DEFAULT_CROP },
  };

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
    this.crop.set({ ...DEFAULT_CROP });
    this.draftCrop.set({ ...DEFAULT_CROP });
    this.isCroppingMode.set(false);
    this.history.reset();
    this.pending = null;
    this.refreshHistoryFlags();

    try {
      this.imageEl = await loadImage(this.sourceUrl, this.sourceCrossOrigin);
      this.isLoadingImage.set(false);
      this.scheduleRender();
      // Covers the edge case where the user switched to the Crop tab while
      // this image was still loading (isCroppingMode was force-reset above,
      // but a fast re-click could still race back to 'crop' before this
      // resolves) — without this, the crop canvas would stay blank.
      if (this.activeTool() === 'crop') {
        this.enterCropMode();
      }
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
      crop: this.crop(),
      maxDimension: PREVIEW_MAX_DIMENSION,
    }).catch((err) => console.error('Lỗi khi render preview trong editor:', err));
  }

  /** Renders the crop-mode stage: the FULL source image (no crop clipping,
   * no caption) so the user can see the whole picture while choosing what
   * to keep. Runs once per crop-mode entry — not on every drag frame,
   * since dragging only moves the DOM overlay rectangle (see the .ie-crop-*
   * template bindings), not the canvas bitmap. */
  private renderCropStage(): void {
    const canvas = this.cropCanvasRef?.nativeElement;
    if (!canvas || !this.imageEl) return;
    renderEditedImage({
      image: this.imageEl,
      canvas,
      adjustments: this.adjustments(),
      caption: { ...DEFAULT_CAPTION },
      crop: { ...DEFAULT_CROP },
      maxDimension: PREVIEW_MAX_DIMENSION,
    }).catch((err) => console.error('Lỗi khi render vùng crop trong editor:', err));
  }

  // ---------- history plumbing ----------

  private snapshotValue(): EditorSnapshot {
    return { adjustments: this.adjustments(), caption: this.caption(), crop: this.crop() };
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
    if (this.isCroppingMode()) return;
    const prev = this.history.undo(this.snapshotValue());
    if (!prev) return;
    this.adjustments.set(prev.adjustments);
    this.caption.set(prev.caption);
    this.crop.set(prev.crop);
    this.refreshHistoryFlags();
    this.scheduleRender();
  }

  public redo(): void {
    if (this.isCroppingMode()) return;
    const next = this.history.redo(this.snapshotValue());
    if (!next) return;
    this.adjustments.set(next.adjustments);
    this.caption.set(next.caption);
    this.crop.set(next.crop);
    this.refreshHistoryFlags();
    this.scheduleRender();
  }

  // ---------- color controls ----------

  public setActiveTool(tool: 'color' | 'caption' | 'crop'): void {
    if (this.activeTool() === 'crop' && tool !== 'crop' && this.isCroppingMode()) {
      // Leaving the crop tab without an explicit Cancel keeps whatever valid
      // rectangle the user had drawn — matches how color/caption edits
      // already apply live, and avoids silently discarding work on a
      // stray tab click.
      this.applyCrop();
    }
    this.activeTool.set(tool);
    if (tool === 'crop') {
      this.enterCropMode();
    }
  }

  public toggleGroup(id: string): void {
    this.expandedGroup.update((current) => (current === id ? '' : id));
  }

  public sliderByKey(key: keyof ColorAdjustments) {
    return this.colorSliders.find((s) => s.key === key)!;
  }

  /** Number of sliders in a group that have drifted from their default —
   * shown as a badge on the collapsed accordion header so edits are never
   * hidden out of view. */
  public groupChangeCount(keys: (keyof ColorAdjustments)[]): number {
    const a = this.adjustments();
    return keys.filter((k) => a[k] !== DEFAULT_ADJUSTMENTS[k]).length;
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
    if (this.isCroppingMode()) return;
    this.applyChange(() => {
      this.adjustments.set({ ...DEFAULT_ADJUSTMENTS });
      this.caption.set({ ...DEFAULT_CAPTION });
      this.crop.set({ ...DEFAULT_CROP });
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

  // ---------- crop ----------

  private enterCropMode(): void {
    this.draftCrop.set(this.crop());
    this.isCroppingMode.set(true);
    // Render once on entry; dragging afterwards only moves the DOM overlay,
    // never re-renders the canvas (see renderCropStage's doc comment).
    requestAnimationFrame(() => this.renderCropStage());
  }

  /** Commits the in-progress rectangle as ONE undo/redo entry — matches the
   * existing pattern for discrete changes (presets, toggles). */
  public applyCrop(): void {
    const next = this.draftCrop();
    if (next.x !== this.crop().x || next.y !== this.crop().y || next.width !== this.crop().width || next.height !== this.crop().height) {
      this.applyChange(() => this.crop.set(next));
    }
    this.isCroppingMode.set(false);
  }

  /** Discards the in-progress rectangle — the applied crop (`this.crop`) is
   * never touched, so the image is exactly as it was before Crop was opened. */
  public cancelCrop(): void {
    this.draftCrop.set(this.crop());
    this.isCroppingMode.set(false);
  }

  /** Resets the crop back to "full image" — applies immediately, same as
   * resetColor()/resetCaption()/resetAll(). Previously this only touched the
   * DRAFT rectangle and silently required a separate "Áp dụng" click to take
   * effect, unlike every other reset button in this editor; that mismatch
   * read as the button "not working" since nothing about it hinted a second
   * step was needed. draftCrop is still updated too so the crop-stage
   * overlay snaps to the full frame right away if the user stays in crop
   * mode to keep adjusting. */
  public resetCropDraft(): void {
    this.draftCrop.set({ ...DEFAULT_CROP });
    const current = this.crop();
    if (current.x !== 0 || current.y !== 0 || current.width !== 1 || current.height !== 1) {
      this.applyChange(() => this.crop.set({ ...DEFAULT_CROP }));
    }
  }

  public cropCursor(handle: CropHandle): string {
    switch (handle) {
      case 'nw':
      case 'se':
        return 'nwse-resize';
      case 'ne':
      case 'sw':
        return 'nesw-resize';
      default:
        return 'move';
    }
  }

  public onCropRectPointerDown(ev: PointerEvent): void {
    this.beginCropDrag(ev, 'move');
  }

  public onCropHandlePointerDown(ev: PointerEvent, handle: CropHandle): void {
    this.beginCropDrag(ev, handle);
  }

  private beginCropDrag(ev: PointerEvent, mode: CropHandle): void {
    ev.preventDefault();
    ev.stopPropagation();
    const target = ev.currentTarget as HTMLElement;
    target.setPointerCapture(ev.pointerId);
    this.cropDragMode = mode;
    this.cropDragPointerId = ev.pointerId;
    this.cropDragStart = { clientX: ev.clientX, clientY: ev.clientY, rect: this.draftCrop() };
  }

  public onCropOverlayPointerMove(ev: PointerEvent): void {
    if (this.cropDragMode === null || this.cropDragPointerId !== ev.pointerId) return;
    const wrap = this.cropStageWrapRef?.nativeElement;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dxFrac = (ev.clientX - this.cropDragStart.clientX) / rect.width;
    const dyFrac = (ev.clientY - this.cropDragStart.clientY) / rect.height;
    const start = this.cropDragStart.rect;

    let next: CropSettings;
    switch (this.cropDragMode) {
      case 'move':
        next = clampCropRect(start.x + dxFrac, start.y + dyFrac, start.width, start.height);
        break;
      case 'nw': {
        const x = start.x + dxFrac;
        const y = start.y + dyFrac;
        next = clampCropRect(x, y, start.x + start.width - x, start.y + start.height - y);
        break;
      }
      case 'ne': {
        const y = start.y + dyFrac;
        next = clampCropRect(start.x, y, start.width + dxFrac, start.y + start.height - y);
        break;
      }
      case 'sw': {
        const x = start.x + dxFrac;
        next = clampCropRect(x, start.y, start.x + start.width - x, start.height + dyFrac);
        break;
      }
      case 'se':
        next = clampCropRect(start.x, start.y, start.width + dxFrac, start.height + dyFrac);
        break;
    }
    this.draftCrop.set(next);
  }

  public onCropOverlayPointerUp(ev: PointerEvent): void {
    if (this.cropDragPointerId !== ev.pointerId) return;
    this.cropDragMode = null;
    this.cropDragPointerId = null;
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
      crop: this.crop(),
      maxDimension: EXPORT_MAX_DIMENSION,
    });
    const blob = await canvasToBlob(exportCanvas, mime, mime === 'image/jpeg' ? 0.92 : undefined);
    const ext = mime === 'image/png' ? 'png' : 'jpg';
    return new File([blob], `${filenameBase}.${ext}`, { type: mime });
  }
}
