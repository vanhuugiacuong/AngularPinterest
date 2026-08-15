import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SidebarStateService {
  public readonly isOpen = signal(false);

  public readonly supportsHover =
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // 150-300ms window so the cursor can travel from the trigger zone to the
  // panel, or from an icon to its tooltip, without the sidebar flickering
  // shut in between.
  private static readonly CLOSE_DELAY_MS = 220;

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
