import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';

export type PublishDialogStatus = 'processing' | 'success' | 'error';

/** Blocking progress dialog for the Create page's publish flow — replaces
 * alert()/confirm() for the submit result. Cannot be dismissed via backdrop
 * or Escape while `status === 'processing'`; both are enabled once an error
 * is shown so the user can close it and try again. */
@Component({
  selector: 'app-publish-progress-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './publish-progress-dialog.html',
  styleUrl: './publish-progress-dialog.css',
})
export class PublishProgressDialog implements OnChanges {
  @Input() open = false;
  @Input() status: PublishDialogStatus = 'processing';
  @Input() message = 'Đang xử lý…';
  @Input() errorMessage = 'Đã xảy ra lỗi. Vui lòng thử lại.';

  @Output() retry = new EventEmitter<void>();
  @Output() dismiss = new EventEmitter<void>();

  @ViewChild('dialogEl') dialogElRef?: ElementRef<HTMLElement>;
  @ViewChild('retryBtn') retryBtnRef?: ElementRef<HTMLButtonElement>;

  private previouslyFocused: HTMLElement | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']) {
      if (this.open) {
        this.previouslyFocused = document.activeElement as HTMLElement | null;
        setTimeout(() => this.dialogElRef?.nativeElement.focus(), 0);
      } else if (this.previouslyFocused) {
        this.previouslyFocused.focus();
        this.previouslyFocused = null;
      }
    }

    if (changes['status'] && this.open && this.status === 'error') {
      setTimeout(() => this.retryBtnRef?.nativeElement.focus(), 0);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open && this.status === 'error') {
      this.dismiss.emit();
    }
  }

  onBackdropClick(): void {
    if (this.status === 'error') {
      this.dismiss.emit();
    }
  }

  onRetryClick(): void {
    this.retry.emit();
  }

  onCloseClick(): void {
    this.dismiss.emit();
  }
}
