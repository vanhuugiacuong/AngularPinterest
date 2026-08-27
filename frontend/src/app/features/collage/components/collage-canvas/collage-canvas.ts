import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Canvas, FabricImage, FabricObject, Path, PencilBrush, Rect, Textbox } from 'fabric';
import {
  COLLAGE_HEIGHT,
  COLLAGE_WIDTH,
  CollageBrushKind,
  CollageImageLayer,
  CollageLayer,
  CollageLayerTransform,
  CollageTextLayer,
  isImageLayer,
  isTextLayer,
} from '../../collage.types';
import { CollageStoreService } from '../../services/collage-store.service';

type CollageFabricObject = FabricObject & { collageLayerId?: string };

interface SelectionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DrawingSettings {
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  brush: CollageBrushKind;
}

@Component({
  selector: 'app-collage-canvas',
  standalone: true,
  templateUrl: './collage-canvas.html',
  styleUrl: './collage-canvas.css',
})
export class CollageCanvasComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvasElement', { static: true })
  private canvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvasShell', { static: true })
  private canvasShell!: ElementRef<HTMLDivElement>;

  /** Public: the selection toolbar in this component's own template drives
   * duplicate/remove directly. */
  readonly store = inject(CollageStoreService);

  /** Re-crop lives in the parent (it owns the crop dialog), so the scissors
   * button only reports intent. */
  @Output() readonly recut = new EventEmitter<void>();

  /** A finished brush stroke, as the path data + style needed to rebuild it.
   * The parent turns it into a layer; this component does not touch the store
   * for creation, only for selection and transforms. */
  @Output() readonly strokeCompleted = new EventEmitter<{
    pathData: string;
    left: number;
    top: number;
    width: number;
    height: number;
  }>();

  /** Non-null puts Fabric into free-drawing mode with these settings; null
   * returns the canvas to selection mode. */
  @Input() set drawing(settings: DrawingSettings | null) {
    this.drawingSettings = settings;
    this.applyDrawingMode();
  }

  /** Screen box of the selected object, in the canvas ELEMENT's coordinate
   * space (not the page's), so the template can anchor the toolbar with plain
   * left/top. Null when nothing is selected. */
  readonly selectionBox = signal<SelectionBox | null>(null);

  private canvas?: Canvas;
  private drawingSettings: DrawingSettings | null = null;
  private resizeObserver?: ResizeObserver;
  private syncVersion = 0;
  private suppressSelectionEvent = false;
  private isPointerTransforming = false;
  private pointerLayerId: string | null = null;

  /** Fabric.js paints selection chrome on the canvas 2D context, which
   * cannot read CSS custom properties directly — resolve the current
   * theme's actual value once per call so corner/border colors stay on
   * the Nova/Iris brand tokens (and adapt across light/dark) instead of
   * a hardcoded neon cyan/violet. */
  /* Relative luminance by the sRGB coefficients, on the raw channels rather
   * than gamma-corrected ones: the exact threshold does not matter here, only
   * which side of "is this light or dark" a swatch falls on, and this is
   * cheaper and stable across the whole palette. Unparseable input counts as
   * light, matching the white default. */
  readonly stageDotColor = computed(() => {
    const hex = this.store.background().replace('#', '');
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((char) => char + char)
            .join('')
        : hex;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return 'rgba(0, 0, 0, 0.16)';
    const r = Number.parseInt(full.slice(0, 2), 16);
    const g = Number.parseInt(full.slice(2, 4), 16);
    const b = Number.parseInt(full.slice(4, 6), 16);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luminance > 0.55 ? 'rgba(0, 0, 0, 0.16)' : 'rgba(255, 255, 255, 0.18)';
  });

  private resolveToken(name: string, fallback: string): string {
    if (typeof window === 'undefined') return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  private readonly layerSyncEffect = effect(() => {
    const layers = this.store.layers();
    const selectedId = this.store.selectedId();
    if (this.canvas && !this.isPointerTransforming) void this.syncCanvas(layers, selectedId);
  });

  ngAfterViewInit(): void {
    this.canvas = new Canvas(this.canvasElement.nativeElement, {
      width: COLLAGE_WIDTH,
      height: COLLAGE_HEIGHT,
      /* Transparent while editing so the dotted artboard behind it shows
         through and an empty collage reads as empty. exportPng() paints the
         white background back on, so the exported file is unchanged. */
      backgroundColor: 'transparent',
      preserveObjectStacking: true,
      selection: false,
      uniformScaling: true,
      targetFindTolerance: 5,
    });
    this.bindCanvasEvents();
    this.resizeObserver = new ResizeObserver(() => this.fitCanvas());
    this.resizeObserver.observe(this.canvasShell.nativeElement);
    this.fitCanvas();
    // The `drawing` input can arrive before the Fabric canvas exists, so apply
    // whatever it last set once we do have one.
    this.applyDrawingMode();
    void this.syncCanvas(this.store.layers(), this.store.selectedId());
  }

  ngOnDestroy(): void {
    this.layerSyncEffect.destroy();
    this.resizeObserver?.disconnect();
    void this.canvas?.dispose();
  }

  async exportPng(): Promise<Blob> {
    if (!this.canvas) throw new Error('Khung ảnh chưa sẵn sàng.');
    /* The editing canvas is transparent so the artboard behind it — its colour
       and its dot grid, both CSS on .canvas-stage — shows through. Only the
       colour belongs in the file, so it is painted on for the export and the
       dots are never baked in. */
    const editingBackground = this.canvas.backgroundColor;
    this.canvas.backgroundColor = this.store.background();
    try {
      this.canvas.renderAll();
      const output = this.canvas.toCanvasElement(1);
      return await new Promise<Blob>((resolve, reject) => {
        output.toBlob(
          (blob: Blob | null) =>
            blob ? resolve(blob) : reject(new Error('Không thể xuất ảnh PNG.')),
          'image/png',
          1,
        );
      });
    } finally {
      this.canvas.backgroundColor = editingBackground;
      this.canvas.renderAll();
    }
  }

  /** Maps the active object's Fabric bounding box into the canvas element's own
   * pixel space. The element is rendered at COLLAGE_WIDTH internally but sized
   * down by fitCanvas, so every value has to go through that CSS scale.
   *
   * Runs on every Fabric render, hence the equality check before writing: a
   * signal write per frame during a drag would schedule change detection on
   * each one for values that mostly have not moved. */
  private updateSelectionBox(): void {
    const canvas = this.canvas;
    const active = canvas?.getActiveObject();
    if (!canvas || !active) {
      if (this.selectionBox() !== null) this.selectionBox.set(null);
      return;
    }

    const cssWidth = this.canvasElement.nativeElement.clientWidth;
    if (!cssWidth) return;
    const scale = cssWidth / COLLAGE_WIDTH;
    const bounds = active.getBoundingRect();
    const next: SelectionBox = {
      left: Math.round(bounds.left * scale),
      top: Math.round(bounds.top * scale),
      width: Math.round(bounds.width * scale),
      height: Math.round(bounds.height * scale),
    };

    const current = this.selectionBox();
    if (
      current &&
      current.left === next.left &&
      current.top === next.top &&
      current.width === next.width &&
      current.height === next.height
    ) {
      return;
    }
    this.selectionBox.set(next);
  }

  private bindCanvasEvents(): void {
    if (!this.canvas) return;

    /* One hook covers every case: selecting, moving, scaling, rotating and the
       store-driven re-sync all end in a render, so the toolbar tracks the
       object without a listener per interaction. */
    this.canvas.on('after:render', () => this.updateSelectionBox());

    this.canvas.on('selection:created', (event: any) => this.onSelectionChanged(event.selected?.[0]));
    this.canvas.on('selection:updated', (event: any) => this.onSelectionChanged(event.selected?.[0]));
    this.canvas.on('selection:cleared', () => this.onSelectionChanged(undefined));
    this.canvas.on('mouse:down', (event: any) => {
      const target = event.target as CollageFabricObject | undefined;
      const id = target?.collageLayerId;
      if (!target || !id) {
        this.isPointerTransforming = false;
        this.pointerLayerId = null;
        return;
      }

      // A cutout can be grabbed directly on the canvas without first selecting
      // its row in the layer panel. Only Fabric is updated during pointer-down,
      // so the current gesture can start moving immediately without a store
      // synchronization interrupting the first drag frame.
      this.isPointerTransforming = true;
      this.pointerLayerId = id;
      this.canvas?.setActiveObject(target);
      this.canvas?.bringObjectToFront(target);
      this.canvas?.requestRenderAll();
      this.store.select(id);
    });
    this.canvas.on('mouse:up', () => {
      const id = this.pointerLayerId;
      this.isPointerTransforming = false;
      this.pointerLayerId = null;
      if (!id) return;

      // Persist the visual front-order only after the gesture ends. This keeps
      // layer metadata/list order correct while preserving one-press dragging.
      queueMicrotask(() => {
        this.store.select(id);
        this.store.bringToFront(id);
      });
    });
    /* A finished stroke is handed to the parent as data and the raw Fabric path
       is dropped again: syncCanvas rebuilds it from the resulting layer, so the
       store stays the single source of truth for what is on the canvas. Leaving
       Fabric's own path in place would mean two objects for one stroke. */
    this.canvas.on('path:created', (event: any) => {
      const path = event.path as Path | undefined;
      if (!path) return;
      const canvas = this.canvas;
      if (!canvas) return;

      const bounds = path.getBoundingRect();
      const pathData = path.toSVG().match(/ d="([^"]+)"/)?.[1];
      canvas.remove(path);
      canvas.requestRenderAll();
      if (!pathData) return;

      this.strokeCompleted.emit({
        pathData,
        left: bounds.left + bounds.width / 2,
        top: bounds.top + bounds.height / 2,
        width: bounds.width,
        height: bounds.height,
      });
    });

    this.canvas.on('object:modified', (event: any) => {
      const target = event.target as CollageFabricObject | undefined;
      const id = target?.collageLayerId;
      if (!target || !id) return;
      const transform: CollageLayerTransform = {
        x: target.left,
        y: target.top,
        scaleX: target.scaleX,
        scaleY: target.scaleY,
        rotation: target.angle,
      };
      this.store.updateTransform(id, transform);
    });
  }

  private onSelectionChanged(target?: FabricObject): void {
    if (this.suppressSelectionEvent) return;
    this.store.select((target as CollageFabricObject | undefined)?.collageLayerId ?? null);
  }

  private async syncCanvas(layers: CollageLayer[], selectedId: string | null): Promise<void> {
    const canvas = this.canvas;
    if (!canvas) return;
    const version = ++this.syncVersion;
    const byId = new Map(layers.map((layer) => [layer.id, layer]));

    for (const object of canvas.getObjects() as CollageFabricObject[]) {
      if (object.collageLayerId && !byId.has(object.collageLayerId)) canvas.remove(object);
    }

    const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex);
    for (const layer of sorted) {
      let object = (canvas.getObjects() as CollageFabricObject[]).find(
        (candidate) => candidate.collageLayerId === layer.id,
      );
      if (!object) {
        const created = await this.createObject(layer);
        if (version !== this.syncVersion || !this.canvas || !created) return;
        created.collageLayerId = layer.id;
        this.applySelectionChrome(created, layer);
        canvas.add(created);
        object = created;
      }

      // Text is re-applied on every sync, not just at creation: editing the
      // style panel changes the layer, and a Textbox has to be told about it.
      if (isTextLayer(layer) && object instanceof Textbox) {
        this.applyTextStyle(object, layer);
      }

      object.set({
        left: layer.x,
        top: layer.y,
        scaleX: layer.scaleX,
        scaleY: layer.scaleY,
        angle: layer.rotation,
        clipPath: isImageLayer(layer) ? this.buildClipPath(layer) : undefined,
      });
      object.setCoords();
      canvas.moveObjectTo(object, layer.zIndex);
    }

    this.suppressSelectionEvent = true;
    const selected = (canvas.getObjects() as CollageFabricObject[]).find(
      (object) => object.collageLayerId === selectedId,
    );
    if (selected) canvas.setActiveObject(selected);
    else canvas.discardActiveObject();
    this.suppressSelectionEvent = false;
    canvas.requestRenderAll();
  }

  /** Puts Fabric in or out of free-drawing mode and configures the brush.
   * Selection is disabled while drawing — otherwise the first press lands on
   * whatever layer is under the cursor and drags it instead of drawing. */
  private applyDrawingMode(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const settings = this.drawingSettings;

    canvas.isDrawingMode = !!settings;
    if (!settings) {
      canvas.forEachObject((object) => {
        object.selectable = true;
        object.evented = true;
      });
      canvas.requestRenderAll();
      return;
    }

    canvas.discardActiveObject();
    canvas.forEachObject((object) => {
      object.selectable = false;
      object.evented = false;
    });

    const brush = new PencilBrush(canvas);
    // Marker reads as a marker by being wider and translucent — the alpha rides
    // on the stroke colour because PencilBrush has no opacity of its own.
    const isMarker = settings.brush === 'marker';
    brush.width = settings.strokeWidth * (isMarker ? 2.4 : 1);
    brush.color = this.withAlpha(
      settings.stroke,
      settings.strokeOpacity * (isMarker ? 0.45 : 1),
    );
    canvas.freeDrawingBrush = brush;
    canvas.requestRenderAll();
  }

  /** Fabric's brush takes a CSS colour string, so opacity has to be baked into
   * it. Handles the #rgb/#rrggbb the colour picker produces. */
  private withAlpha(color: string, alpha: number): string {
    const clamped = Math.min(1, Math.max(0, alpha));
    const hex = color.replace('#', '');
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((char) => char + char)
            .join('')
        : hex;
    if (full.length !== 6) return color;
    const r = Number.parseInt(full.slice(0, 2), 16);
    const g = Number.parseInt(full.slice(2, 4), 16);
    const b = Number.parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${clamped})`;
  }

  /** One Fabric object per layer kind. Text becomes a Textbox specifically
   * because Textbox reflows its content to a fixed `width` — that is what keeps
   * long text inside the layer's frame instead of spilling across the artboard.
   * A plain IText would grow sideways forever. */
  private async createObject(layer: CollageLayer): Promise<CollageFabricObject | null> {
    if (isImageLayer(layer)) {
      return (await FabricImage.fromURL(layer.cutoutImageUrl)) as CollageFabricObject;
    }

    if (isTextLayer(layer)) {
      const textbox = new Textbox(layer.text, { width: layer.width });
      this.applyTextStyle(textbox, layer);
      return textbox as CollageFabricObject;
    }

    const path = new Path(layer.pathData, {
      fill: undefined,
      stroke: layer.stroke,
      strokeWidth: layer.strokeWidth,
      opacity: layer.strokeOpacity,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
    });
    return path as CollageFabricObject;
  }

  private applyTextStyle(textbox: Textbox, layer: CollageTextLayer): void {
    textbox.set({
      text: layer.text,
      // The wrap width. Scaling the layer scales the rendered result, so this
      // stays in the layer's own unscaled pixel space.
      width: layer.width,
      fontFamily: layer.fontFamily,
      fontSize: layer.fontSize,
      fontWeight: layer.fontWeight,
      fontStyle: layer.fontStyle,
      textAlign: layer.textAlign,
      fill: layer.color,
      backgroundColor: layer.highlight ? layer.highlightColor : undefined,
    });
  }

  private applySelectionChrome(object: CollageFabricObject, layer: CollageLayer): void {
    object.set({
      originX: 'center',
      originY: 'center',
      cornerStyle: 'circle',
      cornerColor: this.resolveToken('--color-studio-aqua', '#4fb2ff'),
      cornerStrokeColor: this.resolveToken('--color-ink', '#05070e'),
      borderColor: this.resolveToken('--color-iris-violet', '#9475ff'),
      transparentCorners: false,
      cornerSize: 28,
      padding: 5,
      // Only meaningful for a bitmap with transparent regions; on text and
      // vector strokes it makes thin shapes almost impossible to grab.
      perPixelTargetFind: isImageLayer(layer),
    });
    // Text keeps its side handles: dragging them changes the wrap width, which
    // is the one resize that matters for text. Images and strokes scale
    // uniformly from the corners.
    object.setControlsVisibility(
      isTextLayer(layer)
        ? { mt: false, mb: false }
        : { ml: false, mr: false, mt: false, mb: false },
    );
  }

  /** Fabric clipPath coordinates are relative to the object's OWN center
   * (since `absolutePositioned` defaults to false), in its unscaled pixel
   * space — so this only ever depends on the layer's own width/height, and
   * automatically stays correct across the object's position/scale/rotation
   * on the canvas (resizing the layer can never reveal what's outside the
   * crop; it only zooms the already-cropped picture in or out). */
  private buildClipPath(layer: CollageImageLayer): Rect | undefined {
    const cropX = layer.cropX ?? 0;
    const cropY = layer.cropY ?? 0;
    const cropWidth = layer.cropWidth ?? 1;
    const cropHeight = layer.cropHeight ?? 1;
    if (cropX === 0 && cropY === 0 && cropWidth === 1 && cropHeight === 1) return undefined;

    return new Rect({
      left: (cropX + cropWidth / 2 - 0.5) * layer.width,
      top: (cropY + cropHeight / 2 - 0.5) * layer.height,
      width: cropWidth * layer.width,
      height: cropHeight * layer.height,
      originX: 'center',
      originY: 'center',
    });
  }

  private fitCanvas(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const availableWidth = Math.max(220, this.canvasShell.nativeElement.clientWidth - 24);
    const availableHeight = Math.max(320, window.innerHeight - 210);
    const scale = Math.min(availableWidth / COLLAGE_WIDTH, availableHeight / COLLAGE_HEIGHT, 1);
    const width = `${Math.floor(COLLAGE_WIDTH * scale)}px`;
    const height = `${Math.floor(COLLAGE_HEIGHT * scale)}px`;
    canvas.setDimensions({ width, height }, { cssOnly: true });
    const container = canvas.getElement().parentElement;
    if (container) {
      container.style.width = width;
      container.style.height = height;
    }
    canvas.calcOffset();
  }
}
