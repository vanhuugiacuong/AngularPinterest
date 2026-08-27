import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SegmentationResult } from '../../collage.types';
import { SubjectSelectorComponent } from './subject-selector';

function attachCanvases(component: SubjectSelectorComponent): void {
  const maskCanvas = document.createElement('canvas');
  const highlightCanvas = document.createElement('canvas');
  (component as unknown as {
    maskCanvasRef: { nativeElement: HTMLCanvasElement };
    highlightCanvasRef: { nativeElement: HTMLCanvasElement };
  }).maskCanvasRef = { nativeElement: maskCanvas };
  (component as unknown as {
    highlightCanvasRef: { nativeElement: HTMLCanvasElement };
  }).highlightCanvasRef = { nativeElement: highlightCanvas };
}

describe('SubjectSelectorComponent', () => {
  let component: SubjectSelectorComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    component = TestBed.runInInjectionContext(() => new SubjectSelectorComponent());
    component.source = {
      sourceImageUrl: 'https://example.com/source.jpg',
      blob: new Blob(['image'], { type: 'image/jpeg' }),
      title: 'Ảnh kiểm tra',
    };
  });

  afterEach(() => component.ngOnDestroy());

  it('sizes the mask canvas to the loaded image and starts with nothing painted', () => {
    attachCanvases(component);
    const canvas = (component as unknown as { maskCanvasRef: { nativeElement: HTMLCanvasElement } })
      .maskCanvasRef.nativeElement;
    const img = { naturalWidth: 800, naturalHeight: 600 } as HTMLImageElement;

    component.onImageLoad({ target: img } as unknown as Event);

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(component.imageReady()).toBe(true);
    expect(component.hasPainted()).toBe(false);
  });

  it('marks hasPainted true after a stroke is drawn on the mask', () => {
    attachCanvases(component);
    const img = { naturalWidth: 400, naturalHeight: 400 } as HTMLImageElement;
    component.onImageLoad({ target: img } as unknown as Event);

    (component as unknown as { strokeTo: (point: { x: number; y: number }) => void }).strokeTo({
      x: 100,
      y: 100,
    });

    expect(component.hasPainted()).toBe(true);
  });

  it('adds the whole image immediately when selecting all', async () => {
    const wholeResult: SegmentationResult = {
      blob: component.source.blob,
      width: 1200,
      height: 800,
      isWholeImage: true,
    };
    const testComponent = component as unknown as {
      prepareWholeImage: () => Promise<SegmentationResult>;
    };
    vi.spyOn(testComponent, 'prepareWholeImage').mockResolvedValue(wholeResult);
    const emitted = vi.spyOn(component.cutoutAdded, 'emit');

    await component.selectAll();

    expect(emitted).toHaveBeenCalledOnce();
    expect(emitted).toHaveBeenCalledWith(wholeResult);
  });

  it('does nothing when addCutout is called before anything is painted', async () => {
    const emitted = vi.spyOn(component.cutoutAdded, 'emit');

    await component.addCutout();

    expect(emitted).not.toHaveBeenCalled();
  });

  it('clearMask resets hasPainted back to false', () => {
    attachCanvases(component);
    const img = { naturalWidth: 400, naturalHeight: 400 } as HTMLImageElement;
    component.onImageLoad({ target: img } as unknown as Event);
    (component as unknown as { strokeTo: (point: { x: number; y: number }) => void }).strokeTo({
      x: 50,
      y: 50,
    });
    expect(component.hasPainted()).toBe(true);

    component.clearMask();

    expect(component.hasPainted()).toBe(false);
  });
});
