import { Injectable, computed, signal } from '@angular/core';
import { CollageLayer, CollageLayerTransform } from '../collage.types';

@Injectable()
export class CollageStoreService {
  private readonly layersState = signal<CollageLayer[]>([]);
  private readonly selectedIdState = signal<string | null>(null);
  private past: CollageLayer[][] = [];
  private future: CollageLayer[][] = [];

  readonly layers = this.layersState.asReadonly();
  readonly selectedId = this.selectedIdState.asReadonly();
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

  replaceAll(layers: CollageLayer[]): void {
    this.layersState.set(this.normalizeZ(layers.map((layer) => ({ ...layer }))));
    this.selectedIdState.set(layers.at(-1)?.id ?? null);
    this.past = [];
    this.future = [];
    this.syncHistorySignals();
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
    this.layersState.set(previous.map((layer) => ({ ...layer })));
    this.ensureSelection();
    this.syncHistorySignals();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.snapshot());
    this.layersState.set(next.map((layer) => ({ ...layer })));
    this.ensureSelection();
    this.syncHistorySignals();
  }

  disposeObjectUrls(): void {
    const urls = new Set(
      this.layersState().flatMap((layer) => [layer.cutoutImageUrl, layer.sourceImageUrl]),
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

  private snapshot(): CollageLayer[] {
    return this.layersState().map((layer) => ({ ...layer }));
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
