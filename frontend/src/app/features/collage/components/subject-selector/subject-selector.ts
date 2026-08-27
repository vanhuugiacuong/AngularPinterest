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
  inject,
  signal,
} from '@angular/core';
import { CollageImageSource, SegmentationResult } from '../../collage.types';
import {
  SEGMENTATION_PROVIDER,
  SegmentationHint,
  SegmentationPoint,
  UncertainSegmentationError,
} from '../../services/segmentation-provider';
import {
  BrushHint,
  rasterizeHint,
  SELECTION_ENGINE,
  SelectionEngineImage,
  SMART_CUT_ENGINE,
} from '../../services/selection-engine';
import { CanvasPoint, screenPointToCanvasPixel, workingToOriginal } from './coordinate-transformer';
import { cleanupMask, featherMask, maskBounds, upscaleMaskNearest } from './selection-mask-refiner';
import { SelectionHistory } from './selection-history';

const WHOLE_IMAGE_MAX_EDGE = 2560;

const DEFAULT_BRUSH_RADIUS = 14;
const MIN_BRUSH_RADIUS = 2;
const MAX_BRUSH_RADIUS = 140;

// Smart Mask (region-growing) brush — sized per the feature's own spec
// rather than reusing the plain-brush constants above, since this tool's
// stroke is only ever a SEED for growth, not the literal selection shape,
// so a much bigger default/max reads better in practice.
const DEFAULT_REGION_BRUSH_RADIUS = 34;
const MIN_REGION_BRUSH_RADIUS = 5;
const MAX_REGION_BRUSH_RADIUS = 150;

// The region-growing algorithm runs on a downscaled copy of the photo —
// full-resolution flood growth over a multi-megapixel photo would freeze
// the UI, and a coarse working copy is plenty to find an object's silhouette.
const REGION_WORKING_MAX_EDGE = 480;

// Smart Cut's final export never reads from this downscaled copy — see
// buildRegionCutout. These only control how much extra room, in WORKING-
// resolution pixels, is scooped in around the coarse mask's bounding box
// before mapping up to the original photo: enough for the edge-snap
// refinement pass to have real boundary to search, and a little padding on
// the final crop so anti-aliased/feathered edges aren't clipped.
const REGION_REFINE_MARGIN_WORKING_PX = 6;
const REGION_CROP_PADDING_PX = 3;

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

