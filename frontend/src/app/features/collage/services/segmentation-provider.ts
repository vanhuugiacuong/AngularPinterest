import { InjectionToken } from '@angular/core';
import { SegmentationResult } from '../collage.types';

export type SegmentationProgress = (progress: number) => void;

export interface SegmentationPoint {
  x: number;
  y: number;
}

export interface SegmentationProvider {
  selectObject(
    source: Blob,
    point: SegmentationPoint,
    onProgress?: SegmentationProgress,
  ): Promise<SegmentationResult>;
}

export const SEGMENTATION_PROVIDER = new InjectionToken<SegmentationProvider>(
  'SEGMENTATION_PROVIDER',
);
