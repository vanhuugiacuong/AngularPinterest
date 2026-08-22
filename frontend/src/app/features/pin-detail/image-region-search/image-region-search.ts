import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImageSearchStore } from '../../../core/services/image-search-store';
import { Pin, PinService } from '../../../core/services/pin';
import {
  NormalizedRect,
  PixelRect,
  clampNormalizedRect,
  computeContainedRect,
  cropSourceToBlob,
  loadCanvasSafeBitmap,
} from '../../../core/utils/image-crop';

type DragState =
  | { kind: 'move'; startClientX: number; startClientY: number; startRect: NormalizedRect }
  | {
      kind: 'resize';
      handle: 'nw' | 'ne' | 'sw' | 'se';
      startClientX: number;
      startClientY: number;
      startRect: NormalizedRect;
    };

const DEFAULT_SELECTION: NormalizedRect = { x: 0.12, y: 0.12, width: 0.76, height: 0.76 };

/** Google-Lens-style region-select tool for the pin-detail stage image:
 * pick a rectangle on the current pin's image and search NovaFrame's own
 * CLIP index for visually similar pins using only that cropped region. Not
 * Google Lens and never calls any Google API — it's the existing
 * search-by-image pipeline, fed a crop instead of the whole picture. */
@Component({
  selector: 'app-image-region-search',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './image-region-search.html',
  styleUrl: './image-region-search.css',
})
export class ImageRegionSearch implements OnDestroy {
  @Input({ required: true }) imageUrl!: string;
  @Input({ required: true }) pinId!: string;
  @Output() closed = new EventEmitter<void>();
  @Output() searchCompleted = new EventEmitter<Pin[]>();

  private readonly pinService = inject(PinService);
  private readonly imageSearchStore = inject(ImageSearchStore);

  @ViewChild('stageImg') private stageImgRef?: ElementRef<HTMLImageElement>;

  readonly resizeHandles: ReadonlyArray<'nw' | 'ne' | 'sw' | 'se'> = ['nw', 'ne', 'sw', 'se'];

  readonly selection = signal<NormalizedRect>(DEFAULT_SELECTION);
  readonly containedRect = signal<PixelRect>({ x: 0, y: 0, width: 0, height: 0 });
  readonly isSubmitting = signal(false);
  readonly submitError = signal<string | null>(null);

  readonly selectionPixelRect = computed<PixelRect>(() => {
    const c = this.containedRect();
    const s = this.selection();
    return {
      x: c.x + s.x * c.width,
      y: c.y + s.y * c.height,
      width: s.width * c.width,
      height: s.height * c.height,
    };
  });

  private naturalSize: { width: number; height: number } | null = null;
  private drag: DragState | null = null;
  private resizeObserver?: ResizeObserver;

  onImageLoad(img: HTMLImageElement) {
    this.naturalSize = { width: img.naturalWidth, height: img.naturalHeight };
    this.recomputeContainedRect();
    if (!this.resizeObserver && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.recomputeContainedRect());
      this.resizeObserver.observe(img);
    }
  }

  private recomputeContainedRect() {
    const img = this.stageImgRef?.nativeElement;
    if (!img || !this.naturalSize) return;
    const rect = img.getBoundingClientRect();
    this.containedRect.set(
      computeContainedRect(rect.width, rect.height, this.naturalSize.width, this.naturalSize.height),
    );
  }

  selectFullImage() {
    this.selection.set({ x: 0, y: 0, width: 1, height: 1 });
  }

  resetSelection() {
    this.selection.set(DEFAULT_SELECTION);
  }

  cancel() {
    this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    this.cancel();
  }

  onSelectionPointerDown(event: PointerEvent) {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.drag = {
      kind: 'move',
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: this.selection(),
    };
  }

  onHandlePointerDown(event: PointerEvent, handle: 'nw' | 'ne' | 'sw' | 'se') {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.drag = {
      kind: 'resize',
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: this.selection(),
    };
  }

  onDragPointerMove(event: PointerEvent) {
    const drag = this.drag;
    const container = this.containedRect();
    if (!drag || !container.width || !container.height) return;

    const dxFrac = (event.clientX - drag.startClientX) / container.width;
    const dyFrac = (event.clientY - drag.startClientY) / container.height;
    const start = drag.startRect;

    if (drag.kind === 'move') {
      this.selection.set(clampNormalizedRect({ ...start, x: start.x + dxFrac, y: start.y + dyFrac }));
      return;
    }

    let { x, y, width, height } = start;
    switch (drag.handle) {
      case 'se':
        width = start.width + dxFrac;
        height = start.height + dyFrac;
        break;
      case 'sw':
        x = start.x + dxFrac;
        width = start.width - dxFrac;
        height = start.height + dyFrac;
        break;
      case 'ne':
        y = start.y + dyFrac;
        width = start.width + dxFrac;
        height = start.height - dyFrac;
        break;
      case 'nw':
        x = start.x + dxFrac;
        y = start.y + dyFrac;
        width = start.width - dxFrac;
        height = start.height - dyFrac;
        break;
    }
    this.selection.set(clampNormalizedRect({ x, y, width, height }));
  }

  onDragPointerUp(event: PointerEvent) {
    if (!this.drag) return;
    this.drag = null;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already have been released by the browser — harmless.
    }
  }

  onSelectionKeydown(event: KeyboardEvent) {
    const step = 0.02;
    const current = this.selection();
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        this.selection.set(
          clampNormalizedRect(
            event.shiftKey ? { ...current, height: current.height - step } : { ...current, y: current.y - step },
          ),
        );
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.selection.set(
          clampNormalizedRect(
            event.shiftKey ? { ...current, height: current.height + step } : { ...current, y: current.y + step },
          ),
        );
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.selection.set(
          clampNormalizedRect(
            event.shiftKey ? { ...current, width: current.width - step } : { ...current, x: current.x - step },
          ),
        );
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.selection.set(
          clampNormalizedRect(
            event.shiftKey ? { ...current, width: current.width + step } : { ...current, x: current.x + step },
          ),
        );
        break;
      case 'Enter':
        event.preventDefault();
        void this.submitSearch();
        break;
      case 'Escape':
        event.preventDefault();
        this.cancel();
        break;
    }
  }

  async submitSearch() {
    if (this.isSubmitting()) return;
    this.isSubmitting.set(true);
    this.submitError.set(null);

    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await loadCanvasSafeBitmap(this.imageUrl, this.pinService.getImageProxyUrl(this.pinId));
      const blob = await cropSourceToBlob(bitmap, bitmap.width, bitmap.height, this.selection());
      const file = new File([blob], 'vung-anh-da-chon.jpg', { type: 'image/jpeg' });
      await this.searchWithFile(file);
    } catch (error) {
      this.submitError.set(
        error instanceof Error ? error.message : 'Không thể cắt hoặc tìm kiếm vùng ảnh đã chọn.',
      );
    } finally {
      bitmap?.close();
      this.isSubmitting.set(false);
    }
  }

  /** Sends an already prepared image query to CLIP and hands the matches to
   * Pin Detail. Kept separate from canvas work so the navigation contract is
   * independently testable without mocking browser image APIs. */
  private async searchWithFile(file: File): Promise<boolean> {
    const success = await this.imageSearchStore.searchByImage(file);
    if (!success) {
      this.submitError.set(
        this.imageSearchStore.error() || 'Không thể tìm kiếm bằng vùng ảnh đã chọn.',
      );
      return false;
    }

    this.searchCompleted.emit(this.imageSearchStore.results());
    this.closed.emit();
    return true;
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
  }
}
