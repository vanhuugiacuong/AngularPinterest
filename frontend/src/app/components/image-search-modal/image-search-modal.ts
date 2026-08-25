import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Output, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImageSearchStore } from '../../core/services/image-search-store';

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB — matches the backend's search-by-image limit

/**
 * "Tải hình ảnh lên để tìm kiếm" panel opened from the navbar's camera
 * button. Handles file-picker + drag/drop selection, client-side format/size
 * validation, and a preview — the actual embedding search runs through
 * ImageSearchStore (shared with the /feed results view) so this component
 * stays a thin, disposable UI shell around it.
 */
@Component({
  selector: 'app-image-search-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './image-search-modal.html',
  styleUrl: './image-search-modal.css',
})
export class ImageSearchModal implements AfterViewInit {
  public store = inject(ImageSearchStore);

  @Output() closed = new EventEmitter<void>();
  @Output() searched = new EventEmitter<void>();

  @ViewChild('panel') private panel?: ElementRef<HTMLElement>;

  public isDragging = signal(false);
  public selectedFile = signal<File | null>(null);
  public localPreviewUrl = signal<string | null>(null);
  public validationError = signal<string | null>(null);

  private readonly previouslyFocused: HTMLElement | null =
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  private readonly previousBodyOverflow =
    typeof document !== 'undefined' ? document.body.style.overflow : '';

  constructor() {
    if (typeof document !== 'undefined') document.body.style.overflow = 'hidden';
  }

  ngAfterViewInit(): void {
    this.panel?.nativeElement.focus();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.close();
      return;
    }

    if (event.key === 'Tab') {
      const panel = this.panel?.nativeElement;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.handleFile(file);
  }

  onFileInputChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.handleFile(file);
    input.value = '';
  }

  private handleFile(file: File) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      this.validationError.set('Định dạng ảnh không được hỗ trợ. Vui lòng chọn JPG, JPEG, PNG hoặc WebP.');
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      this.validationError.set('Ảnh vượt quá dung lượng cho phép (tối đa 10MB).');
      return;
    }

    this.validationError.set(null);
    this.revokeLocalPreview();
    this.selectedFile.set(file);
    this.localPreviewUrl.set(URL.createObjectURL(file));
  }

  removeSelectedFile() {
    this.revokeLocalPreview();
    this.selectedFile.set(null);
    this.validationError.set(null);
  }

  async runSearch() {
    const file = this.selectedFile();
    if (!file) return;
    const success = await this.store.searchByImage(file);
    if (success) {
      this.searched.emit();
    }
  }

  close() {
    this.revokeLocalPreview();
    this.selectedFile.set(null);
    this.validationError.set(null);
    document.body.style.overflow = this.previousBodyOverflow;
    this.closed.emit();
    this.previouslyFocused?.focus();
  }

  private revokeLocalPreview() {
    const current = this.localPreviewUrl();
    if (current) {
      URL.revokeObjectURL(current);
    }
    this.localPreviewUrl.set(null);
  }
}
