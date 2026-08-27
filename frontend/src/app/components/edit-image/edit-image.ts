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
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../core/services/toast';

export type EditToolId = 'download' | 'sticker' | 'draw' | 'text' | 'effects';

// Longest edge of the exported image, in px — caps memory / encode time on huge photos.
const EXPORT_MAX_EDGE = 2560;
// Text layers render at a fixed 28px in the editor (`.eim-tl-text`); scaled up for export.
const EDITOR_TEXT_PX = 28;
const CANVAS_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const EMOJI_FONT_STACK =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

export type BrushType = 'pen' | 'marker' | 'neon' | 'eraser';

export interface TextLayer {
  id: string;
  text: string;
  color: string;
  // Centre of the layer as a percentage of the image frame, so it survives any
  // display size and can be re-projected onto the full-res image at publish time.
  xPct: number;
  yPct: number;
}

export interface DrawStroke {
  brush: BrushType;
  color: string; // ignored for the eraser
  // Line width as a fraction of the frame width — resolution-independent, like the points.
  size: number;
  // Path points, each normalised 0..1 within the image frame.
  points: { x: number; y: number }[];
}

export interface StickerLayer {
  id: string;
  emoji: string;
  // Centre of the sticker, as a percentage of the image frame.
  xPct: number;
  yPct: number;
  // Rendered size (font-size), as a percentage of the frame width — resolution independent.
  sizePct: number;
}

export interface EditResult {
  // The flattened image (original + every overlay), ready to use as the pin photo.
  file: File;
  textLayers: TextLayer[];
  drawStrokes: DrawStroke[];
  stickerLayers: StickerLayer[];
}

export interface TextColorOption {
  name: string;
  value: string;
}

const TEXT_COLORS: TextColorOption[] = [
  { name: 'Vàng', value: '#FFD84D' },
  { name: 'Cam', value: '#FF8A3D' },
  { name: 'Hồng', value: '#FF3D77' },
  { name: 'Tím', value: '#A24DFF' },
  { name: 'Xanh dương', value: '#3D9BFF' },
  { name: 'Xanh lá', value: '#3DD68C' },
  { name: 'Đen', value: '#000000' },
  { name: 'Trắng', value: '#FFFFFF' }
];

// Stroke width per brush, as a fraction of the frame width.
const BRUSH_SIZE: Record<BrushType, number> = {
  pen: 0.012,
  marker: 0.045,
  neon: 0.022,
  eraser: 0.06
};

const DRAG_THRESHOLD_PX = 4;

// A basic sticker set — plain emoji, no external assets needed.
const STICKER_EMOJIS: string[] = [
  '❤️', '🔥', '✨', '⭐', '🌟', '💯', '🎉', '🎊',
  '👑', '💖', '💕', '💘', '😍', '🥰', '😎', '🤩',
  '😂', '🥳', '😘', '🤪', '😅', '🙃', '😭', '🥹',
  '👍', '👏', '🙌', '🤙', '✌️', '🤟', '💪', '🫶',
  '🐶', '🐱', '🐰', '🐻', '🦋', '🌸', '🌺', '🌈',
  '☀️', '🌙', '⚡', '❄️', '💫', '🍕', '🍔', '🍦',
  '🍩', '🧁', '☕', '🍿', '📸', '🎵', '💬', '💭'
];

const STICKER_MIN_PCT = 6;
const STICKER_MAX_PCT = 70;
const STICKER_DEFAULT_PCT = 18;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

@Component({
  selector: 'app-edit-image',
  imports: [CommonModule],
  templateUrl: './edit-image.html',
  styleUrl: './edit-image.scss'
})
export class EditImageComponent implements AfterViewInit, OnDestroy {
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private toast = inject(ToastService);

  @ViewChild('drawCanvas') private drawCanvasRef?: ElementRef<HTMLCanvasElement>;

  // The images picked in the "Tạo bài viết mới" modal, at their original size (no crop).
  // Only the first one is shown on the canvas for now — this screen is layout-only;
  // per-image editing / the multi-image tray come later.
  @Input() set files(list: File[]) {
    this.revokeUrl();
    const first = list?.[0];
    this.sourceType = first?.type || 'image/png';
    this.imageUrl.set(first ? URL.createObjectURL(first) : null);
  }

  private sourceType = 'image/png';

