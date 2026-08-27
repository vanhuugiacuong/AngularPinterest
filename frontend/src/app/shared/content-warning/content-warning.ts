import {
  AfterViewInit,
  Component,
  ElementRef,
  ViewChild,
  signal,
} from '@angular/core';

/** Once acknowledged, never shown again in this browser. */
const ACK_STORAGE_KEY = 'novaframe:content-warning-ack';

/** First-visit content notice for the landing page.
 *
 * This is a WARNING, not age verification: it does not and cannot establish how
 * old the visitor is. Anything that actually gates minors (date of birth, an
 * account flag, blocking on failure) is a different feature with legal weight,
 * and calling this one an "18+ gate" would be claiming something it does not do.
 */
@Component({
  selector: 'app-content-warning',
  standalone: true,
  templateUrl: './content-warning.html',
  styleUrl: './content-warning.css',
})
export class ContentWarningComponent implements AfterViewInit {
  @ViewChild('dialog') private dialogRef?: ElementRef<HTMLElement>;
  @ViewChild('continueButton') private continueRef?: ElementRef<HTMLButtonElement>;

  readonly isOpen = signal(false);

  constructor() {
    this.isOpen.set(!this.hasAcknowledged());
  }

  /** Move focus into the dialog so the keyboard starts inside it — without
   * this the focus trap below has nothing to trap, since focus would still be
   * on whatever was behind the notice. */
  ngAfterViewInit(): void {
    if (!this.isOpen()) return;
    (this.continueRef?.nativeElement ?? this.dialogRef?.nativeElement)?.focus();
  }

  /** Every localStorage touch is wrapped: a private window, blocked site data,
   * or a full quota all throw on access rather than returning null, and a
   * content notice must never be the thing that breaks the landing page. On
   * failure the notice simply shows again next visit. */
  private hasAcknowledged(): boolean {
    try {
      return localStorage.getItem(ACK_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  acknowledge(): void {
    try {
      localStorage.setItem(ACK_STORAGE_KEY, '1');
    } catch {
      // Không ghi được thì lần sau hiện lại — chấp nhận được, hơn là chặn trang.
    }
    this.isOpen.set(false);
  }

  /** "Thoát" — back out of the site. history.back() only works if there is
   * somewhere to go back to; a directly-opened tab has no history entry, so
   * fall back to closing the notice rather than leaving the user stuck behind a
   * button that does nothing. */
  leave(): void {
    if (typeof window === 'undefined') return;
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    this.isOpen.set(false);
  }

  /** A real modal, so a focus trap IS correct here — unlike the cutout panel,
   * this genuinely owns the screen and there is nothing behind it to reach. */
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const dialog = this.dialogRef?.nativeElement;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'),
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
