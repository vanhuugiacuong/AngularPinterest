import {
  Component,
  ElementRef,
  Input,
  Output,
  EventEmitter,
  HostListener,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

/** How long the closing animation runs before the dialog leaves the DOM.
 *  Must stay in step with the .nf-auth--leaving transitions in the stylesheet. */
const EXIT_MS = 420;

/**
 * Presentation-only login dialog for the pre-login experience.
 *
 * Owns none of the auth logic: Landing still calls
 * SupabaseService.signInWithGoogle() and holds the open/error/pending state;
 * this component renders it and emits intent (`loginRequested`,
 * `closeModal`). The mechanism stays a modal, exactly as before — this is a
 * visual redesign, not a routing change.
 *
 * Google OAuth is the only credential path this project exposes
 * (SupabaseService has signInWithGoogle/signOut and nothing else), so there
 * is no email/password form, sign-up, or password-reset screen to restyle
 * here — and none is invented.
 */
@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './auth-modal.html',
  styleUrl: './auth-modal.css',
})
export class AuthModal implements OnChanges, OnDestroy {
  @Input() open = false;
  @Input() errorMsg: string | null = null;
  @Input() isSigningIn = false;

  @Output() closeModal = new EventEmitter<void>();
  @Output() loginRequested = new EventEmitter<void>();

  @ViewChild('panel') private panel?: ElementRef<HTMLElement>;

  /** Pointer parallax offsets (-0.5..0.5) for the floating object field. */
  public readonly px = signal(0);
  public readonly py = signal(0);

  /** `open` drives intent; these two drive rendering. The dialog outlives a
   *  false `open` by one exit animation so it can leave gracefully instead of
   *  being ripped out of the DOM mid-frame. */
  public readonly visible = signal(false);
  public readonly leaving = signal(false);

  private readonly reducedMotion =
    typeof window !== 'undefined' && 'matchMedia' in window
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  private parallaxFrame = 0;
  private exitTimer = 0;
  private previouslyFocused: HTMLElement | null = null;
  private previousBodyOverflow: string | null = null;
  private ownsBodyScrollLock = false;

  ngOnChanges(changes: SimpleChanges) {
    if (!changes['open']) return;

    if (this.open) {
      clearTimeout(this.exitTimer);
      this.leaving.set(false);
      const wasVisible = this.visible();
      this.visible.set(true);
      if (!wasVisible) {
        this.previouslyFocused = (document.activeElement as HTMLElement) || null;
        this.lockBodyScroll();
        // Panel isn't in the DOM until this change detection cycle commits.
        setTimeout(() => this.panel?.nativeElement.focus());
      }
    } else if (this.visible()) {
      this.leaving.set(true);
      this.previouslyFocused?.focus();
      this.exitTimer = window.setTimeout(
        () => {
          this.visible.set(false);
          this.leaving.set(false);
          this.releaseBodyScroll();
        },
        this.reducedMotion ? 0 : EXIT_MS,
      );
    }
  }

  ngOnDestroy() {
    clearTimeout(this.exitTimer);
    if (this.parallaxFrame) cancelAnimationFrame(this.parallaxFrame);
    this.releaseBodyScroll();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if (!this.open) return;

    if (event.key === 'Escape') {
      this.requestClose();
      return;
    }

    if (event.key === 'Tab') {
      const panel = this.panel?.nativeElement;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
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

  onBackdropClick() {
    // Ignore clicks landing during the exit animation — the dialog is already
    // on its way out and a second emit would re-run the caller's close flow.
    if (this.leaving()) return;
    this.requestClose();
  }

  /** Release this modal's scroll lock before notifying Landing. The landing
   * loader immediately takes its own lock for the return-to-hero animation;
   * ownership prevents the modal's delayed exit cleanup from overwriting it. */
  requestClose() {
    if (!this.open || this.leaving()) return;
    this.releaseBodyScroll();
    this.closeModal.emit();
  }

  private lockBodyScroll() {
    if (this.ownsBodyScrollLock) return;
    this.previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    this.ownsBodyScrollLock = true;
  }

  private releaseBodyScroll() {
    if (!this.ownsBodyScrollLock) return;
    document.body.style.overflow = this.previousBodyOverflow ?? '';
    this.previousBodyOverflow = null;
    this.ownsBodyScrollLock = false;
  }

  /** Very light pointer parallax on the objects drifting behind the glass. */
  onPointerMove(event: MouseEvent) {
    if (this.reducedMotion || this.leaving() || this.parallaxFrame) return;
    this.parallaxFrame = requestAnimationFrame(() => {
      this.px.set(event.clientX / (window.innerWidth || 1) - 0.5);
      this.py.set(event.clientY / (window.innerHeight || 1) - 0.5);
      this.parallaxFrame = 0;
    });
  }
}
