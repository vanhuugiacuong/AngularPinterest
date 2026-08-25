import { Directive, ElementRef, Input, OnChanges, SimpleChanges, inject } from '@angular/core';

/** Replays a short "bump" animation on the host element every time the bound
 * count increases (never on first render or on a decrease) — the visual cue
 * that "something just arrived" for unread badges fed by realtime pushes.
 * See `.nf-badge-bump` in styles.css for the keyframes. */
@Directive({
  selector: '[appBadgeBump]',
  standalone: true,
})
export class BadgeBumpDirective implements OnChanges {
  @Input('appBadgeBump') count: number | null = 0;

  private el = inject(ElementRef<HTMLElement>);
  private previous: number | null = null;
  private resetTimer?: ReturnType<typeof setTimeout>;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['count']) return;
    const next = this.count ?? 0;
    if (this.previous !== null && next > this.previous) {
      this.bump();
    }
    this.previous = next;
  }

  private bump(): void {
    const el = this.el.nativeElement;
    el.classList.remove('nf-badge-bump');
    // Force a reflow so the animation restarts even if it's still mid-play
    // from a very recent bump.
    void el.offsetWidth;
    el.classList.add('nf-badge-bump');
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => el.classList.remove('nf-badge-bump'), 550);
  }
}
