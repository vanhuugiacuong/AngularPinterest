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

    // Screened BEFORE the object URL exists and before the cutout step opens.
    // This is the collage editor's only unmoderated ingestion point: a pin from
    // the Ý tưởng grid already went through the upload gate, but a local file
    // has never been seen by anything until now. Publishing the finished
    // collage is moderated too, but that is far too late — the image would have
    // been on screen in the editor the whole time.
    if (!(await this.isFileAllowed(file))) return;

    const temporaryUrl = URL.createObjectURL(file);
    this.imageSelected.emit({
      sourceImageUrl: temporaryUrl,
      blob: file,
      title: file.name,
      temporaryUrl,
    });
  }

  /** Returns false only on a definite rejection. An unreachable moderation
   * service lets the pick through — the collage's eventual upload is gated
   * server-side regardless, so failing closed here would break the editor
   * whenever CLIP is down without closing any hole. */
  private async isFileAllowed(file: File): Promise<boolean> {
    this.isScreening.set(true);
    try {
      const token = await this.supabase.getSessionToken();
      if (!token) return true;
      const result = await this.pinService.checkImageModeration(file, token);
      if (result.safe === false) {
        this.error.set(
          result.message || 'Ảnh này có nội dung không phù hợp nên không thể dùng để ghép.',
        );
        return false;
      }
      return true;
    } catch (error) {
      console.error('Collage image pre-screen unavailable:', error);
      return true;
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
