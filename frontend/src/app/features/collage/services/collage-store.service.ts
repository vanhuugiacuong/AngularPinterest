import { Injectable, computed, signal } from '@angular/core';
import {
  DEFAULT_COLLAGE_BACKGROUND,
  CollageDrawingLayer,
  CollageLayer,
  CollageLayerTransform,
  CollageTextLayer,
  isDrawingLayer,
  isImageLayer,
  isTextLayer,
} from '../collage.types';

interface CollageSnapshot {
  layers: CollageLayer[];
  background: string;
}

@Injectable()
export class CollageStoreService {
  private readonly layersState = signal<CollageLayer[]>([]);
  private readonly selectedIdState = signal<string | null>(null);
  /** The artboard colour behind every layer. Not modelled as a layer: it can
   * never be reordered, deleted or transformed, and giving it an id would put
   * it in reach of every method here that takes one. */
  private readonly backgroundState = signal<string>(DEFAULT_COLLAGE_BACKGROUND);
  /* History holds the background alongside the layers. Undo that silently
     skipped a background change would be a hole in the one control users reach
     for after any edit they regret. */
  private past: CollageSnapshot[] = [];
  private future: CollageSnapshot[] = [];

  readonly layers = this.layersState.asReadonly();
  readonly selectedId = this.selectedIdState.asReadonly();
  readonly background = this.backgroundState.asReadonly();
  readonly selectedLayer = computed(
    () => this.layersState().find((layer) => layer.id === this.selectedIdState()) ?? null,
  );
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);

  add(layer: CollageLayer): void {
    this.remember();
    const layers = [...this.layersState(), { ...layer, zIndex: this.layersState().length }];
    this.layersState.set(this.normalizeZ(layers));
    this.selectedIdState.set(layer.id);
  }

  replaceAll(layers: CollageLayer[], background = DEFAULT_COLLAGE_BACKGROUND): void {
    this.layersState.set(this.normalizeZ(layers.map((layer) => ({ ...layer }))));
    this.backgroundState.set(background);
    this.selectedIdState.set(layers.at(-1)?.id ?? null);
    this.past = [];
    this.future = [];
    this.syncHistorySignals();
  }

  /** `coalesce` folds the change into whatever history entry is already open,
   * the same way updateText does: typing a hex code fires per keystroke, and
   * without it six characters would cost six undo steps to get back. */
  setBackground(color: string, coalesce = false): void {
    if (color === this.backgroundState()) return;
    if (!coalesce) this.remember();
    this.backgroundState.set(color);
  }

  select(id: string | null): void {
    if (id && !this.layersState().some((layer) => layer.id === id)) return;
    this.selectedIdState.set(id);
  }

  updateTransform(id: string, transform: CollageLayerTransform): void {
    const current = this.layersState().find((layer) => layer.id === id);
    if (!current || this.sameTransform(current, transform)) return;
    this.remember();
    this.layersState.update((layers) =>
      layers.map((layer) => (layer.id === id ? { ...layer, ...transform } : layer)),
    );
  }

  /** Applied by the re-crop tool — only touches which part of the layer's
   * own image is visible, never its position/size/rotation on the canvas. */
  updateCrop(
    id: string,
    crop: { cropX: number; cropY: number; cropWidth: number; cropHeight: number },
  ): void {
    const current = this.layersState().find((layer) => layer.id === id);
    if (!current) return;
    this.remember();
    this.layersState.update((layers) =>
      layers.map((layer) => (layer.id === id ? { ...layer, ...crop } : layer)),
    );
  }

  /** Patches a text layer's content/style. Separate from updateTransform so
   * typing does not push a history entry per keystroke — `coalesce` reuses the
   * previous snapshot while the same edit continues. */
  updateText(id: string, patch: Partial<Omit<CollageTextLayer, 'id' | 'kind'>>, coalesce = false): void {
    const current = this.layersState().find((layer) => layer.id === id);
    if (!current || !isTextLayer(current)) return;
    if (!coalesce) this.remember();
    this.layersState.update((layers) =>
      layers.map((layer) => (layer.id === id ? { ...(layer as CollageTextLayer), ...patch } : layer)),
    );
  }

  /** Patches a drawing layer's stroke style — same reasoning as updateText for
   * slider drags, which fire continuously. */
  updateDrawing(
    id: string,
    patch: Partial<Omit<CollageDrawingLayer, 'id' | 'kind' | 'pathData'>>,
    coalesce = false,
  ): void {
    const current = this.layersState().find((layer) => layer.id === id);
    if (!current || !isDrawingLayer(current)) return;
    if (!coalesce) this.remember();
    this.layersState.update((layers) =>
      layers.map((layer) =>
        layer.id === id ? { ...(layer as CollageDrawingLayer), ...patch } : layer,
      ),
    );
  }

  remove(id = this.selectedIdState()): void {
    if (!id || !this.layersState().some((layer) => layer.id === id)) return;
    this.remember();
    const next = this.normalizeZ(this.layersState().filter((layer) => layer.id !== id));
    this.layersState.set(next);
    this.selectedIdState.set(next.at(-1)?.id ?? null);
  }

  duplicate(id = this.selectedIdState()): void {
    const source = this.layersState().find((layer) => layer.id === id);
    if (!source) return;
    this.remember();
    const copy: CollageLayer = {
      ...source,
      id: crypto.randomUUID(),
      x: Math.min(1020, source.x + 36),
      y: Math.min(1860, source.y + 36),
      zIndex: this.layersState().length,
    };
    this.layersState.set(this.normalizeZ([...this.layersState(), copy]));
    this.selectedIdState.set(copy.id);
  }

  moveForward(id = this.selectedIdState()): void {
    this.move(id, 1);
  }

  moveBackward(id = this.selectedIdState()): void {
    this.move(id, -1);
  }

  bringToFront(id = this.selectedIdState()): void {
    this.moveToEdge(id, true);
  }

  sendToBack(id = this.selectedIdState()): void {
    this.moveToEdge(id, false);
  }

  reorderFromFront(frontToBackIds: string[]): void {
    const current = [...this.layersState()].sort((a, b) => b.zIndex - a.zIndex);
    const currentIds = current.map((layer) => layer.id);
    if (
      frontToBackIds.length !== currentIds.length ||
      frontToBackIds.some((id) => !currentIds.includes(id)) ||
      frontToBackIds.every((id, index) => id === currentIds[index])
    ) {
      return;
    }

    this.remember();
    const byId = new Map(current.map((layer) => [layer.id, layer]));
    const backToFront = [...frontToBackIds].reverse();
    this.layersState.set(backToFront.map((id, zIndex) => ({ ...byId.get(id)!, zIndex })));
  }

  undo(): void {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.snapshot());
    this.restore(previous);
    this.ensureSelection();
    this.syncHistorySignals();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.snapshot());
    this.restore(next);
    this.ensureSelection();
    this.syncHistorySignals();
  }

  /** Only image layers hold object URLs — text and drawing layers are plain
   * data, so there is nothing to revoke for them. */
  disposeObjectUrls(): void {
    const urls = new Set(
      this.layersState()
        .filter(isImageLayer)
        .flatMap((layer) => [layer.cutoutImageUrl, layer.sourceImageUrl]),
    );
    for (const url of urls) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
  }

  private move(id: string | null, amount: -1 | 1): void {
    if (!id) return;
    const layers = [...this.layersState()].sort((a, b) => a.zIndex - b.zIndex);
    const index = layers.findIndex((layer) => layer.id === id);
    const target = index + amount;
    if (index < 0 || target < 0 || target >= layers.length) return;
    this.remember();
    [layers[index], layers[target]] = [layers[target], layers[index]];
    this.layersState.set(this.normalizeZ(layers));
  }

  private moveToEdge(id: string | null, toFront: boolean): void {
    if (!id) return;
    const layers = [...this.layersState()].sort((a, b) => a.zIndex - b.zIndex);
    const index = layers.findIndex((layer) => layer.id === id);
    if (index < 0 || (toFront ? index === layers.length - 1 : index === 0)) return;
    this.remember();
    const [layer] = layers.splice(index, 1);
    if (!layer) return;
    if (toFront) layers.push(layer);
    else layers.unshift(layer);
    this.layersState.set(this.normalizeZ(layers));
  }

  private remember(): void {
    this.past.push(this.snapshot());
    if (this.past.length > 50) this.past.shift();
    this.future = [];
    this.syncHistorySignals();
  }

  private snapshot(): CollageSnapshot {
    return {
      layers: this.layersState().map((layer) => ({ ...layer })),
      background: this.backgroundState(),
    };
  }

  private restore(snapshot: CollageSnapshot): void {
    this.layersState.set(snapshot.layers.map((layer) => ({ ...layer })));
    this.backgroundState.set(snapshot.background);
  }

  private normalizeZ(layers: CollageLayer[]): CollageLayer[] {
    return layers.map((layer, zIndex) => ({ ...layer, zIndex }));
  }

  private ensureSelection(): void {
    if (!this.layersState().some((layer) => layer.id === this.selectedIdState())) {
      this.selectedIdState.set(this.layersState().at(-1)?.id ?? null);
    }
  }

  private syncHistorySignals(): void {
    this.canUndo.set(this.past.length > 0);
    this.canRedo.set(this.future.length > 0);
  }

  private sameTransform(layer: CollageLayer, transform: CollageLayerTransform): boolean {
    return (
      Math.abs(layer.x - transform.x) < 0.01 &&
      Math.abs(layer.y - transform.y) < 0.01 &&
      Math.abs(layer.scaleX - transform.scaleX) < 0.0001 &&
      Math.abs(layer.scaleY - transform.scaleY) < 0.0001 &&
      Math.abs(layer.rotation - transform.rotation) < 0.01
    );
  }
}
