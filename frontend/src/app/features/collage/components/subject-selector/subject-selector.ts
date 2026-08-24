import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CollageImageSource, SegmentationResult } from '../../collage.types';
import { SEGMENTATION_PROVIDER, SegmentationPoint } from '../../services/segmentation-provider';

const WHOLE_IMAGE_MAX_EDGE = 2560;

@Component({
  selector: 'app-subject-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './subject-selector.html',
  styleUrl: './subject-selector.css',
})
export class SubjectSelectorComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) source!: CollageImageSource;
  @Output() readonly cancelled = new EventEmitter<void>();
  @Output() readonly cutoutAdded = new EventEmitter<SegmentationResult>();

  @ViewChild('dialog') private dialogRef?: ElementRef<HTMLElement>;

  private readonly provider = inject(SEGMENTATION_PROVIDER);
  private cutoutResult: SegmentationResult | null = null;
  private cutoutUrl: string | null = null;
  private requestId = 0;
  private destroyed = false;
  private readonly previouslyFocused: HTMLElement | null =
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  private readonly previousBodyOverflow =
    typeof document !== 'undefined' ? document.body.style.overflow : '';

  readonly processing = signal(false);
  readonly adding = signal(false);
  readonly preparingWhole = signal(false);
  readonly progress = signal(0);
  readonly error = signal<string | null>(null);
  readonly selectedPoint = signal<SegmentationPoint | null>(null);
  readonly previewUrl = signal<string | null>(null);

  constructor() {
    if (typeof document !== 'undefined') document.body.style.overflow = 'hidden';
  }

  ngAfterViewInit(): void {
    this.dialogRef?.nativeElement.focus();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.requestId++;
    if (this.cutoutUrl) URL.revokeObjectURL(this.cutoutUrl);
    if (typeof document !== 'undefined') {
      document.body.style.overflow = this.previousBodyOverflow;
      this.previouslyFocused?.focus();
    }
  }

  /** Tracks where a press on the backdrop started — see profile.ts's
   * identical helper for why closing must check both the mousedown and
   * click targets instead of the click alone. */
  private backdropMouseDownTarget: EventTarget | null = null;

  onBackdropMouseDown(event: MouseEvent): void {
    this.backdropMouseDownTarget = event.target;
  }

  onBackdropClick(event: MouseEvent): void {
    const startedOnBackdrop = this.backdropMouseDownTarget === event.currentTarget;
    this.backdropMouseDownTarget = null;
    if (startedOnBackdrop && event.target === event.currentTarget) {
      this.cancelled.emit();
    }
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (!this.adding()) this.cancelled.emit();
      return;
    }

    if (event.key === 'Tab') {
      const dialog = this.dialogRef?.nativeElement;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
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

  selectAtPoint(event: MouseEvent): void {
    if (this.processing() || this.adding() || this.preparingWhole()) return;
    const image = event.currentTarget as HTMLImageElement;
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const point: SegmentationPoint = {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
    this.selectedPoint.set(point);
    void this.process(point);
  }

  retry(): void {
    const point = this.selectedPoint();
    if (point && !this.processing()) void this.process(point);
  }

  addCutout(): void {
    if (!this.cutoutResult || this.processing() || this.adding() || this.preparingWhole()) return;
    this.adding.set(true);
    this.cutoutAdded.emit(this.cutoutResult);
  }

  async selectAll(): Promise<void> {
    if (this.processing() || this.adding() || this.preparingWhole()) return;
    this.requestId++;
    this.preparingWhole.set(true);
    this.adding.set(true);
    this.error.set(null);
    try {
      const result = await this.prepareWholeImage();
      if (this.destroyed) return;
      this.cutoutAdded.emit(result);
    } catch (error) {
      console.error('Failed to add the whole image:', error);
      if (!this.destroyed) {
        this.adding.set(false);
        this.error.set('Không thể thêm nguyên bức ảnh. Vui lòng thử ảnh khác.');
      }
    } finally {
      if (!this.destroyed) this.preparingWhole.set(false);
    }
  }

  private async prepareWholeImage(): Promise<SegmentationResult> {
    const bitmap = await createImageBitmap(this.source.blob);
    try {
      const scale = Math.min(1, WHOLE_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      if (scale === 1) {
        return { blob: this.source.blob, width, height, isWholeImage: true };
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) throw new Error('Trình duyệt không hỗ trợ Canvas 2D.');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('Không thể tạo ảnh.'))),
          'image/png',
          1,
        );
      });
      return { blob, width, height, isWholeImage: true };
    } finally {
      bitmap.close();
    }
  }

  private async process(point: SegmentationPoint): Promise<void> {
    const id = ++this.requestId;
    this.processing.set(true);
    this.error.set(null);
    this.progress.set(0);
    this.cutoutResult = null;
    if (this.cutoutUrl) {
      URL.revokeObjectURL(this.cutoutUrl);
      this.cutoutUrl = null;
      this.previewUrl.set(null);
    }

    try {
      const result = await this.provider.selectObject(this.source.blob, point, (progress) => {
        if (!this.destroyed && id === this.requestId) this.progress.set(Math.round(progress * 100));
      });
      if (this.destroyed || id !== this.requestId) return;
      this.cutoutResult = result;
      this.cutoutUrl = URL.createObjectURL(result.blob);
      this.previewUrl.set(this.cutoutUrl);
    } catch (error) {
      console.error('Interactive object segmentation failed:', error);
      if (this.destroyed || id !== this.requestId) return;
      const message = error instanceof Error ? error.message : '';
      this.error.set(
        message.includes('Không tìm thấy vật thể')
          ? message
          : 'Không thể nhận diện vật thể. Hãy kiểm tra mạng rồi nhấn thử lại hoặc chọn điểm khác.',
      );
    } finally {
      if (!this.destroyed && id === this.requestId) this.processing.set(false);
    }
  }
}
