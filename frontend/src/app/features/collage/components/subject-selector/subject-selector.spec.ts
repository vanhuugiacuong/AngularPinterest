import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SegmentationResult } from '../../collage.types';
import { SEGMENTATION_PROVIDER, SegmentationProvider } from '../../services/segmentation-provider';
import { SubjectSelectorComponent } from './subject-selector';

describe('SubjectSelectorComponent', () => {
  let component: SubjectSelectorComponent;
  let selectObject: SegmentationProvider['selectObject'];

  beforeEach(() => {
    selectObject = vi.fn<SegmentationProvider['selectObject']>(
      () => new Promise<SegmentationResult>(() => undefined),
    );
    const provider: SegmentationProvider = { selectObject };
    TestBed.configureTestingModule({
      providers: [{ provide: SEGMENTATION_PROVIDER, useValue: provider }],
    });
    component = TestBed.runInInjectionContext(() => new SubjectSelectorComponent());
    component.source = {
      sourceImageUrl: 'https://example.com/source.jpg',
      blob: new Blob(['image'], { type: 'image/jpeg' }),
      title: 'Ảnh kiểm tra',
    };
  });

  afterEach(() => component.ngOnDestroy());

  it('sends the exact clicked image point to the interactive provider', () => {
    const image = {
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 300 }),
    } as HTMLImageElement;
    const event = { currentTarget: image, clientX: 200, clientY: 200 } as unknown as MouseEvent;

    component.selectAtPoint(event);

    expect(selectObject).toHaveBeenCalledWith(
      component.source.blob,
      { x: 0.25, y: 0.5 },
      expect.any(Function),
    );
    expect(component.selectedPoint()).toEqual({ x: 0.25, y: 0.5 });
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

  it('adds the selected transparent object to the collage', () => {
    const selectedResult: SegmentationResult = {
      blob: new Blob(['cutout'], { type: 'image/png' }),
      width: 640,
      height: 960,
    };
    const testComponent = component as unknown as {
      cutoutResult: SegmentationResult | null;
    };
    testComponent.cutoutResult = selectedResult;
    const emitted = vi.spyOn(component.cutoutAdded, 'emit');

    component.addCutout();

    expect(emitted).toHaveBeenCalledOnce();
    expect(emitted).toHaveBeenCalledWith(selectedResult);
  });
});
