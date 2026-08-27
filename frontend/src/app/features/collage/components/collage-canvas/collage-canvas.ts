import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  Output,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Canvas, FabricImage, FabricObject, Rect } from 'fabric';
import {
  COLLAGE_HEIGHT,
  COLLAGE_WIDTH,
  CollageLayer,
  CollageLayerTransform,
} from '../../collage.types';
import { CollageStoreService } from '../../services/collage-store.service';

type CollageFabricObject = FabricObject & { collageLayerId?: string };

interface SelectionBox {
  left: number;
  top: number;
  width: number;
  height: number;
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

  /** Screen box of the selected object, in the canvas ELEMENT's coordinate
   * space (not the page's), so the template can anchor the toolbar with plain
   * left/top. Null when nothing is selected. */
  readonly selectionBox = signal<SelectionBox | null>(null);

  private canvas?: Canvas;
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
    void this.syncCanvas(this.store.layers(), this.store.selectedId());
  }

  ngOnDestroy(): void {
    this.layerSyncEffect.destroy();
    this.resizeObserver?.disconnect();
    void this.canvas?.dispose();
  }

  async exportPng(): Promise<Blob> {
    if (!this.canvas) throw new Error('Khung ảnh chưa sẵn sàng.');
    /* The editing canvas is transparent so the dotted artboard shows through.
       Paint the white background back on just for the export, then restore — the
       output file stays byte-for-byte what it was before that change. */
    const editingBackground = this.canvas.backgroundColor;
    this.canvas.backgroundColor = '#ffffff';
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
        const image = await FabricImage.fromURL(layer.cutoutImageUrl);
        if (version !== this.syncVersion || !this.canvas) return;
        (image as CollageFabricObject).collageLayerId = layer.id;
        image.set({
          originX: 'center',
          originY: 'center',
          cornerStyle: 'circle',
          cornerColor: this.resolveToken('--color-studio-aqua', '#4fb2ff'),
          cornerStrokeColor: this.resolveToken('--color-ink', '#05070e'),
          borderColor: this.resolveToken('--color-iris-violet', '#9475ff'),
          transparentCorners: false,
          cornerSize: 28,
          padding: 5,
          perPixelTargetFind: true,
        });
        image.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false });
        canvas.add(image);
        object = image;
      }

      object.set({
        left: layer.x,
        top: layer.y,
        scaleX: layer.scaleX,
        scaleY: layer.scaleY,
        angle: layer.rotation,
        clipPath: this.buildClipPath(layer),
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

  /** Fabric clipPath coordinates are relative to the object's OWN center
   * (since `absolutePositioned` defaults to false), in its unscaled pixel
   * space — so this only ever depends on the layer's own width/height, and
   * automatically stays correct across the object's position/scale/rotation
   * on the canvas (resizing the layer can never reveal what's outside the
   * crop; it only zooms the already-cropped picture in or out). */
  private buildClipPath(layer: CollageLayer): Rect | undefined {
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
