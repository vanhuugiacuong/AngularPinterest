import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PinService, Pin } from './pin';
import { ToastService } from './toast';
import { ModerationService } from './moderation';
import { SupabaseService } from './supabase';

@Injectable({
  providedIn: 'root'
})
export class VisualSearchService {
  private router = inject(Router);
  private pinService = inject(PinService);
  private toastService = inject(ToastService);
  private moderationService = inject(ModerationService);
  private supabaseService = inject(SupabaseService);

  public isOpen = signal<boolean>(false);
  public previewUrl = signal<string | null>(null);
  public isLoading = signal<boolean>(false);
  public isCheckingImage = signal<boolean>(false);

  // Kept separate from `previewUrl`/`results` above (which are the modal's own working
  // state and get cleared every time the modal reopens) so the search page can still show
  // the query image + results after the modal has already closed and reset.
  public lastQueryImageUrl = signal<string | null>(null);
  public results = signal<Pin[] | null>(null);

  private selectedFile: File | null = null;

  open() {
    this.reset();
    this.isOpen.set(true);
  }

  close() {
    this.isOpen.set(false);
    this.reset();
  }

  reset() {
    if (this.previewUrl()) {
      URL.revokeObjectURL(this.previewUrl()!);
    }
    this.previewUrl.set(null);
    this.selectedFile = null;
    this.isLoading.set(false);
    this.isCheckingImage.set(false);
  }

  async selectFile(file: File) {
    if (!file.type.startsWith('image/')) {
      this.toastService.error('Vui lòng chọn một tệp hình ảnh.');
      return;
    }

    this.isCheckingImage.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        await this.moderationService.checkImage(file, token);
      }
      if (this.previewUrl()) {
        URL.revokeObjectURL(this.previewUrl()!);
      }
      this.selectedFile = file;
      this.previewUrl.set(URL.createObjectURL(file));
    } catch (error: any) {
      this.toastService.error(error?.message || 'Hình ảnh không hợp lệ hoặc vi phạm tiêu chuẩn cộng đồng.');
      this.reset();
    } finally {
      this.isCheckingImage.set(false);
    }
  }

  async submit() {
    if (!this.selectedFile) return;
    this.isLoading.set(true);
    try {
      const formData = new FormData();
      formData.append('image', this.selectedFile);
      const results = await this.pinService.searchByImage(formData);
      this.results.set(results);
      // Hand the object URL off to lastQueryImageUrl for the search page to keep using —
      // clear it here without revoking so a later reset() (next modal open) doesn't
      // invalidate the URL the search page is still displaying.
      this.lastQueryImageUrl.set(this.previewUrl());
      this.previewUrl.set(null);
      this.selectedFile = null;
      this.isOpen.set(false);
      this.router.navigate(['/search'], { queryParams: { visual: '1' } });
    } catch (error: any) {
      this.toastService.error(error?.message || 'Không thể tìm kiếm bằng hình ảnh.');
    } finally {
      this.isLoading.set(false);
    }
  }
}