type SelectionMode = 'smart' | 'brush' | 'region';
type BrushMode = 'paint' | 'erase';
type RegionOp = 'add' | 'subtract';

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

  private readonly provider = inject(SEGMENTATION_PROVIDER);
  private readonly selectionEngine = inject(SELECTION_ENGINE);
  private readonly smartCutEngine = inject(SMART_CUT_ENGINE);

  private maskCtx: CanvasRenderingContext2D | null = null;
  private highlightCtx: CanvasRenderingContext2D | null = null;
  /** The loaded <img>, so the highlight pass can composite the real photo
   * through the mask (see redrawHighlight). */
  private loadedImage: HTMLImageElement | null = null;
  private isDrawing = false;
  private lastPoint: CanvasPoint | null = null;
  private activePointerId: number | null = null;
  private smartCutoutResult: SegmentationResult | null = null;
  private smartCutoutUrl: string | null = null;
  private requestId = 0;
  private destroyed = false;
  private readonly previouslyFocused: HTMLElement | null =
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  private readonly previousBodyOverflow =
    typeof document !== 'undefined' ? document.body.style.overflow : '';

  readonly mode = signal<SelectionMode>('smart');
  readonly adding = signal(false);
  readonly preparingWhole = signal(false);
  readonly error = signal<string | null>(null);

  // Smart (paint-a-stroke AI segmentation) state
  private lastHint: SegmentationHint | null = null;
  private lastLassoAreaRatio: number | undefined;
  private lastLassoPolygon: SegmentationPoint[] | undefined;
  private scribblePoints: CanvasPoint[] = [];
  readonly processing = signal(false);
  readonly progress = signal(0);
  readonly hasSelection = signal(false);
  readonly previewUrl = signal<string | null>(null);

  // Brush (paint-to-select) state
  readonly imageReady = signal(false);
  readonly hasPainted = signal(false);
  readonly brushMode = signal<BrushMode>('paint');
  readonly brushRadius = signal(DEFAULT_BRUSH_RADIUS);

  readonly minBrushRadius = MIN_BRUSH_RADIUS;
  readonly maxBrushRadius = MAX_BRUSH_RADIUS;

  // Smart Mask (local edge-aware region growing) state
  private workingImage: SelectionEngineImage | null = null;
  private workingImagePromise: Promise<SelectionEngineImage> | null = null;
  private regionMask: Uint8Array | null = null;
  private regionStrokePoints: CanvasPoint[] = [];
  private readonly regionHistory = new SelectionHistory();
  private regionPreviewObjectUrl: string | null = null;
  readonly regionOp = signal<RegionOp>('add');
  readonly regionBrushRadius = signal(DEFAULT_REGION_BRUSH_RADIUS);
  readonly regionBusy = signal(false);
  readonly hasRegionSelection = signal(false);
  readonly canUndoRegion = signal(false);
  readonly canRedoRegion = signal(false);
  readonly regionPreviewActive = signal(false);
  readonly regionPreviewUrl = signal<string | null>(null);

  readonly minRegionBrushRadius = MIN_REGION_BRUSH_RADIUS;
  readonly maxRegionBrushRadius = MAX_REGION_BRUSH_RADIUS;

  // Zoom / pan — shared across all three modes. Implemented purely as CSS
  // transforms on .image-frame, so every pointer coordinate mapping in this
  // component (screenPointToCanvasPixel, always reading the canvas's LIVE
  // getBoundingClientRect) stays correct with no special-casing: the canvas
  // simply reports whatever box it's actually rendered at.
  readonly zoom = signal(1);
  readonly panX = signal(0);
  readonly panY = signal(0);
  readonly panMode = signal(false);
  private isPanning = false;
  private panPointerId: number | null = null;
  private panStart: CanvasPoint | null = null;

  constructor() {
    if (typeof document !== 'undefined') document.body.style.overflow = 'hidden';
  }

  ngAfterViewInit(): void {
    this.dialogRef?.nativeElement.focus();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.requestId++;
    if (this.smartCutoutUrl) URL.revokeObjectURL(this.smartCutoutUrl);
    if (this.regionPreviewObjectUrl) URL.revokeObjectURL(this.regionPreviewObjectUrl);
    if (typeof document !== 'undefined') {
      document.body.style.overflow = this.previousBodyOverflow;
      this.previouslyFocused?.focus();
    }
  }

  /* The backdrop press-tracking helpers and the Tab focus trap that used to
     live here went with the modal. The trap in particular had to go: it cycled
     Tab inside this component, which is correct while a dialog owns the screen
     but means a keyboard user can never reach the artboard, the layer list or
     the header once this is just a panel in a column. Escape still backs out —
     that reads the same either way. */

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (!this.adding()) this.cancelled.emit();
      return;
    }

    const modifier = event.ctrlKey || event.metaKey;
    if (this.mode() === 'region' && modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redoRegion();
      else this.undoRegion();
    }
  }

  /** Switching modes clears whatever's drawn on the shared mask/highlight
   * canvases — each mode paints its own kind of content onto them for the
   * glow effect (the user's literal strokes, the AI's returned mask, or the
   * region-growing result), and leftovers from one would corrupt another's
   * result (e.g. a stale AI mask still sitting there would get folded into
   * a freshly-painted brush cutout). */
  setMode(mode: SelectionMode): void {
    if (
      this.mode() === mode ||
      this.processing() ||
      this.adding() ||
      this.preparingWhole() ||
      this.regionBusy()
    ) {
      return;
    }
    this.mode.set(mode);
    this.error.set(null);
    this.resetCanvasState();
    this.resetRegionState();
    this.resetZoom();
  }

  private resetCanvasState(): void {
    const canvas = this.maskCanvasRef?.nativeElement;
    if (canvas && this.maskCtx) this.maskCtx.clearRect(0, 0, canvas.width, canvas.height);
    if (canvas && this.highlightCtx) this.highlightCtx.clearRect(0, 0, canvas.width, canvas.height);
    this.hasPainted.set(false);
    this.hasSelection.set(false);
    this.smartCutoutResult = null;
    this.lastHint = null;
    if (this.smartCutoutUrl) {
      URL.revokeObjectURL(this.smartCutoutUrl);
      this.smartCutoutUrl = null;
    }
    this.previewUrl.set(null);
  }

  private resetRegionState(): void {
    this.regionMask = null;
    this.regionHistory.clear();
    this.canUndoRegion.set(false);
    this.canRedoRegion.set(false);
    this.hasRegionSelection.set(false);
    this.regionPreviewActive.set(false);
    if (this.regionPreviewObjectUrl) {
      URL.revokeObjectURL(this.regionPreviewObjectUrl);
      this.regionPreviewObjectUrl = null;
    }
    this.regionPreviewUrl.set(null);
  }

  // ---------------------------------------------------------------------
  // Smart mode: tap a point, or drag a rough stroke over an object, and ask
  // the segmentation provider (interactive-segmentation service, backed by
  // MediaPipe's magic-touch model) to find that object's exact boundary.
  // A dragged stroke is sent as a "scribble" ROI — the model uses the whole
  // path, not just its endpoints, which tracks elongated or oddly-shaped
  // subjects far better than a single keypoint.
  // ---------------------------------------------------------------------

  retry(): void {
    if (this.lastHint && !this.processing()) {
      void this.processSmartSelection(this.lastHint, this.lastLassoAreaRatio, this.lastLassoPolygon);
    }
  }

  /** "Chọn lại" — clears the current AI selection (mask, glow, error) so the
   * user can lasso a different object from scratch, without closing and
   * reopening the whole tool. */
  resetSmartSelection(): void {
    if (this.processing() || this.adding()) return;
    this.resetCanvasState();
    this.error.set(null);
  }

  /** Draws the in-progress stroke directly (no glow pass, unlike the brush
   * mode's highlight) so the user sees exactly what path they're tracing
   * before it's sent off for recognition. Cleared once the stroke ends. */
  private drawScribblePreview(): void {
    const canvas = this.highlightCanvasRef?.nativeElement;
    const ctx = this.highlightCtx;
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.scribblePoints.length === 0) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(139, 44, 255, 0.9)';
    ctx.lineWidth = Math.max(3, Math.max(canvas.width, canvas.height) * 0.006);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(this.scribblePoints[0].x, this.scribblePoints[0].y);
    for (const point of this.scribblePoints.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.restore();
  }

  /** Drops points closer together than ~1% of the canvas's own size — a fast
   * drag can fire dozens of pointermove events for a short, visually
   * straight segment, and the model gains nothing from that redundancy. */
  private pushStrokePoint(buffer: CanvasPoint[], point: CanvasPoint): void {
    const last = buffer[buffer.length - 1];
    const canvas = this.maskCanvasRef?.nativeElement;
    const minDistance = canvas ? Math.max(canvas.width, canvas.height) * 0.01 : 4;
    if (last) {
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      if (dx * dx + dy * dy < minDistance * minDistance) return;
    }
    buffer.push(point);
  }

  private toNormalizedPoints(points: CanvasPoint[]): SegmentationPoint[] {
    const canvas = this.maskCanvasRef?.nativeElement;
    const width = canvas?.width || 1;
    const height = canvas?.height || 1;
    return points.map((point) => ({
      x: Math.max(0, Math.min(1, point.x / width)),
      y: Math.max(0, Math.min(1, point.y / height)),
    }));
  }

  /** Treats the traced stroke as a loose lasso around the subject rather
   * than a literal outline to cut along: closes it into a polygon and
   * samples candidate points from its INTERIOR. A loose lasso routinely
   * encloses a mix of the subject AND background (a wide loop around a
   * tree also catches sky and water) — this model's keypoint interaction
   * is designed for "a single point ON the object", and feeding it a
   * scattered multi-point scribble spanning multiple unrelated regions
   * produced a fragmented, broken mask in practice rather than one
   * coherent object.
   *
   * So instead of handing every interior point straight to the model:
   * sample the actual pixel color under each candidate, find the majority
   * color cluster (a cheap color-distance filter against the median — the
   * subject is normally what most of a reasonably-centered lasso agrees
   * on), and collapse that cluster down to ONE representative point —
   * its centroid. That single point is what actually gets sent as the
   * keypoint, matching how this model is meant to be driven. */
  /** Deliberately a SINGLE keypoint, never a multi-point scribble — an
   * earlier version also sent 1-2 "supporting" points spread across the
   * lasso to bias the model toward the whole object, but two objects
   * placed right next to each other (a makeup brush and a lipstick lying
   * beside it, say) routinely have similar enough color that a supporting
   * point can land on the WRONG object while still passing a same-color
   * check — and once that point is part of the scribble, the model has no
   * way to know it wasn't supposed to include whatever it's touching.
   * "Capture the whole large object" is instead handled spatially, after
   * the model responds — see InteractiveSegmentationService's
   * constrainToLassoVicinity, which lets the mask fill out the lasso's own
   * extent (plus a margin for natural protrusions) rather than needing
   * extra prompt points that risk spilling onto a neighbor. */
  private async buildSegmentationHint(strokePoints: CanvasPoint[]): Promise<SegmentationHint> {
    const interior = this.sampleInteriorPoints(strokePoints);
    const candidates = interior.length ? interior : strokePoints;
    const center = await this.pickColorConsistentCenter(candidates);
    return this.toNormalizedPoints([center])[0];
  }

  /** Shoelace-formula polygon area of the raw lasso stroke, as a fraction
   * of the mask canvas's total area — used only to sanity-check the AI's
   * returned mask size against what the user actually circled (see
   * InteractiveSegmentationService.keepComponentAtSeed). Returns undefined
   * for a stroke too short to be a real lasso (e.g. a plain tap), since
   * there's no meaningful "area the user circled" to compare against. */
  private computeLassoAreaRatio(strokePoints: CanvasPoint[]): number | undefined {
    if (strokePoints.length < 3) return undefined;
    const canvas = this.maskCanvasRef?.nativeElement;
    if (!canvas || !canvas.width || !canvas.height) return undefined;

    let signedArea = 0;
    for (let i = 0; i < strokePoints.length; i++) {
      const a = strokePoints[i];
      const b = strokePoints[(i + 1) % strokePoints.length];
      signedArea += a.x * b.y - b.x * a.y;
    }
    const area = Math.abs(signedArea) / 2;
    return area / (canvas.width * canvas.height);
  }

  /** A user's lasso is, almost by definition, CENTERED on the thing they
   * meant to select — so the geometric center of the loop is normally
   * already the best possible single point, no color analysis needed.
   *
   * The one case that breaks: a busy/detailed photo where the lasso's exact
   * center happens to fall on an edge, a seam between the subject and
   * something else, or a small unrelated detail. Averaging every
   * color-similar point's POSITION (the previous approach) made this
   * worse, not better, on cluttered images — if the background inside the
   * loop had more small varied details than the subject, the "majority
   * color" cluster could easily be background confetti, and its centroid
   * would drift the point away from the subject entirely.
   *
   * So the fix keeps the center as the default answer, and only overrides
   * it when the center's own color has too little support nearby — in
   * which case it snaps to the CLOSEST sampled point that agrees with the
   * dominant color, rather than averaging positions across the whole
   * cluster. That keeps the result anchored near where the user actually
   * centered their lasso even on a detailed image, instead of sliding
   * toward whichever cluster happens to have more members. */
  private async pickColorConsistentCenter(points: CanvasPoint[]): Promise<CanvasPoint> {
    const geometricCenter = this.centroid(points);
    if (points.length <= 1) return points[0] ?? geometricCenter;

    let sample: { data: Uint8ClampedArray; width: number; height: number };
    try {
      sample = await this.ensureColorSampleData();
    } catch (error) {
      console.error('Color sampling for the lasso hint failed:', error);
      return geometricCenter;
    }
    if (this.destroyed) return geometricCenter;

    const maskCanvas = this.maskCanvasRef?.nativeElement;
    const maskWidth = maskCanvas?.width || 1;
    const maskHeight = maskCanvas?.height || 1;
    const sampleColorAt = (point: CanvasPoint) => {
      const sx = Math.min(sample.width - 1, Math.max(0, Math.round((point.x / maskWidth) * sample.width)));
      const sy = Math.min(sample.height - 1, Math.max(0, Math.round((point.y / maskHeight) * sample.height)));
      const idx = (sy * sample.width + sx) * 4;
      return { r: sample.data[idx], g: sample.data[idx + 1], b: sample.data[idx + 2] };
    };

    const colors = points.map(sampleColorAt);
    const centerColor = sampleColorAt(geometricCenter);
    const tolerance = 45;
    const centerAgreement = colors.filter((color) => this.colorDistance(color, centerColor) <= tolerance).length;
    const minAgreement = Math.max(2, Math.ceil(points.length * 0.2));
    if (centerAgreement >= minAgreement) return geometricCenter;

    // The exact center landed somewhere unrepresentative — find whichever
    // sampled point best balances "close to the center" against "belongs
    // to the photo's dominant color inside the loop".
    const median = this.medianColor(colors);
    let best = geometricCenter;
    let bestScore = Infinity;
    points.forEach((point, index) => {
      const colorPenalty = this.colorDistance(colors[index], median);
      const distancePenalty = Math.hypot(point.x - geometricCenter.x, point.y - geometricCenter.y);
      const score = colorPenalty + distancePenalty * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = point;
      }
    });
    return best;
  }

  private centroid(points: CanvasPoint[]): CanvasPoint {
    if (!points.length) return { x: 0, y: 0 };
    let sumX = 0;
    let sumY = 0;
    for (const point of points) {
      sumX += point.x;
      sumY += point.y;
    }
    return { x: sumX / points.length, y: sumY / points.length };
  }

  private medianColor(colors: { r: number; g: number; b: number }[]): { r: number; g: number; b: number } {
    const rs = colors.map((c) => c.r).sort((a, b) => a - b);
    const gs = colors.map((c) => c.g).sort((a, b) => a - b);
    const bs = colors.map((c) => c.b).sort((a, b) => a - b);
    const mid = Math.floor(colors.length / 2);
    return { r: rs[mid], g: gs[mid], b: bs[mid] };
  }

  private colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  /** A small (max 200px edge), cached-for-the-component's-lifetime copy of
   * the source photo's pixels, used only to sample colors for
   * pickColorConsistentCenter — never used as a segmentation input itself. */
  private colorSampleData: { data: Uint8ClampedArray; width: number; height: number } | null = null;
  private colorSamplePromise: Promise<{ data: Uint8ClampedArray; width: number; height: number }> | null = null;

  private async ensureColorSampleData(): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
    if (this.colorSampleData) return this.colorSampleData;
    this.colorSamplePromise ??= (async () => {
      const bitmap = await createImageBitmap(this.source.blob);
      try {
        const maxEdge = 200;
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Trình duyệt không hỗ trợ Canvas 2D.');
        ctx.drawImage(bitmap, 0, 0, width, height);
        const data = ctx.getImageData(0, 0, width, height).data;
        const result = { data, width, height };
        this.colorSampleData = result;
        return result;
      } finally {
        bitmap.close();
      }
    })();
    return this.colorSamplePromise;
  }

  /** Rasterizes the closed stroke path at low resolution (fast, and all we
   * need is a coarse interior/exterior test) and collects the midpoint of
   * every filled cell, downsampled to a manageable count for the model. */
  private sampleInteriorPoints(strokePoints: CanvasPoint[]): CanvasPoint[] {
    if (strokePoints.length < 3) return [];

    const minX = Math.min(...strokePoints.map((point) => point.x));
    const maxX = Math.max(...strokePoints.map((point) => point.x));
    const minY = Math.min(...strokePoints.map((point) => point.y));
    const maxY = Math.max(...strokePoints.map((point) => point.y));
    const boxWidth = Math.max(1, maxX - minX);
    const boxHeight = Math.max(1, maxY - minY);

    const gridSize = 48;
    const scanCanvas = document.createElement('canvas');
    scanCanvas.width = gridSize;
    scanCanvas.height = gridSize;
    const ctx = scanCanvas.getContext('2d');
    if (!ctx) return [];

    ctx.save();
    ctx.scale(gridSize / boxWidth, gridSize / boxHeight);
    ctx.translate(-minX, -minY);
    ctx.beginPath();
    ctx.moveTo(strokePoints[0].x, strokePoints[0].y);
    for (const point of strokePoints.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();

    const data = ctx.getImageData(0, 0, gridSize, gridSize).data;
    const interior: CanvasPoint[] = [];
    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        if (data[(gy * gridSize + gx) * 4 + 3] === 0) continue;
        interior.push({
          x: minX + ((gx + 0.5) / gridSize) * boxWidth,
          y: minY + ((gy + 0.5) / gridSize) * boxHeight,
        });
      }
    }
    if (!interior.length) return [];

    const maxHintPoints = 24;
    const step = Math.max(1, Math.floor(interior.length / maxHintPoints));
    return interior.filter((_, index) => index % step === 0).slice(0, maxHintPoints);
  }

  /** Turns a just-finished lasso stroke into a segmentation hint (async —
   * it samples pixel colors, see pickColorConsistentCenter) and runs it.
   * Kept as its own step so a failure building the hint itself (rather than
   * the AI call) still surfaces as a normal error instead of an unhandled
   * rejection. */
  private async handleSmartStroke(strokePoints: CanvasPoint[]): Promise<void> {
    try {
      const hint = await this.buildSegmentationHint(strokePoints);
      if (this.destroyed) return;
      const lassoAreaRatio = this.computeLassoAreaRatio(strokePoints);
      const lassoPolygon = strokePoints.length >= 3 ? this.toNormalizedPoints(strokePoints) : undefined;
      await this.processSmartSelection(hint, lassoAreaRatio, lassoPolygon);
    } catch (error) {
      console.error('Failed to build a segmentation hint from the lasso:', error);
      if (!this.destroyed) {
        this.error.set('Không thể xử lý vùng vừa khoanh. Vui lòng thử lại.');
      }
    }
  }

  private async processSmartSelection(
    hint: SegmentationHint,
    lassoAreaRatio?: number,
    lassoPolygon?: SegmentationPoint[],
  ): Promise<void> {
    this.lastHint = hint;
    this.lastLassoAreaRatio = lassoAreaRatio;
    this.lastLassoPolygon = lassoPolygon;
    this.hasSelection.set(true);
    const id = ++this.requestId;
    this.processing.set(true);
    this.error.set(null);
    this.progress.set(0);
    this.smartCutoutResult = null;
    if (this.smartCutoutUrl) {
      URL.revokeObjectURL(this.smartCutoutUrl);
      this.smartCutoutUrl = null;
      this.previewUrl.set(null);
    }

    try {
      const result = await this.provider.selectObject(
        this.source.blob,
        hint,
        (progress) => {
          if (!this.destroyed && id === this.requestId) this.progress.set(Math.round(progress * 100));
        },
        { lassoAreaRatio, lassoPolygon },
      );
      if (this.destroyed || id !== this.requestId) return;
      this.smartCutoutResult = result;
      this.smartCutoutUrl = URL.createObjectURL(result.blob);
      this.previewUrl.set(this.smartCutoutUrl);
      await this.drawSmartMaskGlow(result.blob);
    } catch (error) {
      console.error('Interactive object segmentation failed:', error);
      if (this.destroyed || id !== this.requestId) return;
      if (error instanceof UncertainSegmentationError) {
        // Retrying with the SAME hint would just reproduce the same
        // rejection — reset back to "draw a lasso" instead of offering a
        // "Thử lại" that can't actually help.
        this.hasSelection.set(false);
        this.lastHint = null;
        this.error.set(error.message);
        return;
      }
      const message = error instanceof Error ? error.message : '';
      this.error.set(
        message.includes('Không tìm thấy vật thể')
          ? message
          : 'Không thể nhận diện vật thể. Hãy kiểm tra mạng rồi nhấn thử lại hoặc tô lại vùng khác.',
      );
    } finally {
      if (!this.destroyed && id === this.requestId) this.processing.set(false);
    }
  }

  /** Repaints the shared mask/highlight canvases from the AI's own result
   * mask (its alpha channel — RGB is discarded and replaced with a flat
   * accent tint) and reuses the exact same redrawHighlight() glow pass the
   * brush uses: a blurred bleed past the silhouette plus a carved-out
   * interior, reading as a soft light hugging the recognized object rather
   * than a hard outline. This is what makes the modes feel like one
   * consistent tool instead of different visual languages. */
  private async drawSmartMaskGlow(cutoutBlob: Blob): Promise<void> {
    const maskCanvas = this.maskCanvasRef?.nativeElement;
    const maskCtx = this.maskCtx;
    if (!maskCanvas || !maskCtx) return;

    const bitmap = await createImageBitmap(cutoutBlob);
    try {
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      maskCtx.globalCompositeOperation = 'source-over';
      maskCtx.drawImage(bitmap, 0, 0, maskCanvas.width, maskCanvas.height);
      maskCtx.globalCompositeOperation = 'source-in';
      maskCtx.fillStyle = 'rgba(139, 44, 255, 1)';
      maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
      maskCtx.globalCompositeOperation = 'source-over';
    } finally {
      bitmap.close();
    }
    this.redrawHighlight();
  }

  // ---------------------------------------------------------------------
  // Brush mode: manually paint the region(s) to keep.
  // ---------------------------------------------------------------------

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
    // Kept so redrawHighlight() can paint the photo itself through the mask —
    // that is what makes the selected region read as focused rather than as a
    // coloured blob sitting on top of it.
    this.loadedImage = img;
    this.hasPainted.set(false);
    this.imageReady.set(true);
  }

  /** Converts a pointer event into mask-canvas backing-pixel coordinates —
   * delegates to the shared, zoom/pan-agnostic CoordinateTransformer (see
   * coordinate-transformer.ts for why reading the canvas's live rendered
   * rect makes this correct regardless of any CSS transform applied to an
   * ancestor for zoom/pan). */
  private toCanvasPoint(event: PointerEvent): CanvasPoint | null {
    const canvas = this.maskCanvasRef?.nativeElement;
    if (!canvas) return null;
    return screenPointToCanvasPixel(
      event.clientX,
      event.clientY,
      canvas.getBoundingClientRect(),
      canvas.width,
      canvas.height,
    );
  }

  onCanvasPointerDown(event: PointerEvent): void {
    if (this.panMode()) {
      this.startPan(event);
      return;
    }
    if (this.adding() || this.preparingWhole() || this.regionBusy() || !this.maskCtx) return;
    if (this.mode() === 'smart' && this.processing()) return;
    const point = this.toCanvasPoint(event);
    if (!point) return;
    event.preventDefault();
    this.activePointerId = event.pointerId;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.isDrawing = true;
    this.error.set(null);

    if (this.mode() === 'smart') {
      this.scribblePoints = [point];
      this.drawScribblePreview();
      return;
    }

    if (this.mode() === 'region') {
      this.regionStrokePoints = [point];
      this.drawRegionStrokePreview();
      return;
    }

    this.lastPoint = null;
    this.strokeTo(point);
  }

  onCanvasPointerMove(event: PointerEvent): void {
    if (this.isPanning) {
      this.continuePan(event);
      return;
    }
    if (!this.isDrawing || event.pointerId !== this.activePointerId) return;
    const point = this.toCanvasPoint(event);
    if (!point) return;
    event.preventDefault();

    if (this.mode() === 'smart') {
      this.pushStrokePoint(this.scribblePoints, point);
      this.drawScribblePreview();
      return;
    }

    if (this.mode() === 'region') {
      this.pushStrokePoint(this.regionStrokePoints, point);
      this.drawRegionStrokePreview();
      return;
    }

    this.strokeTo(point);
  }

  onCanvasPointerUp(event: PointerEvent): void {
    if (this.isPanning && event.pointerId === this.panPointerId) {
      this.endPan(event);
      return;
    }
    if (event.pointerId !== this.activePointerId) return;
    this.isDrawing = false;
    this.activePointerId = null;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);

    if (this.mode() === 'smart') {
      const points = this.scribblePoints;
      this.scribblePoints = [];
      this.drawScribblePreview();
      if (points.length) void this.handleSmartStroke(points);
      return;
    }

    if (this.mode() === 'region') {
      const points = this.regionStrokePoints;
      this.regionStrokePoints = [];
      this.clearHighlightOverlay();
      this.renderRegionMaskGlow();
      if (points.length) void this.growRegionFromStroke(points);
      return;
    }

    this.lastPoint = null;
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

  /** Rebuilds the visible highlight from scratch out of the authoritative mask,
   * every stroke — so it is always topologically correct for whatever shape has
   * been painted so far (any number of separate blobs), never an approximation
   * stitched together incrementally.
   *
   * What it paints is the PHOTO ITSELF, clipped to the mask:
   *  1. draw the mask (alpha only matters),
   *  2. 'source-in' + draw the photo — keeping photo pixels only where the mask
   *     was opaque.
   *
   * The result sits over a blurred, desaturated copy of the same photo (see
   * .source-image in the stylesheet), so the selection reads as the one part in
   * focus and everything else falls back. That is the inverse of what this used
   * to do: it drew the mask as a ~75%-opaque tint, which covered the subject in
   * a flat colour blob — you could see the shape you had selected but not the
   * thing you were selecting, which is the one thing that matters here. */
  private redrawHighlight(): void {
    const mask = this.maskCanvasRef?.nativeElement;
    const hctx = this.highlightCtx;
    const photo = this.loadedImage;
    if (!mask || !hctx) return;
    const { width, height } = mask;
    hctx.clearRect(0, 0, width, height);

    hctx.save();
    hctx.drawImage(mask, 0, 0);
    if (photo?.naturalWidth) {
      hctx.globalCompositeOperation = 'source-in';
      hctx.drawImage(photo, 0, 0, width, height);
    }
    hctx.restore();
  }

  private clearHighlightOverlay(): void {
    const canvas = this.highlightCanvasRef?.nativeElement;
    const ctx = this.highlightCtx;
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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

  // ---------------------------------------------------------------------
  // Smart Mask mode (a.k.a. Smart Brush Selection): paint a rough seed
  // stroke over an object; a local, dependency-free edge-aware region
  // growing engine (see RegionGrowingSelectionEngine, wired in through the
  // SelectionEngine DI token) expands that seed outward through
  // similar-colored, non-edge pixels to approximate the object's boundary.
  // Distinct from "Cắt thông minh" (which asks an ML model) and "Tô chọn"
  // (which keeps the literal painted pixels) — this is the requested
  // "Smart Brush Selection / Smart Mask" tool: Add/Subtract, undo/redo,
  // Preview Cut, Apply, all backed by a persistent selection mask.
  // ---------------------------------------------------------------------

  setRegionOp(op: RegionOp): void {
    this.regionOp.set(op);
  }

  setRegionBrushRadius(radius: number): void {
    this.regionBrushRadius.set(
      Math.max(MIN_REGION_BRUSH_RADIUS, Math.min(MAX_REGION_BRUSH_RADIUS, Math.round(radius))),
    );
  }

  /** Live feedback while dragging — just the raw seed stroke, no growing.
   * Region growing is deliberately deferred to pointerup (see
   * growRegionFromStroke) so a fast drag never triggers the flood-fill
   * algorithm on every pointermove. */
  private drawRegionStrokePreview(): void {
    const ctx = this.highlightCtx;
    if (!ctx) return;

    // Redraw the committed selection's glow first, then the in-progress
    // stroke on top of it — so the user sees both the existing selection
    // and exactly what they're currently adding/removing before it's grown.
    this.renderRegionMaskGlow();
    if (this.regionStrokePoints.length === 0) return;

    const subtracting = this.regionOp() === 'subtract';
    ctx.save();
    ctx.globalCompositeOperation = subtracting ? 'destination-out' : 'source-over';
    ctx.strokeStyle = subtracting ? 'rgba(255, 255, 255, 0.55)' : 'rgba(139, 44, 255, 0.55)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = this.regionBrushRadius() * 2;
    ctx.beginPath();
    ctx.moveTo(this.regionStrokePoints[0].x, this.regionStrokePoints[0].y);
    for (const point of this.regionStrokePoints.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.restore();
  }

  /** Lazily builds (and caches for the component's lifetime) a downscaled
   * copy of the source photo to run region growing against, plus a
   * same-sized, all-zero selection mask on first use. Downscaling here —
   * rather than growing at full resolution — is what keeps a stroke's
   * processing time bounded regardless of the source photo's actual size. */
  private async ensureWorkingImage(): Promise<SelectionEngineImage> {
    if (this.workingImage) return this.workingImage;
    this.workingImagePromise ??= (async () => {
      const bitmap = await createImageBitmap(this.source.blob);
      try {
        const scale = Math.min(1, REGION_WORKING_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Trình duyệt không hỗ trợ Canvas 2D.');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, width, height);
        const data = ctx.getImageData(0, 0, width, height).data;
        const image: SelectionEngineImage = { data, width, height };
        this.workingImage = image;
        this.regionMask = new Uint8Array(width * height);
        return image;
      } finally {
        bitmap.close();
      }
    })();
    return this.workingImagePromise;
  }

  /** Rasterizes a brush stroke (canvas-space points, at mask-canvas
   * resolution) into a seed mask at the working image's resolution — thick
   * line segments plus end caps, same technique as strokeTo(), just scaled
   * down and targeting a plain alpha buffer instead of the visible canvas. */
  /** Converts a brush stroke's canvas-space points (mask-canvas resolution)
   * into a BrushHint expressed in the working image's own pixel space —
   * the "same pixel space as the accompanying SelectionEngineImage" every
   * SelectionHint is defined to use. */
  private buildRegionBrushHint(strokePoints: CanvasPoint[], working: SelectionEngineImage): BrushHint {
    const maskCanvas = this.maskCanvasRef?.nativeElement;
    const scaleX = working.width / (maskCanvas?.width || working.width);
    const scaleY = working.height / (maskCanvas?.height || working.height);
    return {
      type: 'brush',
      points: strokePoints.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY })),
      radius: Math.max(1, this.regionBrushRadius() * scaleX),
    };
  }

  private rasterizeSeed(strokePoints: CanvasPoint[], working: SelectionEngineImage): Uint8Array {
    return rasterizeHint(this.buildRegionBrushHint(strokePoints, working), working.width, working.height);
  }

  /** The one place the actual region-growing algorithm runs — deferred
   * until the stroke ends (see onCanvasPointerUp), never during
   * pointermove, so dragging stays perfectly smooth regardless of photo
   * size or algorithm cost. */
  private async growRegionFromStroke(strokePoints: CanvasPoint[]): Promise<void> {
    this.regionBusy.set(true);
    this.error.set(null);
    try {
      const working = await this.ensureWorkingImage();
      if (this.destroyed) return;
      const currentMask = this.regionMask ?? new Uint8Array(working.width * working.height);

      // The FIRST stroke of a session (nothing selected yet, and the user
      // isn't subtracting from nothing) is target DETECTION — "what object
      // does the user mean" — routed through SmartCutEngine rather than the
      // incremental SelectionEngine ops. Today both resolve to the same
      // local algorithm, but this is the seam a future AI segmentation
      // backend would plug into: it could give whole-object detection real
      // semantic awareness on this path while Add/Subtract edits keep using
      // local growing, without any UI change.
      let grown: Uint8Array;
      if (this.regionOp() === 'add' && !this.hasRegionSelection()) {
        const hint = this.buildRegionBrushHint(strokePoints, working);
        const detected = await this.smartCutEngine.detectTarget(working, hint);
        grown = detected.data;
      } else {
        const seedMask = this.rasterizeSeed(strokePoints, working);
        grown =
          this.regionOp() === 'add'
            ? await this.selectionEngine.addRegion({ mask: seedMask }, working, currentMask)
            : await this.selectionEngine.subtractRegion({ mask: seedMask }, working, currentMask);
      }
      if (this.destroyed) return;

      const cleaned = cleanupMask(grown, working.width, working.height);
      this.regionHistory.recordBeforeStroke(currentMask);
      this.regionMask = cleaned;
      this.updateRegionHistorySignals();

      let hasAny = false;
      for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i]) {
          hasAny = true;
          break;
        }
      }
      this.hasRegionSelection.set(hasAny);
      this.renderRegionMaskGlow();
    } catch (error) {
      console.error('Region growing failed:', error);
      if (!this.destroyed) {
        this.error.set('Không thể mở rộng vùng chọn. Vui lòng thử tô lại.');
      }
    } finally {
      if (!this.destroyed) this.regionBusy.set(false);
    }
  }

  /** Upscales the working-resolution selection mask onto the shared
   * mask/highlight canvases (same accent tint as the other two modes) and
   * reuses redrawHighlight() for the identical soft-glow look. Nearest/
   * bilinear upscaling here is cosmetic only — the authoritative mask stays
   * at working resolution until Apply/Preview map it back up properly (see
   * buildRegionCutout). */
  private renderRegionMaskGlow(): void {
    const maskCanvas = this.maskCanvasRef?.nativeElement;
    const maskCtx = this.maskCtx;
    const working = this.workingImage;
    const regionMask = this.regionMask;
    if (!maskCanvas || !maskCtx) return;

    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    if (!working || !regionMask) {
      this.redrawHighlight();
      return;
    }

    const scratch = document.createElement('canvas');
    scratch.width = working.width;
    scratch.height = working.height;
    const scratchCtx = scratch.getContext('2d');
    if (!scratchCtx) return;
    const imageData = scratchCtx.createImageData(working.width, working.height);
    for (let i = 0; i < regionMask.length; i++) {
      const p = i * 4;
      imageData.data[p] = 139;
      imageData.data[p + 1] = 44;
      imageData.data[p + 2] = 255;
      imageData.data[p + 3] = regionMask[i];
    }
    scratchCtx.putImageData(imageData, 0, 0);

    maskCtx.imageSmoothingEnabled = true;
    maskCtx.imageSmoothingQuality = 'high';
    maskCtx.drawImage(scratch, 0, 0, maskCanvas.width, maskCanvas.height);
    this.redrawHighlight();
  }

  private updateRegionHistorySignals(): void {
    this.canUndoRegion.set(this.regionHistory.canUndo);
    this.canRedoRegion.set(this.regionHistory.canRedo);
  }

  undoRegion(): void {
    if (!this.regionMask) return;
    const previous = this.regionHistory.undo(this.regionMask);
    if (!previous) return;
    this.regionMask = previous;
    this.updateRegionHistorySignals();
    this.hasRegionSelection.set(previous.some((value) => value !== 0));
    this.renderRegionMaskGlow();
  }

  redoRegion(): void {
    if (!this.regionMask) return;
    const next = this.regionHistory.redo(this.regionMask);
    if (!next) return;
    this.regionMask = next;
    this.updateRegionHistorySignals();
    this.hasRegionSelection.set(next.some((value) => value !== 0));
    this.renderRegionMaskGlow();
  }

  /** "Clear Selection" — resets the mask but keeps the source image and
   * undo history intact (recorded as one more undoable step, not a history
   * wipe), matching the plain brush mode's clearMask(). */
  clearRegionSelection(): void {
    if (!this.regionMask || this.regionBusy()) return;
    this.regionHistory.recordBeforeStroke(this.regionMask);
    this.regionMask = new Uint8Array(this.regionMask.length);
    this.updateRegionHistorySignals();
    this.hasRegionSelection.set(false);
    this.error.set(null);
    this.renderRegionMaskGlow();
  }

  /** Preview Cut — shows the transparent cutout without leaving the tool or
   * touching the underlying mask, so toggling back returns to editing with
   * the selection fully intact (Test F). */
  async toggleRegionPreview(): Promise<void> {
    if (this.regionPreviewActive()) {
      this.regionPreviewActive.set(false);
      if (this.regionPreviewObjectUrl) {
        URL.revokeObjectURL(this.regionPreviewObjectUrl);
        this.regionPreviewObjectUrl = null;
      }
      this.regionPreviewUrl.set(null);
      return;
    }

    if (!this.hasRegionSelection() || this.regionBusy()) return;
    this.regionBusy.set(true);
    this.error.set(null);
    try {
      const { canvas } = await this.buildRegionCutout(false);
      const blob = await this.canvasToBlob(canvas);
      if (this.destroyed) return;
      if (this.regionPreviewObjectUrl) URL.revokeObjectURL(this.regionPreviewObjectUrl);
      this.regionPreviewObjectUrl = URL.createObjectURL(blob);
      this.regionPreviewUrl.set(this.regionPreviewObjectUrl);
      this.regionPreviewActive.set(true);
    } catch (error) {
      console.error('Failed to build the selection preview:', error);
      if (!this.destroyed) this.error.set('Không thể xem trước vùng cắt. Vui lòng thử lại.');
    } finally {
      if (!this.destroyed) this.regionBusy.set(false);
    }
  }

  /** Composites the source image against the selection mask, upscaled from
   * working resolution to the same output resolution the other two modes
   * use — outputAlpha = originalAlpha × selectionMask, exactly as spec'd.
   * `feather` softens the mask's edges by ~1.5px (final export only; the
   * interactive mask itself stays binary so undo/redo and re-editing stay
   * exact) then crops to the mask's own bounding box. */
  /** The Smart Cut export pipeline — this is what makes it "object-aware
   * cut", not "smart crop": bounds are computed from the MASK (never the
   * other way around), and every pixel in the final PNG comes from a 1:1,
   * unscaled copy of the ORIGINAL photo — never from the downscaled working
   * copy detection ran against, never from any preview/canvas resolution.
   *
   *   working-resolution mask
   *     → bounds (+ margin for edge-snap, + padding for the final crop)
   *     → mapped to ORIGINAL-image pixel coordinates (workingToOriginal)
   *     → crop that rectangle directly out of the original bitmap (no
   *       scaling: source rect size === dest rect size)
   *     → nearest-neighbor upscale the coarse mask into that same crop
   *       (never bilinear — see upscaleMaskNearest for why)
   *     → SmartCutEngine.refineMask: re-grow at FULL resolution, band-
   *       limited to the coarse boundary, using the crop's real pixels —
   *       this is what recovers detail the working resolution missed
   *     → cleanupMask (drop noise / fill pinholes) + light feather (export
   *       only — never touches the interactive mask) → destination-in
   *
   * Because everything above only ever touches the small crop — never the
   * full original canvas — this stays fast even on a 4000×3000 photo. */
  private async buildRegionCutout(feather: boolean): Promise<{ canvas: HTMLCanvasElement }> {
    const working = this.workingImage;
    const regionMask = this.regionMask;
    if (!working || !regionMask) throw new Error('Chưa có vùng chọn nào.');

    const bounds = maskBounds(regionMask, working.width, working.height);
    if (!bounds) throw new Error('Chưa có vùng chọn nào.');

    const bitmap = await createImageBitmap(this.source.blob);
    try {
      const scaleX = bitmap.width / working.width;
      const scaleY = bitmap.height / working.height;
      const margin = REGION_REFINE_MARGIN_WORKING_PX;

      const topLeft = workingToOriginal(
        { x: bounds.minX - margin, y: bounds.minY - margin },
        working.width,
        working.height,
        bitmap.width,
        bitmap.height,
      );
      const bottomRight = workingToOriginal(
        { x: bounds.maxX + margin + 1, y: bounds.maxY + margin + 1 },
        working.width,
        working.height,
        bitmap.width,
        bitmap.height,
      );

      const cropX = Math.max(0, Math.floor(topLeft.x) - REGION_CROP_PADDING_PX);
      const cropY = Math.max(0, Math.floor(topLeft.y) - REGION_CROP_PADDING_PX);
      const cropRight = Math.min(bitmap.width, Math.ceil(bottomRight.x) + REGION_CROP_PADDING_PX);
      const cropBottom = Math.min(bitmap.height, Math.ceil(bottomRight.y) + REGION_CROP_PADDING_PX);
      const cropWidth = Math.max(1, cropRight - cropX);
      const cropHeight = Math.max(1, cropBottom - cropY);

      // Straight 1:1 pixel copy out of the ORIGINAL bitmap — source and
      // destination rects are the same size, so there is no scaling and
      // therefore no resampling blur no matter how large the source photo is.
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = cropWidth;
      cropCanvas.height = cropHeight;
      const cropCtx = cropCanvas.getContext('2d', { alpha: true, willReadFrequently: true });
      if (!cropCtx) throw new Error('Trình duyệt không hỗ trợ Canvas 2D.');
      cropCtx.drawImage(bitmap, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      const cropImageData = cropCtx.getImageData(0, 0, cropWidth, cropHeight);

      let cropMask = upscaleMaskNearest(
        regionMask,
        working.width,
        working.height,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        scaleX,
        scaleY,
      );

      const refined = await this.smartCutEngine.refineMask(
        { data: cropImageData.data, width: cropWidth, height: cropHeight },
        { data: cropMask, width: cropWidth, height: cropHeight },
      );
      cropMask = cleanupMask(refined.data, cropWidth, cropHeight);

      const finalAlpha = feather ? featherMask(cropMask, cropWidth, cropHeight, 1) : cropMask;
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = cropWidth;
      maskCanvas.height = cropHeight;
      const maskCtx = maskCanvas.getContext('2d');
      if (!maskCtx) throw new Error('Trình duyệt không hỗ trợ Canvas 2D.');
      const maskImageData = maskCtx.createImageData(cropWidth, cropHeight);
      for (let i = 0; i < finalAlpha.length; i++) {
        const p = i * 4;
        maskImageData.data[p] = 255;
        maskImageData.data[p + 1] = 255;
        maskImageData.data[p + 2] = 255;
        maskImageData.data[p + 3] = finalAlpha[i];
      }
      maskCtx.putImageData(maskImageData, 0, 0);

      // finalAlpha = originalAlpha × selectionMask — the crop's own pixels
      // are drawn as-is (no destination-in with a photo that has no alpha
      // of its own would be a no-op anyway), then destination-in applies
      // the mask's alpha channel as the sole source of transparency.
      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = cropWidth;
      outputCanvas.height = cropHeight;
      const outputCtx = outputCanvas.getContext('2d', { alpha: true });
      if (!outputCtx) throw new Error('Trình duyệt không hỗ trợ Canvas 2D.');
      outputCtx.putImageData(cropImageData, 0, 0);
      outputCtx.globalCompositeOperation = 'destination-in';
      outputCtx.drawImage(maskCanvas, 0, 0);
      outputCtx.globalCompositeOperation = 'source-over';

      return this.cropToPaintedBounds(outputCanvas, outputCtx);
    } finally {
      bitmap.close();
    }
  }

  private canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('Không thể tạo ảnh.'))),
        'image/png',
        1,
      );
    });
  }

  private async addRegionCutout(): Promise<void> {
    if (!this.hasRegionSelection()) return;
    this.adding.set(true);
    this.error.set(null);
    try {
      const { canvas } = await this.buildRegionCutout(true);
      const blob = await this.canvasToBlob(canvas);
      if (this.destroyed) return;
      this.cutoutAdded.emit({ blob, width: canvas.width, height: canvas.height });
    } catch (error) {
      console.error('Failed to composite the smart-mask cutout:', error);
      if (!this.destroyed) {
        this.adding.set(false);
        this.error.set('Không thể tạo phần cắt từ vùng chọn. Vui lòng thử lại.');
      }
    }
  }

  // ---------------------------------------------------------------------
  // Zoom / pan — shared preview-stage viewport.
  // ---------------------------------------------------------------------

  zoomIn(): void {
    this.setZoom(this.zoom() + ZOOM_STEP);
  }

  zoomOut(): void {
    this.setZoom(this.zoom() - ZOOM_STEP);
  }

  resetZoom(): void {
    this.zoom.set(MIN_ZOOM);
    this.panX.set(0);
    this.panY.set(0);
    this.panMode.set(false);
  }

  togglePanMode(): void {
    if (this.zoom() <= MIN_ZOOM) return;
    this.panMode.set(!this.panMode());
  }

  onPreviewWheel(event: WheelEvent): void {
    event.preventDefault();
    this.setZoom(this.zoom() + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  }

  private setZoom(value: number): void {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(value * 4) / 4));
    this.zoom.set(clamped);
    if (clamped <= MIN_ZOOM) {
      this.panX.set(0);
      this.panY.set(0);
      this.panMode.set(false);
    }
  }

  private startPan(event: PointerEvent): void {
    if (this.zoom() <= MIN_ZOOM) return;
    event.preventDefault();
    this.isPanning = true;
    this.panPointerId = event.pointerId;
    this.panStart = { x: event.clientX, y: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  private continuePan(event: PointerEvent): void {
    if (event.pointerId !== this.panPointerId || !this.panStart) return;
    event.preventDefault();
    const dx = event.clientX - this.panStart.x;
    const dy = event.clientY - this.panStart.y;
    this.panStart = { x: event.clientX, y: event.clientY };
    // Loose bound (proportional to how far zoomed in we are) — this is a
    // usability guard against dragging the photo absurdly far off-screen,
    // NOT what keeps painting/selection accurate under zoom: that accuracy
    // comes entirely from screenPointToCanvasPixel reading the canvas's
    // live rect, regardless of how much pan/zoom transform produced it.
    const bound = (this.zoom() - 1) * 240;
    this.panX.set(Math.max(-bound, Math.min(bound, this.panX() + dx)));
    this.panY.set(Math.max(-bound, Math.min(bound, this.panY() + dy)));
  }

  private endPan(event: PointerEvent): void {
    this.isPanning = false;
    this.panPointerId = null;
    this.panStart = null;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  // ---------------------------------------------------------------------
  // Shared across all modes.
  // ---------------------------------------------------------------------

  async selectAll(): Promise<void> {
    if (this.processing() || this.adding() || this.preparingWhole() || this.regionBusy()) return;
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

  async addCutout(): Promise<void> {
    if (this.processing() || this.adding() || this.preparingWhole() || this.regionBusy()) return;

    if (this.mode() === 'smart') {
      if (!this.smartCutoutResult) return;
      this.adding.set(true);
      this.cutoutAdded.emit(this.smartCutoutResult);
      return;
    }

    if (this.mode() === 'region') {
      await this.addRegionCutout();
      return;
    }

    await this.addPaintedCutout();
  }

  /** Composites the source image with the painted mask as its alpha channel:
   * the image is drawn first, then 'destination-in' keeps only the pixels
   * the mask has alpha at (i.e. what the user painted) and clears everything
   * else to fully transparent — exactly the painted shape, nothing more. */
  private async addPaintedCutout(): Promise<void> {
    if (!this.hasPainted()) return;
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
