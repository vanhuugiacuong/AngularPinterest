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
 * is shown so the user can close it and try again. Uses the shared
 * .nf-dialog-* primitives (see styles.css) for backdrop/panel/buttons —
 * only the three-state processing/success/error body is bespoke. */
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
  private previousBodyOverflow?: string;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']) {
      if (this.open) {
        this.previouslyFocused = document.activeElement as HTMLElement | null;
        this.previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        setTimeout(() => this.dialogElRef?.nativeElement.focus(), 0);
      } else {
        document.body.style.overflow = this.previousBodyOverflow ?? '';
        if (this.previouslyFocused) {
          this.previouslyFocused.focus();
          this.previouslyFocused = null;
        }
      }
    }

    if (changes['status'] && this.open && this.status === 'error') {
      setTimeout(() => this.retryBtnRef?.nativeElement.focus(), 0);
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!this.open) return;

    if (event.key === 'Escape') {
      if (this.status === 'error') this.dismiss.emit();
      return;
    }

    if (event.key === 'Tab') {
      const panel = this.dialogElRef?.nativeElement;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
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
