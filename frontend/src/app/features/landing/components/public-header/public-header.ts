import { Component, signal, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

interface NavAnchor {
  label: string;
  targetId: string;
}

/**
 * Public-only header for the pre-login experience.
 *
 * Deliberately NOT the shared `app-navbar` used by the authenticated app —
 * no search field, no sidebar trigger, no profile menu, and a light palette
 * that must never reach the post-login shell. It renders over the landing
 * page's own light background, and firms up into a hairline bar on scroll.
 */
@Component({
  selector: 'app-public-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './public-header.html',
  styleUrl: './public-header.css'
})
export class PublicHeader implements OnInit, OnDestroy {
  @Output() loginClick = new EventEmitter<void>();

  public readonly scrolled = signal(false);
  public readonly mobileOpen = signal(false);

  public readonly anchors: NavAnchor[] = [
    { label: 'Tác phẩm', targetId: 'nf-explore' },
    { label: 'Studio', targetId: 'nf-creation' },
    { label: 'Bắt đầu', targetId: 'nf-cta' }
  ];

  private readonly prefersReducedMotion =
    typeof window !== 'undefined' && 'matchMedia' in window
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  private scrollFrame = 0;
  private readonly onScroll = () => this.queueScrollCheck();

  ngOnInit() {
    this.queueScrollCheck();
    window.addEventListener('scroll', this.onScroll, { passive: true });
  }

  ngOnDestroy() {
    window.removeEventListener('scroll', this.onScroll);
    if (this.scrollFrame) cancelAnimationFrame(this.scrollFrame);
  }

  private queueScrollCheck() {
    if (this.scrollFrame) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrolled.set(window.scrollY > 60);
      this.scrollFrame = 0;
    });
  }

  scrollToAnchor(targetId: string) {
    this.mobileOpen.set(false);
    document.getElementById(targetId)?.scrollIntoView({
      behavior: this.prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start'
    });
  }

  scrollToTop() {
    this.mobileOpen.set(false);
    window.scrollTo({ top: 0, behavior: this.prefersReducedMotion ? 'auto' : 'smooth' });
  }

  toggleMobileMenu() {
    this.mobileOpen.update((v) => !v);
  }

  emitLoginClick() {
    this.mobileOpen.set(false);
    this.loginClick.emit();
  }
}
