import { Injectable } from '@angular/core';
import type { InteractiveSegmenter } from '@mediapipe/tasks-vision';
import { SegmentationResult } from '../collage.types';
import {
  SegmentationPoint,
  SegmentationProgress,
  SegmentationProvider,
} from './segmentation-provider';

const INFERENCE_MAX_EDGE = 1280;
const OUTPUT_MAX_EDGE = 2560;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite';
const FALLBACK_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';

interface SegmentationMask {
  width: number;
  height: number;
  values: Float32Array;
}

@Injectable({ providedIn: 'root' })
export class InteractiveSegmentationService implements SegmentationProvider {
  private segmenterPromise?: Promise<InteractiveSegmenter>;

  async selectObject(
    source: Blob,
    point: SegmentationPoint,
    onProgress: SegmentationProgress = () => undefined,
  ): Promise<SegmentationResult> {
    onProgress(0.03);
    const segmenter = await this.getSegmenter();
    onProgress(0.42);

    const sourceBitmap = await createImageBitmap(source);
    try {
      const outputSize = this.fitInside(sourceBitmap.width, sourceBitmap.height, OUTPUT_MAX_EDGE);
      const inferenceSize = this.fitInside(outputSize.width, outputSize.height, INFERENCE_MAX_EDGE);
      const inputCanvas = this.createResizedCanvas(
        sourceBitmap,
        inferenceSize.width,
        inferenceSize.height,
      );
      onProgress(0.55);

      // Cho Angular một frame để vẽ loading trước khi MediaPipe bắt đầu suy luận.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const mask = this.runSegmentation(segmenter, inputCanvas, point);
      onProgress(0.82);

      const blob = await this.applyMask(sourceBitmap, outputSize.width, outputSize.height, mask);
      onProgress(1);
      return { blob, width: outputSize.width, height: outputSize.height };
    } finally {
      sourceBitmap.close();
    }
  }

  private getSegmenter(): Promise<InteractiveSegmenter> {
    this.segmenterPromise ??= this.createSegmenterWithFallback().catch((error) => {
      this.segmenterPromise = undefined;
      throw error;
    });
    return this.segmenterPromise;
  }

  private async createSegmenterWithFallback(): Promise<InteractiveSegmenter> {
    const localWasmUrl = new URL('assets/mediapipe/wasm', document.baseURI).href.replace(/\/$/, '');
    try {
      return await this.createSegmenter(localWasmUrl);
    } catch (localAssetError) {
      console.warn(
        'Unable to load local MediaPipe assets, using the CDN fallback.',
        localAssetError,
      );
      return this.createSegmenter(FALLBACK_WASM_URL);
    }
  }

  private async createSegmenter(wasmBaseUrl: string): Promise<InteractiveSegmenter> {
    const { FilesetResolver, InteractiveSegmenter } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(wasmBaseUrl);
    return InteractiveSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL },
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
  }

  private runSegmentation(
    segmenter: InteractiveSegmenter,
    image: HTMLCanvasElement,
    point: SegmentationPoint,
  ): SegmentationMask {
    const result = segmenter.segment(image, { keypoint: point });
    try {
      const mask = result.confidenceMasks?.[0];
      if (!mask) throw new Error('Mô hình không trả về vùng vật thể.');
      return {
        width: mask.width,
        height: mask.height,
        values: mask.getAsFloat32Array().slice(),
      };
    } finally {
      result.close();
    }
  }

  private async applyMask(
    source: ImageBitmap,
    outputWidth: number,
    outputHeight: number,
    mask: SegmentationMask,
  ): Promise<Blob> {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = mask.width;
    maskCanvas.height = mask.height;
    const maskContext = maskCanvas.getContext('2d');
    if (!maskContext) throw new Error('Trình duyệt không hỗ trợ xử lý mặt nạ ảnh.');

    const imageData = maskContext.createImageData(mask.width, mask.height);
    let visiblePixels = 0;
    for (let index = 0; index < mask.values.length; index++) {
      const confidence = Math.max(0, Math.min(1, mask.values[index] ?? 0));
      const alpha = Math.round(confidence * 255);
      const pixel = index * 4;
      imageData.data[pixel] = 255;
      imageData.data[pixel + 1] = 255;
      imageData.data[pixel + 2] = 255;
      imageData.data[pixel + 3] = alpha;
      if (confidence >= 0.5) visiblePixels++;
    }
    if (visiblePixels / mask.values.length < 0.001) {
      throw new Error('Không tìm thấy vật thể rõ ràng tại vị trí bạn vừa nhấn.');
    }
    maskContext.putImageData(imageData, 0, 0);

    const output = document.createElement('canvas');
    output.width = outputWidth;
    output.height = outputHeight;
    const outputContext = output.getContext('2d', { alpha: true });
    if (!outputContext) throw new Error('Trình duyệt không hỗ trợ ảnh nền trong suốt.');
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = 'high';
    outputContext.drawImage(source, 0, 0, outputWidth, outputHeight);
    outputContext.globalCompositeOperation = 'destination-in';
    outputContext.drawImage(maskCanvas, 0, 0, outputWidth, outputHeight);
    outputContext.globalCompositeOperation = 'source-over';
    return this.canvasToBlob(output);
  }

  private createResizedCanvas(
    source: ImageBitmap,
    width: number,
    height: number,
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Trình duyệt không hỗ trợ xử lý Canvas 2D.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, width, height);
    return canvas;
  }

  private fitInside(width: number, height: number, maxEdge: number) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }

  private canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Không thể tạo ảnh PNG.'))),
        'image/png',
        1,
      );
    });
  }
}
