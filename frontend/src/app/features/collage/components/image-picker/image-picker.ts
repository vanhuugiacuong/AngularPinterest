import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Pin, PinService } from '../../../../core/services/pin';
import { SupabaseService } from '../../../../core/services/supabase';
import { ModerationService } from '../../../../core/services/moderation';
import { CollageImageSource } from '../../collage.types';

@Component({
  selector: 'app-collage-image-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './image-picker.html',
  styleUrl: './image-picker.css',
})
export class ImagePickerComponent implements OnInit, OnDestroy {
  @Output() readonly imageSelected = new EventEmitter<CollageImageSource>();

  private readonly pinService = inject(PinService);
  private readonly supabase = inject(SupabaseService);
  private readonly moderation = inject(ModerationService);
  private searchTimer?: ReturnType<typeof setTimeout>;
  private requestId = 0;
  private abortController?: AbortController;

  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;

  readonly pins = signal<Pin[]>([]);
  readonly isLoading = signal(true);
  readonly loadingPinId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly activeTab = signal<'ideas' | 'upload'>('ideas');
  /** True while a picked local file is being screened — the drop zone shows it
   * so the wait is not a dead click. */
  readonly isScreening = signal(false);
  searchQuery = '';

  setTab(tab: 'ideas' | 'upload'): void {
    this.activeTab.set(tab);
  }

  ngOnInit(): void {
    void this.loadPins('');
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.abortController?.abort();
  }

  /** Cho phép thanh công cụ nổi trên canvas mở hộp thoại chọn tệp, dùng lại
   * đúng phần kiểm tra tệp của selectFile() bên dưới. */
  openFileDialog(): void {
    this.fileInput?.nativeElement.click();
  }

  onSearchChange(query: string): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.loadPins(query.trim()), 350);
  }

  async selectPin(pin: Pin): Promise<void> {
    if (this.loadingPinId()) return;
    this.loadingPinId.set(pin.id);
    this.error.set(null);
    this.abortController?.abort();
    this.abortController = new AbortController();
    try {
      const response = await fetch(pin.imageUrl, {
        mode: 'cors',
        signal: this.abortController.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) throw new Error('Tệp nguồn không phải hình ảnh.');
      this.imageSelected.emit({
        sourceImageUrl: pin.imageUrl,
        blob,
        title: pin.title,
        temporaryUrl: URL.createObjectURL(blob),
      });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Unable to load pin image for collage:', error);
        this.error.set(
          'Không thể đọc ảnh này do kết nối hoặc CORS. Hãy thử ảnh khác hoặc tải ảnh từ máy.',
        );
      }
    } finally {
      this.loadingPinId.set(null);
    }
  }

  async selectFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error.set(null);
    if (!file.type.startsWith('image/')) {
      this.error.set('Vui lòng chọn tệp hình ảnh JPG, PNG hoặc WebP.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      this.error.set('Ảnh lớn hơn 15 MB. Vui lòng chọn ảnh nhỏ hơn.');
      return;
    }

    // Screened before the object URL exists and before the cutout step opens.
    // A local file is the one ingestion path into this editor that nothing else
    // ever looks at: a pin from the Ý tưởng grid came through the upload gate,
    // and publishing the finished collage is checked too — but that is far too
    // late, the image would have been on screen throughout the edit.
    if (!(await this.isFileAllowed(file))) return;

    const temporaryUrl = URL.createObjectURL(file);
    this.imageSelected.emit({
      sourceImageUrl: temporaryUrl,
      blob: file,
      title: file.name,
      temporaryUrl,
    });
  }

  /** Uses this branch's own ModerationService (POST /api/moderation/check-image),
   * which throws on a block and resolves silently when the image is fine — a
   * different shape from the web357 branch's PinService.checkImageModeration,
   * which returns a { safe, message } object.
   *
   * FAILS CLOSED, and not by preference: checkImage throws for a block AND for
   * a network/5xx failure alike, so the two cannot be told apart here without
   * guessing at error types. Given the ambiguity, blocking is the right side to
   * land on — the cost of a false block is "cannot add a local image while the
   * moderation service is down", which is visible and recoverable, whereas the
   * cost of a false allow is explicit content sitting in the editor.
   *
   * (Search-by-image on the web357 branch fails OPEN instead, because there the
   * service returns a verdict object and a failure IS distinguishable.) */
  private async isFileAllowed(file: File): Promise<boolean> {
    this.isScreening.set(true);
    try {
      const token = await this.supabase.getSessionToken();
      if (!token) return true;
      await this.moderation.checkImage(file, token);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      // A thrown error here is the block itself, so surface its message.
      this.error.set(message || 'Ảnh này có nội dung không phù hợp nên không thể dùng để ghép.');
      return false;
    } finally {
      this.isScreening.set(false);
    }
  }

  async loadPins(query: string): Promise<void> {
    const id = ++this.requestId;
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const token = await this.supabase.getSessionToken();
      const pins = query
        ? await this.pinService.searchPins(query, 1, 60)
        : await this.pinService.getPins(1, 60, token ?? undefined);
      if (id === this.requestId) this.pins.set(pins);
    } catch (error) {
      console.error('Unable to load collage image picker:', error);
      if (id === this.requestId) {
        this.error.set('Không thể tải danh sách ảnh. Vui lòng thử lại.');
      }
    } finally {
      if (id === this.requestId) this.isLoading.set(false);
    }
  }
}
