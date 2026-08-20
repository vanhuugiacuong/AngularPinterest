import { Component, OnInit, OnDestroy, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Public-only loading screen. Light-toned, wordmark-centred, with a real
 * progress readout that finishes as soon as the document reports `complete`
 * (so it never invents a wait the user doesn't need). Under
 * prefers-reduced-motion it collapses to a single frame and hands off
 * immediately.
 */
@Component({
  selector: 'app-nf-loader',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './loader.html',
  styleUrl: './loader.css'
})
export class NfLoader implements OnInit, OnDestroy {
  /** Emitted once the loader has finished and been hidden. */
  @Output() finished = new EventEmitter<void>();

  public readonly progress = signal(0);
  public readonly leaving = signal(false);
  public readonly hidden = signal(false);

  /** The wordmark, split so each glyph can be staggered independently. */
  public readonly letters = 'NOVAFRAME'.split('');

  private readonly reducedMotion =
    typeof window !== 'undefined' && 'matchMedia' in window
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  private tickHandle = 0;
  private timeouts: number[] = [];
  private pageLoaded = false;
  private readonly onPageLoad = () => {
    this.pageLoaded = true;
  };

  ngOnInit() {
    if (this.reducedMotion) {
      this.progress.set(100);
      this.finish(0);
      return;
    }

    if (document.readyState === 'complete') {
      this.pageLoaded = true;
    } else {
      window.addEventListener('load', this.onPageLoad, { once: true });
    }

    this.tick();
  }

  /** Advances the counter. It eases toward 90% on its own, then completes
   *  only once the document has actually finished loading — the number
   *  tracks something real rather than running a fixed fake timer. */
  private tick() {
    const step = () => {
      const current = this.progress();
      const ceiling = this.pageLoaded ? 100 : 90;
      const next = current + Math.max((ceiling - current) * 0.12, 0.6);

      if (next >= 100) {
        this.progress.set(100);
        this.finish(320);
        return;
      }

      this.progress.set(Math.min(next, ceiling));
      this.tickHandle = requestAnimationFrame(step);
    };
    this.tickHandle = requestAnimationFrame(step);
  }

  private finish(holdMs: number) {
    this.timeouts.push(
      window.setTimeout(() => {
        this.leaving.set(true);
        this.timeouts.push(
          window.setTimeout(
            () => {
              this.hidden.set(true);
              this.finished.emit();
            },
            this.reducedMotion ? 0 : 700
          )
        );
      }, holdMs)
    );
  }

  ngOnDestroy() {
    if (this.tickHandle) cancelAnimationFrame(this.tickHandle);
    this.timeouts.forEach((t) => clearTimeout(t));
    this.timeouts = [];
    window.removeEventListener('load', this.onPageLoad);
  }
}
