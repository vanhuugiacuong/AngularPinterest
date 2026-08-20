/**
 * Minimal scroll-progress engine for the public landing experience.
 *
 * This is the ScrollTrigger pattern without the dependency: each registered
 * element gets a 0..1 progress value describing how far the viewport has
 * travelled through it, written back as a CSS custom property (`--p`) that
 * the stylesheet animates against. All reads happen in one batch inside a
 * single rAF callback per scroll event, so we never interleave reads and
 * writes (no layout thrashing), and only `transform`/`opacity`/custom
 * properties are ever animated.
 *
 * Everything is torn down by `destroy()`, which the component calls from
 * ngOnDestroy — no listener or rAF handle outlives the landing page.
 */

export type SceneMode =
  /** Progress runs 0→1 while the element scrolls through a pinned range
   *  (its own height minus one viewport). Use with `position: sticky`. */
  | 'pin'
  /** Progress runs 0→1 as the element travels from just below the viewport
   *  to just above it — good for enter/exit choreography. */
  | 'through';

interface Scene {
  el: HTMLElement;
  mode: SceneMode;
  /** Last written value, so we skip redundant style writes. */
  last: number;
}

export class ScrollScenes {
  private scenes: Scene[] = [];
  private frame = 0;
  private destroyed = false;

  private readonly onScroll = () => this.schedule();
  private readonly onResize = () => this.schedule();

  constructor(private readonly reducedMotion: boolean) {}

  /** Registers an element. Under reduced motion the scene is parked at a
   *  neutral, fully-revealed value instead of tracking the scroll. */
  add(el: HTMLElement | null | undefined, mode: SceneMode) {
    if (!el) return;
    this.scenes.push({ el, mode, last: -1 });
    if (this.reducedMotion) {
      el.style.setProperty('--p', mode === 'pin' ? '0' : '0.5');
    }
  }

  start() {
    if (this.reducedMotion || this.destroyed) return;
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onResize, { passive: true });
    this.schedule();
  }

  private schedule() {
    if (this.frame || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update();
    });
  }

  private update() {
    const vh = window.innerHeight || 1;

    // Read phase — measure everything before touching any style.
    const measured = this.scenes.map((scene) => {
      const rect = scene.el.getBoundingClientRect();
      let progress: number;

      if (scene.mode === 'pin') {
        const scrollable = rect.height - vh;
        progress = scrollable > 0 ? -rect.top / scrollable : rect.top <= 0 ? 1 : 0;
      } else {
        // 0 when the element's top edge sits at the bottom of the viewport,
        // 1 when its bottom edge has passed the top of the viewport.
        const span = rect.height + vh;
        progress = span > 0 ? (vh - rect.top) / span : 0;
      }

      return { scene, progress: Math.min(Math.max(progress, 0), 1) };
    });

    // Write phase.
    for (const { scene, progress } of measured) {
      // 3-decimal quantisation: below that the visual delta is invisible but
      // the style write still costs a recalc.
      const rounded = Math.round(progress * 1000) / 1000;
      if (rounded === scene.last) continue;
      scene.last = rounded;
      scene.el.style.setProperty('--p', rounded.toString());
    }
  }

  destroy() {
    this.destroyed = true;
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onResize);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.scenes = [];
  }
}