  // Emits the text layers + free-hand strokes so the publish step can composite them
  // onto the image.
  @Output() next = new EventEmitter<EditResult>();
  @Output() back = new EventEmitter<void>();

  public imageUrl = signal<string | null>(null);
  public downloading = signal(false);
  // True while "Tiếp" is flattening the layers before handing the image back.
  public exporting = signal(false);

  public readonly textColors = TEXT_COLORS;

  public layers = signal<TextLayer[]>([]);
  public selectedId = signal<string | null>(null);
  public editingId = signal<string | null>(null);

  public selectedLayer = computed(
    () => this.layers().find((l) => l.id === this.selectedId()) ?? null
  );

  // ---- Free-hand drawing ----
  public drawing = signal(false);
  public brush = signal<BrushType>('pen');
  public drawColor = signal<string>('#FFFFFF');
  public strokes = signal<DrawStroke[]>([]);

  public readonly brushes: { id: BrushType; tooltip: string }[] = [
    { id: 'pen', tooltip: 'Bút thường' },
    { id: 'marker', tooltip: 'Bút dạ' },
    { id: 'neon', tooltip: 'Bút phát sáng' },
    { id: 'eraser', tooltip: 'Tẩy' }
  ];

  private liveStroke: DrawStroke | null = null;
  private redrawScheduled = false;

  // The colour palette is shared: it edits the selected text layer, or the pen colour while
  // drawing (hidden for the eraser, which needs no colour).
  public paletteVisible = computed(
    () => !!this.selectedId() || (this.drawing() && this.brush() !== 'eraser')
  );

  // ---- Stickers ----
  public readonly stickerEmojis = STICKER_EMOJIS;
  public stickers = signal<StickerLayer[]>([]);
  public stickerPanelOpen = signal(false);
  // ---- Effects: brightness / contrast / saturation, applied to the base photo only ----
  public brightness = signal(100);
  public contrast = signal(100);
  public saturation = signal(100);
  public effectsPanelOpen = signal(false);
  public imageFilter = computed(
    () => `brightness(${this.brightness()}%) contrast(${this.contrast()}%) saturate(${this.saturation()}%)`
  );
  // Live width of the image frame in px — stickers store their size as a % of it, so we
  // need this to convert back to a font-size. Refreshed on load / resize.
  public frameWidth = signal(0);

  public selectedSticker = computed(
    () => this.stickers().find((s) => s.id === this.selectedId()) ?? null
  );

  private stickerSeq = 0;
  // Resize-handle drag bookkeeping.
  private resizeState: { id: string; cx: number; cy: number; startDist: number; startSize: number } | null =
    null;

  // ---- drag bookkeeping (text + sticker layers) ----
  private dragId: string | null = null;
  private dragMoved = false;
  private dragStart = { x: 0, y: 0, layerX: 0, layerY: 0 };

