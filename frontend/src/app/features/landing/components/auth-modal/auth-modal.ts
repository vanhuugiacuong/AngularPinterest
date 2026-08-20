import {
  Component,
  Input,
  Output,
  EventEmitter,
  HostListener,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';

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
  imports: [CommonModule],
  templateUrl: './auth-modal.html',
  styleUrl: './auth-modal.css'
})
export class AuthModal implements OnChanges, OnDestroy {
  @Input() open = false;
  @Input() errorMsg: string | null = null;
  @Input() isSigningIn = false;

  @Output() closeModal = new EventEmitter<void>();
  @Output() loginRequested = new EventEmitter<void>();

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

  ngOnChanges(changes: SimpleChanges) {
    if (!changes['open']) return;

    if (this.open) {
      clearTimeout(this.exitTimer);
      this.leaving.set(false);
      this.visible.set(true);
    } else if (this.visible()) {
      this.leaving.set(true);
      this.exitTimer = window.setTimeout(
        () => {
          this.visible.set(false);
          this.leaving.set(false);
        },
        this.reducedMotion ? 0 : EXIT_MS
      );
    }
  }

  ngOnDestroy() {
    clearTimeout(this.exitTimer);
    if (this.parallaxFrame) cancelAnimationFrame(this.parallaxFrame);
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    if (this.open) {
      this.closeModal.emit();
    }
  }

  onBackdropClick() {
    // Ignore clicks landing during the exit animation — the dialog is already
    // on its way out and a second emit would re-run the caller's close flow.
    if (this.leaving()) return;
    this.closeModal.emit();
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
