import { Injectable } from '@angular/core';
import { SegmentationResult } from '../collage.types';
import { SegmentationProgress } from './segmentation-provider';

const SEGMENTATION_MAX_EDGE = 1536;
const CUTOUT_MAX_EDGE = 2560;

interface PreparedImage {
  inferenceBlob: Blob;
  outputBlob: Blob;
  outputWidth: number;
  outputHeight: number;
}

@Injectable({ providedIn: 'root' })
export class ClientSegmentationService {
  private modulePromise?: Promise<typeof import('@imgly/background-removal')>;
  private activeProgress: SegmentationProgress = () => undefined;
  private readonly modelConfig = {
    model: 'isnet_quint8' as const,
    device: 'cpu' as const,
    rescale: true,
    output: { format: 'image/png' as const, quality: 1 },
    progress: (key: string, current: number, total: number) => {
      if (key.startsWith('compute:')) {
        this.activeProgress(0.55 + (total > 0 ? current / total : 0) * 0.35);
        return;
      }
      this.activeProgress(0.1 + (total > 0 ? current / total : 0) * 0.45);
    },
  };

  async removeBackground(
    source: Blob,
    onProgress: SegmentationProgress = () => undefined,
  ): Promise<SegmentationResult> {
    this.activeProgress = onProgress;
    onProgress(0.02);
    try {
      const prepared = await this.prepareImage(source);
      onProgress(0.08);

      const backgroundRemoval = await this.loadModule();

      // IMG.LY memoizes the ONNX session by configuration and also keeps its
      // downloaded model/WASM assets in the browser cache. Calling preload here
      // makes the first download visible through the progress callback; later
      // selections reuse the same in-memory session instead of loading it again.
      await backgroundRemoval.preload(this.modelConfig);
      const segmented = await backgroundRemoval.removeBackground(
        prepared.inferenceBlob,
        this.modelConfig,
      );
      onProgress(0.92);

      const blob = await this.applyMaskAtOutputResolution(
        prepared.outputBlob,
        segmented,
        prepared.outputWidth,
        prepared.outputHeight,
      );
      if (!(await this.containsVisibleSubject(blob))) {
        throw new Error('Không tìm thấy chủ thể rõ ràng trong ảnh. Vui lòng thử ảnh khác.');
      }
      onProgress(1);
      return { blob, width: prepared.outputWidth, height: prepared.outputHeight };
    } finally {
      this.activeProgress = () => undefined;
    }
  }

  private loadModule(): Promise<typeof import('@imgly/background-removal')> {
    this.modulePromise ??= import('@imgly/background-removal');
    return this.modulePromise;
  }

  private async prepareImage(source: Blob): Promise<PreparedImage> {
    const bitmap = await createImageBitmap(source);
    try {
      const outputSize = this.fitInside(bitmap.width, bitmap.height, CUTOUT_MAX_EDGE);
      const inferenceSize = this.fitInside(
        outputSize.width,
        outputSize.height,
        SEGMENTATION_MAX_EDGE,
      );

      const outputBlob = await this.resizeBitmap(
        bitmap,
        outputSize.width,
        outputSize.height,
        'image/png',
      );
      const inferenceBlob =
        inferenceSize.width === outputSize.width && inferenceSize.height === outputSize.height
          ? outputBlob
          : await this.resizeBitmap(
              bitmap,
              inferenceSize.width,
              inferenceSize.height,
              'image/jpeg',
              0.9,
            );

      return {
        inferenceBlob,
        outputBlob,
        outputWidth: outputSize.width,
        outputHeight: outputSize.height,
      };
    } finally {
      bitmap.close();
    }
  }

  private fitInside(width: number, height: number, maxEdge: number) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }

  private async resizeBitmap(
    bitmap: ImageBitmap,
    width: number,
    height: number,
    type: 'image/png' | 'image/jpeg',
    quality = 1,
  ): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: type === 'image/png' });
    if (!context) throw new Error('Trình duyệt không hỗ trợ xử lý canvas 2D.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    return this.canvasToBlob(canvas, type, quality);
  }

  private async applyMaskAtOutputResolution(
    source: Blob,
    segmented: Blob,
    width: number,
    height: number,
  ): Promise<Blob> {
    const [sourceBitmap, maskBitmap] = await Promise.all([
      createImageBitmap(source),
      createImageBitmap(segmented),
    ]);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) throw new Error('Trình duyệt không hỗ trợ xử lý nền trong suốt.');

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(sourceBitmap, 0, 0, width, height);
      context.globalCompositeOperation = 'destination-in';
      context.drawImage(maskBitmap, 0, 0, width, height);
      context.globalCompositeOperation = 'source-over';
      return this.canvasToBlob(canvas, 'image/png', 1);
    } finally {
      sourceBitmap.close();
      maskBitmap.close();
    }
  }

  private canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Không thể tạo ảnh PNG.'))),
        type,
        quality,
      );
    });
  }

  private async containsVisibleSubject(blob: Blob): Promise<boolean> {
    const bitmap = await createImageBitmap(blob);
    try {
      const width = 96;
      const height = Math.max(1, Math.round((bitmap.height / bitmap.width) * width));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return true;
      context.drawImage(bitmap, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      let visible = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index]! > 18) visible++;
      }
      return visible / (pixels.length / 4) >= 0.003;
    } finally {
      bitmap.close();
    }
  }
}
