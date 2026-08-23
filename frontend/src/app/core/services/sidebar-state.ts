import { Injectable, signal } from '@angular/core';

const HOVER_QUERY = '(hover: hover) and (pointer: fine)';

@Injectable({ providedIn: 'root' })
export class SidebarStateService {
  public readonly isOpen = signal(false);

  private readonly supportsHoverSignal = signal(
    typeof window !== 'undefined' && !!window.matchMedia ? window.matchMedia(HOVER_QUERY).matches : false,
  );

  /** Tracks hover/pointer capability changes (e.g. a 2-in-1 laptop docking
   * a mouse) rather than freezing whatever was true at page load. */
  get supportsHover(): boolean {
    return this.supportsHoverSignal();
  }

  constructor() {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(HOVER_QUERY);
    mql.addEventListener('change', (event) => this.supportsHoverSignal.set(event.matches));
  }

  // Comfortably longer than the rail's own open/close slide (see
  // sidebar.html's `duration-[250ms]`) so a fast cursor moving from the
  // trigger toward the rail never gets closed out from under it mid-slide —
  // the close-timer must not be able to win a race against the animation
  // it's waiting behind.
  private static readonly CLOSE_DELAY_MS = 280;

  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  openSidebar(): void {
    this.clearTimer();
    this.isOpen.set(true);
  }

  scheduleClose(): void {
    this.clearTimer();
    // Touch/non-hover devices have no reliable mouseleave semantics — closing
    // there is driven explicitly by backdrop tap, Escape, or nav selection,
    // never by this timer.
    if (!this.supportsHover) {
      return;
    }
    this.closeTimer = setTimeout(() => {
      this.isOpen.set(false);
      this.closeTimer = null;
    }, SidebarStateService.CLOSE_DELAY_MS);
  }

  cancelClose(): void {
    this.clearTimer();
  }

  toggle(): void {
    if (this.isOpen()) {
      this.close();
    } else {
      this.openSidebar();
    }
  }

  close(): void {
    this.clearTimer();
    this.isOpen.set(false);
  }

  private clearTimer(): void {
    if (this.closeTimer !== null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }
}
