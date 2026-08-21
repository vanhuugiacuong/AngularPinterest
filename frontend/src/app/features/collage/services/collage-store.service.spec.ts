import { describe, expect, it } from 'vitest';
import { CollageLayer } from '../collage.types';
import { CollageStoreService } from './collage-store.service';

function layer(id: string, zIndex: number): CollageLayer {
  return {
    id,
    sourceImageUrl: `https://example.com/${id}.jpg`,
    cutoutImageUrl: `blob:${id}`,
    cutoutBlob: new Blob(['png'], { type: 'image/png' }),
    x: 540,
    y: 960,
    width: 400,
    height: 600,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    zIndex,
    cropX: 0,
    cropY: 0,
    cropWidth: 1,
    cropHeight: 1,
  };
}

describe('CollageStoreService', () => {
  it('adds, selects, duplicates, deletes and restores independent layers', () => {
    const store = new CollageStoreService();
    store.add(layer('first', 0));
    store.add(layer('second', 1));

    expect(store.layers().map((item) => item.id)).toEqual(['first', 'second']);
    expect(store.selectedId()).toBe('second');

    store.duplicate();
    expect(store.layers()).toHaveLength(3);
    expect(store.selectedLayer()?.id).not.toBe('second');

    store.remove();
    expect(store.layers()).toHaveLength(2);
    store.undo();
    expect(store.layers()).toHaveLength(3);
    store.redo();
    expect(store.layers()).toHaveLength(2);
  });

  it('updates transforms and changes the z-order with undo support', () => {
    const store = new CollageStoreService();
    store.replaceAll([layer('first', 0), layer('second', 1)]);
    store.select('first');
    store.bringToFront();

    expect(store.layers().find((item) => item.id === 'first')?.zIndex).toBe(1);

    store.updateTransform('first', {
      x: 200,
      y: 300,
      scaleX: 0.5,
      scaleY: 0.5,
      rotation: 25,
    });
    expect(store.selectedLayer()).toMatchObject({
      x: 200,
      y: 300,
      scaleX: 0.5,
      scaleY: 0.5,
      rotation: 25,
    });

    store.undo();
    expect(store.selectedLayer()).toMatchObject({ x: 540, y: 960, rotation: 0 });
  });

  it('uses the dragged list order as the canvas stacking order', () => {
    const store = new CollageStoreService();
    store.replaceAll([layer('first', 0), layer('second', 1), layer('third', 2)]);

    store.reorderFromFront(['first', 'third', 'second']);

    const frontToBack = [...store.layers()]
      .sort((a, b) => b.zIndex - a.zIndex)
      .map((item) => item.id);
    expect(frontToBack).toEqual(['first', 'third', 'second']);
    expect(store.layers().find((item) => item.id === 'first')?.zIndex).toBe(2);
  });
});
