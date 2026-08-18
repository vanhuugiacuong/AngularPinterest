import { Injectable, inject, signal } from '@angular/core';
import { Pin, PinService } from './pin';

/** Bridges the image-search modal (hosted in the navbar, present on every
 * authenticated page) with the /feed results view: the modal uploads the
 * image and stores the outcome here, then navigates to /feed?mode=image,
 * where Home reads these signals instead of calling PinService.searchPins.
 * Same plain-signal-service idiom as SidebarStateService. */
@Injectable({ providedIn: 'root' })
export class ImageSearchStore {
  private pinService = inject(PinService);

  public readonly previewUrl = signal<string | null>(null);
  public readonly results = signal<Pin[]>([]);
  public readonly isLoading = signal(false);
  public readonly error = signal<string | null>(null);

  async searchByImage(file: File): Promise<boolean> {
    this.reset();
    this.previewUrl.set(URL.createObjectURL(file));
    this.isLoading.set(true);
    try {
      const results = await this.pinService.searchPinsByImage(file);
      this.results.set(results || []);
      return true;
    } catch (error) {
      console.error('Error searching by image:', error);
      this.error.set(
        error instanceof Error ? error.message : 'Không thể tìm kiếm bằng hình ảnh lúc này.',
      );
      return false;
    } finally {
      this.isLoading.set(false);
    }
  }

  reset(): void {
    const currentPreview = this.previewUrl();
    if (currentPreview) {
      URL.revokeObjectURL(currentPreview);
    }
    this.previewUrl.set(null);
    this.results.set([]);
    this.isLoading.set(false);
    this.error.set(null);
  }
}
