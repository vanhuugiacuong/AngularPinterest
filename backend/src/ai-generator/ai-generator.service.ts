import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AiGeneratorService {
  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Uploads a reference image to Supabase temporary bucket to obtain a public URL
   * needed for Pollinations Image-to-Image API.
   */
  async uploadTempReferenceImage(file: Express.Multer.File): Promise<string> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const extension = file.originalname.split('.').pop() || 'png';
    const filename = `temp_${Date.now()}_${Math.floor(Math.random() * 100000)}.${extension}`;

    // We upload to a Supabase bucket called "temp-uploads"
    const publicUrl = await this.supabaseService.uploadImage(
      'temp-uploads',
      filename,
      file.buffer,
      file.mimetype || 'image/png',
    );

    return publicUrl;
  }

  /**
   * Downloads the generated image bytes from a Pollinations.ai preview URL.
   * Caller (PinsService) is responsible for storing the original + preview -
   * this service only knows how to talk to the Pollinations temp URL.
   */
  async downloadGeneratedImage(imageUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch image from Pollinations: ${response.statusText}`,
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      return {
        buffer: Buffer.from(arrayBuffer),
        contentType: response.headers.get('Content-Type') || 'image/png',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new BadRequestException(`Failed to save AI image: ${message}`);
    }
  }
}
