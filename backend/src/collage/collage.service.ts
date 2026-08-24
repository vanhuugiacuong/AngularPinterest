import { Injectable, InternalServerErrorException } from '@nestjs/common';

@Injectable()
export class CollageService {
  private readonly segmentationServiceUrl =
    process.env.SEGMENTATION_SERVICE_URL || 'http://localhost:8002';

  async cutoutObject(buffer: Buffer, filename: string, mimetype: string): Promise<Buffer> {
    try {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: mimetype });
      formData.append('file', blob, filename);

      const response = await fetch(`${this.segmentationServiceUrl}/segment`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Segmentation service error: ${response.statusText} - ${errorText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      throw new InternalServerErrorException(
        `Không thể cắt vật thể ra khỏi ảnh: ${(error as Error).message}`,
      );
    }
  }
}
