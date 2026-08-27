import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  signal,
} from '@angular/core';
import { CollageImageSource, SegmentationResult } from '../../collage.types';

const WHOLE_IMAGE_MAX_EDGE = 2560;

const DEFAULT_BRUSH_RADIUS = 14;
const MIN_BRUSH_RADIUS = 2;
const MAX_BRUSH_RADIUS = 140;

type BrushMode = 'paint' | 'erase';

interface CanvasPoint {
  x: number;
  y: number;
}

@Component({
  selector: 'app-subject-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './subject-selector.html',
  styleUrl: './subject-selector.css',
})
export class SubjectSelectorComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) source!: CollageImageSource;
  @Output() readonly cancelled = new EventEmitter<void>();
  @Output() readonly cutoutAdded = new EventEmitter<SegmentationResult>();

  @ViewChild('dialog') private dialogRef?: ElementRef<HTMLElement>;
  @ViewChild('maskCanvas') private maskCanvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('highlightCanvas') private highlightCanvasRef?: ElementRef<HTMLCanvasElement>;

  private maskCtx: CanvasRenderingContext2D | null = null;
  private highlightCtx: CanvasRenderingContext2D | null = null;
  private isDrawing = false;
  private lastPoint: CanvasPoint | null = null;
  private activePointerId: number | null = null;
  private destroyed = false;
  private readonly previouslyFocused: HTMLElement | null =
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  private readonly previousBodyOverflow =
    typeof document !== 'undefined' ? document.body.style.overflow : '';

  readonly adding = signal(false);
  readonly preparingWhole = signal(false);
  readonly error = signal<string | null>(null);
  readonly imageReady = signal(false);
  readonly hasPainted = signal(false);
  readonly brushMode = signal<BrushMode>('paint');
  readonly brushRadius = signal(DEFAULT_BRUSH_RADIUS);

  readonly minBrushRadius = MIN_BRUSH_RADIUS;
  readonly maxBrushRadius = MAX_BRUSH_RADIUS;

  constructor() {
    if (typeof document !== 'undefined') document.body.style.overflow = 'hidden';
  }

  ngAfterViewInit(): void {
    this.dialogRef?.nativeElement.focus();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (typeof document !== 'undefined') {
      document.body.style.overflow = this.previousBodyOverflow;
      this.previouslyFocused?.focus();
    }
  }

  /** Tracks where a press on the backdrop started — see profile.ts's
   * identical helper for why closing must check both the mousedown and
   * click targets instead of the click alone. */
  private backdropMouseDownTarget: EventTarget | null = null;

  onBackdropMouseDown(event: MouseEvent): void {
    this.backdropMouseDownTarget = event.target;
  }

  onBackdropClick(event: MouseEvent): void {
    const startedOnBackdrop = this.backdropMouseDownTarget === event.currentTarget;
    this.backdropMouseDownTarget = null;
    if (startedOnBackdrop && event.target === event.currentTarget) {
      this.cancelled.emit();
    }
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (!this.adding()) this.cancelled.emit();
      return;
    }

    if (event.key === 'Tab') {
      const dialog = this.dialogRef?.nativeElement;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  /** Sizes the mask canvas's backing store to the source image's natural
   * resolution (capped like the whole-image path below) as soon as the
   * visible <img> finishes loading. Painting is authored directly at this
   * resolution — via percentage-of-rendered-rect coordinate mapping in
   * toCanvasPoint — so no separate scaling pass is needed when compositing
   * the final cutout in addCutout(). */
  onImageLoad(event: Event): void {
    const img = event.target as HTMLImageElement;
    const canvas = this.maskCanvasRef?.nativeElement;
    const highlightCanvas = this.highlightCanvasRef?.nativeElement;
    if (!canvas || !highlightCanvas || !img.naturalWidth || !img.naturalHeight) return;

    const scale = Math.min(1, WHOLE_IMAGE_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.width = width;
    canvas.height = height;
    highlightCanvas.width = width;
    highlightCanvas.height = height;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const highlightCtx = highlightCanvas.getContext('2d');
    if (!ctx || !highlightCtx) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.maskCtx = ctx;
    this.highlightCtx = highlightCtx;
    this.hasPainted.set(false);
    this.imageReady.set(true);
  }

  /** Converts a pointer event into mask-canvas backing-pixel coordinates.
   * getBoundingClientRect() returns the canvas ELEMENT's box — 100% of
   * .image-frame — which is not the same rectangle as the visible photo
   * whenever object-fit: contain (matching the <img>) has to letterbox it,
   * i.e. whenever the box's aspect ratio doesn't match the mask's own
   * width/height ratio. This reproduces contain's own fit math to find the
   * actual rendered photo rectangle within that box first, so a point
   * outside it (in the letterbox bars) clamps to the nearest edge instead
   * of mapping onto the wrong part of the image. */
  private toCanvasPoint(event: PointerEvent): CanvasPoint | null {
    const canvas = this.maskCanvasRef?.nativeElement;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !canvas.width || !canvas.height) return null;

    const boxAspect = rect.width / rect.height;
    const contentAspect = canvas.width / canvas.height;
    let contentWidth = rect.width;
    let contentHeight = rect.height;
    let offsetX = 0;
    let offsetY = 0;
    if (contentAspect > boxAspect) {
      contentHeight = rect.width / contentAspect;
      offsetY = (rect.height - contentHeight) / 2;
    } else {
      contentWidth = rect.height * contentAspect;
      offsetX = (rect.width - contentWidth) / 2;
    }

    const nx = Math.max(0, Math.min(1, (event.clientX - rect.left - offsetX) / contentWidth));
    const ny = Math.max(0, Math.min(1, (event.clientY - rect.top - offsetY) / contentHeight));
    return { x: nx * canvas.width, y: ny * canvas.height };
  }

  onCanvasPointerDown(event: PointerEvent): void {
    if (this.adding() || this.preparingWhole() || !this.maskCtx) return;
    const point = this.toCanvasPoint(event);
    if (!point) return;
    event.preventDefault();
    this.activePointerId = event.pointerId;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.isDrawing = true;
    this.lastPoint = null;
    this.error.set(null);
    this.strokeTo(point);
  }

  onCanvasPointerMove(event: PointerEvent): void {
    if (!this.isDrawing || event.pointerId !== this.activePointerId) return;
    const point = this.toCanvasPoint(event);
    if (!point) return;
    event.preventDefault();
    this.strokeTo(point);
  }

  onCanvasPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this.activePointerId) return;
    this.isDrawing = false;
    this.lastPoint = null;
    this.activePointerId = null;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  /** Draws one segment (or, on the first point of a stroke, just a dot so a
   * tap alone still paints something) directly into the mask canvas at full
   * opacity. The on-screen translucent look comes purely from the canvas
   * element's CSS opacity (see .mask-canvas) — the backing pixel alpha stays
   * at 0 or 255, which is what addCutout() later reads to build the cutout. */
  private strokeTo(point: CanvasPoint): void {
    const ctx = this.maskCtx;
    if (!ctx) return;
    const radius = this.brushRadius();
    const erasing = this.brushMode() === 'erase';
    ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
    ctx.fillStyle = 'rgba(139, 44, 255, 1)';
    ctx.strokeStyle = 'rgba(139, 44, 255, 1)';
    ctx.lineWidth = radius * 2;

    if (this.lastPoint) {
      ctx.beginPath();
      ctx.moveTo(this.lastPoint.x, this.lastPoint.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();

    this.lastPoint = point;
    if (erasing) {
      this.refreshHasPainted();
    } else {
      this.hasPainted.set(true);
    }
    this.redrawHighlight();
  }

  /** Rebuilds the visible highlight from scratch out of the authoritative
   * mask, every stroke — so it's always topologically correct for whatever
   * shape the user has painted so far (any number of separate blobs), never
   * an approximation stitched together incrementally. Two passes:
   *  1. A blurred, near-full-alpha copy of the mask — this is what makes the
   *     glow bleed OUTWARD past the mask's exact silhouette.
   *  2. 'destination-out' at a lower alpha, drawing the UNBLURRED mask again
   *     — this only erases alpha strictly inside the exact painted shape
   *     (where the unblurred mask is opaque), leaving that interior visibly
   *     tinted while the outward bleed from pass 1 survives untouched,
   *     reading as a bright glowing rim around a solid-but-see-through fill. */
  private redrawHighlight(): void {
    const mask = this.maskCanvasRef?.nativeElement;
    const hctx = this.highlightCtx;
    if (!mask || !hctx) return;
    const { width, height } = mask;
    hctx.clearRect(0, 0, width, height);

    // A fixed pixel blur would look completely different across photos —
    // e.g. 9px is a thin, crisp rim on a 2560px-wide canvas but a huge,
    // heavy glow on a 400px-wide one, since object-fit: contain displays
    // both at roughly the same on-screen size. Deriving it as a fraction of
    // the canvas's own size keeps the glow reading the same regardless of
    // the source photo's resolution.
    const blurPx = Math.max(width, height) * 0.01;
    hctx.save();
    hctx.filter = `blur(${blurPx}px)`;
    hctx.globalAlpha = 1;
    hctx.drawImage(mask, 0, 0);
    hctx.restore();

    hctx.save();
    hctx.globalCompositeOperation = 'destination-out';
    hctx.globalAlpha = 0.25;
    hctx.drawImage(mask, 0, 0);
    hctx.restore();
  }

  /** Only needed after erasing, since a paint stroke can never turn
   * hasPainted() back to false on its own — scans the mask's alpha channel
   * for any surviving painted pixel. Mask canvases are capped at
   * WHOLE_IMAGE_MAX_EDGE and this only runs while actively erasing. */
  private refreshHasPainted(): void {
    const canvas = this.maskCanvasRef?.nativeElement;
    const ctx = this.maskCtx;
    if (!canvas || !ctx) return;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) {
        this.hasPainted.set(true);
        return;
      }
    }
    this.hasPainted.set(false);
  }

  setBrushMode(mode: BrushMode): void {
    this.brushMode.set(mode);
  }

  setBrushRadius(radius: number): void {
    this.brushRadius.set(Math.max(MIN_BRUSH_RADIUS, Math.min(MAX_BRUSH_RADIUS, Math.round(radius))));
  }

  clearMask(): void {
    const canvas = this.maskCanvasRef?.nativeElement;
    const ctx = this.maskCtx;
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.hasPainted.set(false);
    this.error.set(null);
    this.redrawHighlight();
  }

  async selectAll(): Promise<void> {
    if (this.adding() || this.preparingWhole()) return;
    this.preparingWhole.set(true);
    this.adding.set(true);
    this.error.set(null);
    try {
      const result = await this.prepareWholeImage();
      if (this.destroyed) return;
      this.cutoutAdded.emit(result);
    } catch (error) {
      console.error('Failed to add the whole image:', error);
      if (!this.destroyed) {
        this.adding.set(false);
        this.error.set('Không thể thêm nguyên bức ảnh. Vui lòng thử ảnh khác.');
      }
    } finally {
      if (!this.destroyed) this.preparingWhole.set(false);
    }
  }

  private async prepareWholeImage(): Promise<SegmentationResult> {
    const bitmap = await createImageBitmap(this.source.blob);
    try {
      const scale = Math.min(1, WHOLE_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      if (scale === 1) {
        return { blob: this.source.blob, width, height, isWholeImage: true };
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) throw new Error('Trình duyệt không hỗ trợ Canvas 2D.');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('Không thể tạo ảnh.'))),
          'image/png',
          1,
        );
      });
      return { blob, width, height, isWholeImage: true };
    } finally {
      bitmap.close();
    }
  }

  /** Composites the source image with the painted mask as its alpha channel:
   * the image is drawn first, then 'destination-in' keeps only the pixels
   * the mask has alpha at (i.e. what the user painted) and clears everything
   * else to fully transparent — exactly the painted shape, nothing more. */
  async addCutout(): Promise<void> {
    if (this.adding() || this.preparingWhole() || !this.hasPainted()) return;
    const maskCanvas = this.maskCanvasRef?.nativeElement;
    if (!maskCanvas) return;

    this.adding.set(true);
    this.error.set(null);
    try {
      const bitmap = await createImageBitmap(this.source.blob);
      try {
        const width = maskCanvas.width;
        const height = maskCanvas.height;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) throw new Error('Trình duyệt không hỗ trợ Canvas 2D.');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, width, height);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(maskCanvas, 0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';

        const cropped = this.cropToPaintedBounds(canvas, ctx);

        const blob = await new Promise<Blob>((resolve, reject) => {
          cropped.canvas.toBlob(
            (value) => (value ? resolve(value) : reject(new Error('Không thể tạo ảnh.'))),
            'image/png',
            1,
          );
        });
        if (this.destroyed) return;
        this.cutoutAdded.emit({ blob, width: cropped.canvas.width, height: cropped.canvas.height });
      } finally {
        bitmap.close();
      }
    } catch (error) {
      console.error('Failed to composite the painted cutout:', error);
      if (!this.destroyed) {
        this.adding.set(false);
        this.error.set('Không thể tạo phần cắt từ vùng đã tô. Vui lòng thử lại.');
      }
    }
  }

  /** Without this, a small painted area (e.g. a tiny object in a huge photo)
   * would still export at the FULL original photo's dimensions — everywhere
   * except the paint fully transparent — so the layer's bounding box/resize
   * handles in the collage canvas would be sized to the whole photo instead
   * of hugging the actual visible content, making it awkward to grab and
   * scale. Scans the composited canvas's alpha channel for the tight
   * rectangle actually containing painted (opaque) pixels and crops down to
   * exactly that, so the exported layer's own width/height match what's
   * visually there. */
  private cropToPaintedBounds(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
  ): { canvas: HTMLCanvasElement } {
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width * 4;
      for (let x = 0; x < width; x++) {
        if (data[rowOffset + x * 4 + 3] !== 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < minX || maxY < minY) return { canvas };

    const cropWidth = maxX - minX + 1;
    const cropHeight = maxY - minY + 1;
    if (cropWidth === width && cropHeight === height) return { canvas };

    const cropped = document.createElement('canvas');
    cropped.width = cropWidth;
    cropped.height = cropHeight;
    const croppedCtx = cropped.getContext('2d', { alpha: true });
    if (!croppedCtx) return { canvas };
    croppedCtx.drawImage(canvas, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    return { canvas: cropped };
  }
}
