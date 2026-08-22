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
      file.mimetype || 'image/png'
    );
    
    return publicUrl;
  }

  /**
   * Downloads the generated image from Pollinations.ai URL and uploads it
   * permanently to the Supabase "pins" bucket.
   */
  async saveAiImageToStorage(imageUrl: string, userId: string): Promise<string> {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image from Pollinations: ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = response.headers.get('Content-Type') || 'image/png';
      
      const filename = `${userId}/ai_${Date.now()}.png`;
      
      // Upload to permanent bucket "pins"
      const permanentUrl = await this.supabaseService.uploadImage(
        'pins',
        filename,
        buffer,
        contentType
      );
      
      return permanentUrl;
    } catch (error) {
      throw new BadRequestException(`Failed to save AI image: ${error.message}`);
    }
  }
}
