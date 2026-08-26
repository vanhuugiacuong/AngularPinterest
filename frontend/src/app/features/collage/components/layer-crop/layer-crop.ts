import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
  signal,
} from '@angular/core';
import { clampNormalizedRect } from '../../../../core/utils/image-crop';

export interface LayerCropRect {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

const DEFAULT_CROP: LayerCropRect = { cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 };

// Smallest crop box allowed, as a fraction of the layer's own image on
// either axis — keeps width/height comfortably away from 0 (never 0, NaN,
// Infinity), and guarantees the box always stays fully inside the image
// (so empty/transparent space can never appear inside the crop box).
const MIN_CROP_SIZE = 0.08;

type CropHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

/** Delegates to the same shared clamp the image editor's own re-crop tool
 * uses (core/utils/image-crop) so the two tools can't drift apart. */
function clampCropRect(x: number, y: number, width: number, height: number): LayerCropRect {
  const r = clampNormalizedRect({ x, y, width, height }, MIN_CROP_SIZE);
  return { cropX: r.x, cropY: r.y, cropWidth: r.width, cropHeight: r.height };
}

/** Re-crop tool for a single layer already placed on the collage canvas —
 * a full-screen dialog showing that layer's own image (background already
 * removed if it was a subject cutout) with a draggable/resizable rectangle.
 * Non-destructive: only emits the four crop numbers on Apply, never touches
 * the underlying image blob. */
@Component({
  selector: 'app-layer-crop',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './layer-crop.html',
  styleUrl: './layer-crop.css',
})
export class LayerCropComponent {
  @Input({ required: true }) imageUrl!: string;
  @Input() initialCrop: LayerCropRect = DEFAULT_CROP;
  @Output() readonly cropApplied = new EventEmitter<LayerCropRect>();
  @Output() readonly cancelled = new EventEmitter<void>();

  @ViewChild('stageWrap') stageWrapRef?: ElementRef<HTMLDivElement>;

  readonly draftCrop = signal<LayerCropRect>(DEFAULT_CROP);

  private dragMode: CropHandle | null = null;
  private dragPointerId: number | null = null;
  private dragStart: { clientX: number; clientY: number; rect: LayerCropRect } = {
    clientX: 0,
    clientY: 0,
    rect: DEFAULT_CROP,
  };

  ngOnInit(): void {
    this.draftCrop.set(this.initialCrop ?? DEFAULT_CROP);
  }

  @HostListener('window:keydown.escape')
  onEscape(): void {
    this.cancelled.emit();
  }

  apply(): void {
    this.cropApplied.emit(this.draftCrop());
  }

  cancel(): void {
    this.cancelled.emit();
  }

  reset(): void {
    this.draftCrop.set({ ...DEFAULT_CROP });
  }

  cropCursor(handle: CropHandle): string {
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

  onRectPointerDown(ev: PointerEvent): void {
    this.beginDrag(ev, 'move');
  }

  onHandlePointerDown(ev: PointerEvent, handle: CropHandle): void {
    this.beginDrag(ev, handle);
  }

  private beginDrag(ev: PointerEvent, mode: CropHandle): void {
    ev.preventDefault();
    ev.stopPropagation();
    const target = ev.currentTarget as HTMLElement;
    target.setPointerCapture(ev.pointerId);
    this.dragMode = mode;
    this.dragPointerId = ev.pointerId;
    this.dragStart = { clientX: ev.clientX, clientY: ev.clientY, rect: this.draftCrop() };
  }

  onOverlayPointerMove(ev: PointerEvent): void {
    if (this.dragMode === null || this.dragPointerId !== ev.pointerId) return;
    const wrap = this.stageWrapRef?.nativeElement;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dxFrac = (ev.clientX - this.dragStart.clientX) / rect.width;
    const dyFrac = (ev.clientY - this.dragStart.clientY) / rect.height;
    const start = this.dragStart.rect;

    let next: LayerCropRect;
    switch (this.dragMode) {
      case 'move':
        next = clampCropRect(start.cropX + dxFrac, start.cropY + dyFrac, start.cropWidth, start.cropHeight);
        break;
      case 'nw': {
        const x = start.cropX + dxFrac;
        const y = start.cropY + dyFrac;
        next = clampCropRect(x, y, start.cropX + start.cropWidth - x, start.cropY + start.cropHeight - y);
        break;
      }
      case 'ne': {
        const y = start.cropY + dyFrac;
        next = clampCropRect(start.cropX, y, start.cropWidth + dxFrac, start.cropY + start.cropHeight - y);
        break;
      }
      case 'sw': {
        const x = start.cropX + dxFrac;
        next = clampCropRect(x, start.cropY, start.cropX + start.cropWidth - x, start.cropHeight + dyFrac);
        break;
      }
      case 'se':
        next = clampCropRect(start.cropX, start.cropY, start.cropWidth + dxFrac, start.cropHeight + dyFrac);
        break;
    }
    this.draftCrop.set(next);
  }

  onOverlayPointerUp(ev: PointerEvent): void {
    if (this.dragPointerId !== ev.pointerId) return;
    this.dragMode = null;
    this.dragPointerId = null;
  }
}
