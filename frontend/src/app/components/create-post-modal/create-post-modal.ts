import { Component, ElementRef, EventEmitter, Output, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGES = 10;
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

@Component({
  selector: 'app-create-post-modal',
  imports: [CommonModule],
  templateUrl: './create-post-modal.html',
  styleUrl: './create-post-modal.scss'
})
export class CreatePostModalComponent {
  @Output() filesSelected = new EventEmitter<File[]>();
  @Output() closeModal = new EventEmitter<void>();

  @ViewChild('fileInput') private fileInputRef!: ElementRef<HTMLInputElement>;

  public isDragging = signal(false);
  public errorMessage = signal<string | null>(null);

  close(): void {
    this.closeModal.emit();
  }

  triggerFileInput(): void {
    this.fileInputRef.nativeElement.click();
  }

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.processFiles(input.files);
    }
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.processFiles(files);
    }
  }

  private processFiles(fileList: FileList): void {
    const files = Array.from(fileList);
    const typeValid = files.filter((file) => ALLOWED_IMAGE_TYPES.includes(file.type));
    const sizeValid = typeValid.filter((file) => file.size <= MAX_FILE_SIZE_BYTES);
    const capped = sizeValid.slice(0, MAX_IMAGES);

    if (capped.length < sizeValid.length) {
      this.errorMessage.set(`Chỉ chọn được tối đa ${MAX_IMAGES} ảnh.`);
    } else if (sizeValid.length < typeValid.length) {
      this.errorMessage.set('Có ảnh vượt quá 20MB nên đã bị bỏ qua.');
    } else if (typeValid.length < files.length) {
      this.errorMessage.set('Chỉ hỗ trợ file ảnh (JPG, PNG, WEBP)');
    } else {
      this.errorMessage.set(null);
    }

    if (capped.length > 0) {
      this.filesSelected.emit(capped);
    }
  }
}