  constructor() {
    // Repaint the stroke canvas whenever the committed stroke list changes (draw, undo,
    // finish). The in-progress stroke is painted separately, on each pointer move.
    effect(() => {
      this.strokes();
      this.redraw();
    });
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.syncCanvasSize();
      this.measureFrame();
    });
  }

  ngOnDestroy(): void {
    this.revokeUrl();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.syncCanvasSize();
    this.measureFrame();
  }

  onImageLoad(): void {
    this.syncCanvasSize();
    this.measureFrame();
  }

  private measureFrame(): void {
    const w = this.frameEl()?.getBoundingClientRect().width ?? 0;
    if (w > 0) this.frameWidth.set(w);
  }

  // ---- Discard-changes confirmation (shown every time back/close is pressed) ----
  public showDiscardDialog = signal(false);

  onBack(): void {
    this.commitEditing();
    this.showDiscardDialog.set(true);
  }

  onKeepEditing(): void {
    this.showDiscardDialog.set(false);
  }

  onDiscardChanges(): void {
    this.showDiscardDialog.set(false);
    this.layers.set([]);
    this.strokes.set([]);
    this.stickers.set([]);
    this.selectedId.set(null);
    this.editingId.set(null);
    if (this.drawing()) {
      this.liveStroke = null;
      this.drawing.set(false);
    }
    this.back.emit();
  }

  async onNext(): Promise<void> {
    if (this.exporting()) return;
    this.commitEditing();
    if (this.drawing()) this.finishDrawing();
    this.stickerPanelOpen.set(false);
    this.exporting.set(true);
    try {
      // Same flatten as the download button — kept in memory as a File instead of saved.
      // With no overlays this is just the original image re-encoded, which is fine.
      const isJpeg = this.sourceType === 'image/jpeg';
      const blob = await this.compositeToBlob(isJpeg);
      const ext = isJpeg ? 'jpg' : 'png';
      const file = new File([blob], `pinhub-chinh-sua-${Date.now()}.${ext}`, {
        type: blob.type
      });
      this.next.emit({
        file,
        // Never hand an empty text layer to the publish step.
        textLayers: this.layers().filter((l) => l.text.trim() !== ''),
        drawStrokes: this.strokes(),
        stickerLayers: this.stickers()
      });
    } catch (err) {
      console.error('[edit-image] compose on Tiếp failed', err);
      this.toast.error('Không thể xử lý ảnh, vui lòng thử lại.');
    } finally {
      this.exporting.set(false);
    }
  }

  // *ngFor identity: keep a layer's DOM node across property updates (colour / position /
  // text) so the editing <textarea> isn't torn down and refocused on every keystroke.
  trackLayer = (_: number, layer: TextLayer): string => layer.id;

  onToolClick(id: EditToolId): void {
    if (id === 'text') {
      this.addTextLayer();
      return;
    }
    if (id === 'draw') {
      this.enterDraw();
      return;
    }
    if (id === 'sticker') {
      this.toggleStickerPanel();
      return;
    }
    if (id === 'effects') {
      this.toggleEffectsPanel();
      return;
    }
    if (id === 'download') {
      void this.onDownload();
      return;
    }
    console.log(`[edit-image] tool clicked: ${id}`);
  }

  // ---- Download: flatten every layer onto one canvas and save it ----

  async onDownload(): Promise<void> {
    if (this.downloading()) return;
    this.commitEditing();
    this.stickerPanelOpen.set(false);
    this.downloading.set(true);
    try {
      const isJpeg = this.sourceType === 'image/jpeg';
      const blob = await this.compositeToBlob(isJpeg);
      const ext = isJpeg ? 'jpg' : 'png';
      this.triggerDownload(blob, `pinhub-anh-chinh-sua-${Date.now()}.${ext}`);
    } catch (err) {
      console.error('[edit-image] download failed', err);
      this.toast.error('Không thể tải ảnh, vui lòng thử lại.');
    } finally {
      this.downloading.set(false);
    }
  }

  private async compositeToBlob(asJpeg: boolean): Promise<Blob> {
    const imgEl = this.host.nativeElement.querySelector('.eim-image') as HTMLImageElement | null;
    const frame = this.frameEl();
    if (!imgEl || !frame) throw new Error('image element not ready');

    if (!imgEl.complete || imgEl.naturalWidth === 0) {
      await imgEl.decode();
    }
    const natW = imgEl.naturalWidth;
    const natH = imgEl.naturalHeight;
    if (natW === 0 || natH === 0) throw new Error('source image has no dimensions');

    const scale = Math.min(1, EXPORT_MAX_EDGE / Math.max(natW, natH));
    const outW = Math.max(1, Math.round(natW * scale));
    const outH = Math.max(1, Math.round(natH * scale));

    // Editor-pixel -> export-pixel factor (text is authored at a fixed on-screen size).
    const frameRect = frame.getBoundingClientRect();
    const dispScale = frameRect.width > 0 ? outW / frameRect.width : 1;

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('cannot get 2d context');

    if (asJpeg) {
      // JPEG has no alpha — fill so any transparent edges aren't black.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, outW, outH);
    }

    // Layers, painted in the same visual order as the editor: image → strokes → text → stickers.
    // The brightness/contrast/saturation filter applies only to the base photo — overlays are
    // drawn at full, unfiltered strength afterwards.
    ctx.filter = this.imageFilter();
    ctx.drawImage(imgEl, 0, 0, outW, outH);
    ctx.filter = 'none';
    for (const stroke of this.strokes()) {
      this.paintStroke(ctx, stroke, outW, outH);
    }
    for (const layer of this.layers()) {
      if (layer.text.trim() === '') continue;
      this.paintTextLayer(ctx, layer, outW, outH, dispScale);
    }
    for (const sticker of this.stickers()) {
      this.paintStickerLayer(ctx, sticker, outW, outH);
    }

    const mime = asJpeg ? 'image/jpeg' : 'image/png';
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mime, asJpeg ? 0.92 : undefined)
    );
    if (!blob) throw new Error('canvas.toBlob returned null');
    return blob;
  }

  private paintTextLayer(
    ctx: CanvasRenderingContext2D,
    layer: TextLayer,
    outW: number,
    outH: number,
    dispScale: number
  ): void {
    const fontPx = EDITOR_TEXT_PX * dispScale;
    const lineHeight = fontPx * 1.25;
    const maxWidth = outW * 0.88;

    ctx.save();
    ctx.font = `800 ${fontPx}px ${CANVAS_FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = layer.color;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 4 * dispScale;
    ctx.shadowOffsetY = 1 * dispScale;

    // Wrap each hard line to the same 88%-of-frame width the editor uses.
    const lines: string[] = [];
    for (const hardLine of layer.text.split('\n')) {
      const words = hardLine.split(' ');
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (current && ctx.measureText(candidate).width > maxWidth) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      lines.push(current);
    }

    const cx = (layer.xPct / 100) * outW;
    const cy = (layer.yPct / 100) * outH;
    let y = cy - (lines.length * lineHeight) / 2 + lineHeight / 2;
    for (const line of lines) {
      ctx.fillText(line, cx, y);
      y += lineHeight;
    }
    ctx.restore();
  }

  private paintStickerLayer(
    ctx: CanvasRenderingContext2D,
    sticker: StickerLayer,
    outW: number,
    outH: number
  ): void {
    const fontPx = (sticker.sizePct / 100) * outW;
    ctx.save();
    ctx.font = `${fontPx}px ${EMOJI_FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sticker.emoji, (sticker.xPct / 100) * outW, (sticker.yPct / 100) * outH);
    ctx.restore();
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- Text layers ----

  private layerSeq = 0;

  private addTextLayer(): void {
    this.commitEditing();
    const layer: TextLayer = {
      id: `t${++this.layerSeq}_${Date.now().toString(36)}`,
      text: '',
      color: '#FFFFFF',
      xPct: 50,
      yPct: 50
    };
    this.layers.update((list) => [...list, layer]);
    this.selectedId.set(layer.id);
    this.editingId.set(layer.id);
    this.focusEditorSoon();
  }

  onLayerText(layer: TextLayer, event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    this.autoGrow(el);
    const value = el.value;
    // The <textarea> is uncontrolled (no [value] binding) so the caret never jumps while
    // typing; we only mirror the value into the layer state here.
    this.layers.update((list) =>
      list.map((l) => (l.id === layer.id ? { ...l, text: value } : l))
    );
  }

  onEditorBlur(event: FocusEvent): void {
    // A click on the colour palette pulls focus off the textarea. That is NOT "clicking
    // outside" — keep the layer open (the mousedown handler on the palette also prevents
    // the focus shift, so in practice this branch is a fallback for touch / other inputs).
    const to = event.relatedTarget as HTMLElement | null;
    if (to && to.closest('.eim-palette')) {
      return;
    }
    this.commitEditing();
  }

  private commitEditing(): void {
    const id = this.editingId();
    this.editingId.set(null);
    if (!id) return;
    // Drop a layer the user left empty.
    const layer = this.layers().find((l) => l.id === id);
    if (layer && layer.text.trim() === '') {
      this.removeLayer(id);
    }
  }

  removeLayer(id: string): void {
    this.layers.update((list) => list.filter((l) => l.id !== id));
    if (this.selectedId() === id) this.selectedId.set(null);
    if (this.editingId() === id) this.editingId.set(null);
  }

  onDeleteSelected(event: Event): void {
    event.stopPropagation();
    const id = this.selectedId();
    if (!id) return;
    this.removeLayer(id);
    this.removeSticker(id);
  }

  // ---- Stickers ----

  trackSticker = (_: number, sticker: StickerLayer): string => sticker.id;

  toggleStickerPanel(): void {
    this.commitEditing();
    this.effectsPanelOpen.set(false);
    this.stickerPanelOpen.update((v) => !v);
  }

  closeStickerPanel(): void {
    this.stickerPanelOpen.set(false);
  }

  // ---- Effects panel ----

  toggleEffectsPanel(): void {
    this.commitEditing();
    this.stickerPanelOpen.set(false);
    this.effectsPanelOpen.update((v) => !v);
  }

  closeEffectsPanel(): void {
    this.effectsPanelOpen.set(false);
  }

  onBrightnessInput(event: Event): void {
    this.brightness.set(Number((event.target as HTMLInputElement).value));
  }

  onContrastInput(event: Event): void {
    this.contrast.set(Number((event.target as HTMLInputElement).value));
  }

  onSaturationInput(event: Event): void {
    this.saturation.set(Number((event.target as HTMLInputElement).value));
  }

  resetEffects(): void {
    this.brightness.set(100);
    this.contrast.set(100);
    this.saturation.set(100);
  }

  pickSticker(emoji: string): void {
    this.commitEditing();
    const sticker: StickerLayer = {
      id: `s${++this.stickerSeq}_${Date.now().toString(36)}`,
      emoji,
      xPct: 50,
      yPct: 50,
      sizePct: STICKER_DEFAULT_PCT
    };
    // Each pick adds a NEW layer — existing stickers stay put.
    this.stickers.update((list) => [...list, sticker]);
    this.selectedId.set(sticker.id);
    this.stickerPanelOpen.set(false);
    this.measureFrame();
  }

  removeSticker(id: string): void {
    this.stickers.update((list) => list.filter((s) => s.id !== id));
    if (this.selectedId() === id) this.selectedId.set(null);
  }

  // Font-size in px for a sticker, from its stored % of the frame width.
  stickerFontPx(sticker: StickerLayer): number {
    const w = this.frameWidth();
    return w > 0 ? (sticker.sizePct / 100) * w : sticker.sizePct;
  }

  onStickerPointerDown(sticker: StickerLayer, event: PointerEvent): void {
    if (this.drawing()) return;
    event.preventDefault();
    event.stopPropagation();
    this.commitEditing();
    this.selectedId.set(sticker.id);
    this.dragId = sticker.id;
    this.dragMoved = false;
    this.dragStart = {
      x: event.clientX,
      y: event.clientY,
      layerX: sticker.xPct,
      layerY: sticker.yPct
    };
    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      // ignore
    }
  }

  onStickerPointerMove(event: PointerEvent): void {
    if (!this.dragId || this.resizeState) return;
    const dx = event.clientX - this.dragStart.x;
    const dy = event.clientY - this.dragStart.y;
    if (!this.dragMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    this.dragMoved = true;

    const rect = this.frameEl()?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;

    const nextX = clamp(this.dragStart.layerX + (dx / rect.width) * 100, 0, 100);
    const nextY = clamp(this.dragStart.layerY + (dy / rect.height) * 100, 0, 100);
    const id = this.dragId;
    this.stickers.update((list) =>
      list.map((s) => (s.id === id ? { ...s, xPct: nextX, yPct: nextY } : s))
    );
  }

  onStickerPointerUp(sticker: StickerLayer, event: PointerEvent): void {
    if (this.dragId !== sticker.id) {
      this.dragId = null;
      return;
    }
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    } catch {
      // ignore
    }
    this.dragId = null;
    this.dragMoved = false;
    this.selectedId.set(sticker.id);
  }

  // Corner handle: scale about the sticker centre. Distance from centre to pointer vs the
  // distance at grab time gives the scale factor — keeps the emoji's aspect ratio.
  onResizePointerDown(sticker: StickerLayer, event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectedId.set(sticker.id);
    const rect = this.frameEl()?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + (sticker.xPct / 100) * rect.width;
    const cy = rect.top + (sticker.yPct / 100) * rect.height;
    const dist = Math.hypot(event.clientX - cx, event.clientY - cy);
    this.resizeState = {
      id: sticker.id,
      cx,
      cy,
      startDist: Math.max(1, dist),
      startSize: sticker.sizePct
    };
    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      // ignore
    }
  }

  onResizePointerMove(event: PointerEvent): void {
    const rs = this.resizeState;
    if (!rs) return;
    event.stopPropagation();
    const dist = Math.hypot(event.clientX - rs.cx, event.clientY - rs.cy);
    const next = clamp((dist / rs.startDist) * rs.startSize, STICKER_MIN_PCT, STICKER_MAX_PCT);
    this.stickers.update((list) =>
      list.map((s) => (s.id === rs.id ? { ...s, sizePct: next } : s))
    );
  }

  onResizePointerUp(event: PointerEvent): void {
    if (!this.resizeState) return;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    } catch {
      // ignore
    }
    this.resizeState = null;
  }

  // ---- Colour palette (shared: text layer colour / pen colour) ----

  onPaletteColor(value: string): void {
    if (this.drawing()) {
      this.drawColor.set(value);
      return;
    }
    this.pickColor(value);
  }

  isActivePaletteColor(value: string): boolean {
    const current = this.drawing() ? this.drawColor() : this.selectedLayer()?.color;
    return !!current && current.toLowerCase() === value.toLowerCase();
  }

  // Only ever updates the colour of the one active layer — never creates a layer, never
  // changes selection or editing state. Works whether or not the layer has text yet.
  private pickColor(color: string): void {
    const id = this.editingId() ?? this.selectedId();
    if (!id) return;
    this.layers.update((list) =>
      list.map((l) => (l.id === id ? { ...l, color } : l))
    );
  }

  // ---- Selection / drag on a text layer ----

  onLayerPointerDown(layer: TextLayer, event: PointerEvent): void {
    // Draw mode owns the pointer — text layers are display-only then.
    if (this.drawing()) return;
    // While editing this layer, let the textarea handle the pointer (caret placement).
    if (this.editingId() === layer.id) return;
    event.preventDefault();
    event.stopPropagation();

    // Moving to a different layer commits (and cleans up) the one being edited — belt and
    // braces alongside the textarea's own (blur) handler.
    if (this.editingId()) this.commitEditing();

    this.selectedId.set(layer.id);
    this.dragId = layer.id;
    this.dragMoved = false;
    this.dragStart = {
      x: event.clientX,
      y: event.clientY,
      layerX: layer.xPct,
      layerY: layer.yPct
    };
    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      // A synthetic / already-released pointer id throws here — harmless to skip.
    }
  }

  onLayerPointerMove(event: PointerEvent): void {
    if (!this.dragId) return;
    const dx = event.clientX - this.dragStart.x;
    const dy = event.clientY - this.dragStart.y;
    if (!this.dragMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    this.dragMoved = true;

    const frame = this.frameEl();
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const nextX = clamp(this.dragStart.layerX + (dx / rect.width) * 100, 0, 100);
    const nextY = clamp(this.dragStart.layerY + (dy / rect.height) * 100, 0, 100);
    const id = this.dragId;
    this.layers.update((list) =>
      list.map((l) => (l.id === id ? { ...l, xPct: nextX, yPct: nextY } : l))
    );
  }

  onLayerPointerUp(layer: TextLayer, event: PointerEvent): void {
    if (this.dragId !== layer.id) {
      this.dragId = null;
      return;
    }
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    } catch {
      // No active capture for this pointer id — ignore.
    }
    const wasDrag = this.dragMoved;
    this.dragId = null;
    this.dragMoved = false;
    if (!wasDrag) {
      // A tap (no drag) opens the layer for typing.
      this.selectedId.set(layer.id);
      this.editingId.set(layer.id);
      this.focusEditorSoon();
    }
  }

  // A pointer press that reaches the canvas didn't land on a layer — deselect,
  // which also hides the colour palette and commits any in-progress edit.
  onCanvasPointerDown(): void {
    if (this.drawing()) return;
    this.commitEditing();
    this.selectedId.set(null);
    this.stickerPanelOpen.set(false);
    this.effectsPanelOpen.set(false);
  }

  // ---- Free-hand drawing ----

  private enterDraw(): void {
    this.commitEditing();
    this.selectedId.set(null);
    this.stickerPanelOpen.set(false);
    this.effectsPanelOpen.set(false);
    this.drawing.set(true);
    setTimeout(() => this.syncCanvasSize());
  }

  finishDrawing(): void {
    if (this.liveStroke) {
      this.strokes.update((list) => [...list, this.liveStroke as DrawStroke]);
      this.liveStroke = null;
    }
    this.commitEditing();
    this.drawing.set(false);
  }

  selectBrush(id: BrushType): void {
    this.brush.set(id);
  }

  undoStroke(): void {
    this.strokes.update((list) => list.slice(0, -1));
  }

  onDrawPointerDown(event: PointerEvent): void {
    if (!this.drawing()) return;
    event.preventDefault();
    event.stopPropagation();
    const p = this.normPoint(event);
    if (!p) return;
    this.liveStroke = {
      brush: this.brush(),
      color: this.drawColor(),
      size: BRUSH_SIZE[this.brush()],
      points: [p]
    };
    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      // ignore
    }
    this.scheduleRedraw();
  }

  onDrawPointerMove(event: PointerEvent): void {
    if (!this.liveStroke) return;
    const p = this.normPoint(event);
    if (!p) return;
    this.liveStroke.points.push(p);
    this.scheduleRedraw();
  }

  onDrawPointerUp(event: PointerEvent): void {
    if (!this.liveStroke) return;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    } catch {
      // ignore
    }
    const finished = this.liveStroke;
    this.liveStroke = null;
    this.strokes.update((list) => [...list, finished]);
  }

  private normPoint(event: PointerEvent): { x: number; y: number } | null {
    const cv = this.drawCanvasRef?.nativeElement;
    if (!cv) return null;
    const r = cv.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return {
      x: clamp((event.clientX - r.left) / r.width, 0, 1),
      y: clamp((event.clientY - r.top) / r.height, 0, 1)
    };
  }

  private syncCanvasSize(): void {
    const cv = this.drawCanvasRef?.nativeElement;
    if (!cv) return;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (w === 0 || h === 0) return;
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    this.redraw();
  }

  private scheduleRedraw(): void {
    if (this.redrawScheduled) return;
    this.redrawScheduled = true;
    requestAnimationFrame(() => {
      this.redrawScheduled = false;
      this.redraw();
    });
  }

  private redraw(): void {
    const cv = this.drawCanvasRef?.nativeElement;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const stroke of this.strokes()) {
      this.paintStroke(ctx, stroke, cv.width, cv.height);
    }
    if (this.liveStroke) {
      this.paintStroke(ctx, this.liveStroke, cv.width, cv.height);
    }
  }

  private paintStroke(
    ctx: CanvasRenderingContext2D,
    stroke: DrawStroke,
    w: number,
    h: number
  ): void {
    const pts = stroke.points;
    if (pts.length === 0) return;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const lineWidth = Math.max(1, stroke.size * w);

    if (stroke.brush === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = lineWidth;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = lineWidth;
      if (stroke.brush === 'marker') {
        ctx.globalAlpha = 0.38;
      } else if (stroke.brush === 'neon') {
        ctx.shadowColor = stroke.color;
        ctx.shadowBlur = lineWidth * 2.2;
      }
    }

    ctx.beginPath();
    ctx.moveTo(pts[0].x * w, pts[0].y * h);
    if (pts.length === 1) {
      // A single tap — draw a dot.
      ctx.lineTo(pts[0].x * w + 0.01, pts[0].y * h);
    } else {
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x * w, pts[i].y * h);
      }
    }
    ctx.stroke();

    // Neon: a brighter, tighter core pass on top of the glow.
    if (stroke.brush === 'neon') {
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.lineWidth = Math.max(1, lineWidth * 0.4);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ---- Hover tooltip, same behaviour as the crop screen's small icons ----
  // `position: fixed` + coordinates measured from the icon on hover, so the canvas'
  // `overflow: hidden` never clips a label sitting just below a button.

  public tooltipText = signal('');
  public tooltipVisible = signal(false);
  public tooltipLeft = signal(0);
  public tooltipTop = signal(0);

  showTooltip(event: MouseEvent, text: string): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.tooltipText.set(text);
    this.tooltipLeft.set(rect.left + rect.width / 2);
    this.tooltipTop.set(rect.bottom + 10);
    this.tooltipVisible.set(true);
  }

  hideTooltip(): void {
    this.tooltipVisible.set(false);
  }

  private frameEl(): HTMLElement | null {
    return this.host.nativeElement.querySelector('.eim-frame');
  }

  private focusEditorSoon(): void {
    setTimeout(() => {
      const el = this.host.nativeElement.querySelector(
        '.eim-tl-input'
      ) as HTMLTextAreaElement | null;
      if (!el) return;
      const layer = this.layers().find((l) => l.id === this.editingId());
      el.value = layer?.text ?? '';
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
      this.autoGrow(el);
    });
  }

  private autoGrow(el: HTMLTextAreaElement): void {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  private revokeUrl(): void {
    const url = this.imageUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
  }
}
