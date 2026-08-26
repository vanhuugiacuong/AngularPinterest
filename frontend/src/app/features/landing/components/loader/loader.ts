import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

type GsapApi = (typeof import('gsap'))['gsap'];
type GsapTimeline = ReturnType<GsapApi['timeline']>;
type GsapContext = ReturnType<GsapApi['context']>;

export type LoaderMode = 'full' | 'return';

interface LoaderFrame {
  src: string;
  ratio: 'portrait' | 'landscape' | 'square' | 'tall';
  priority?: boolean;
}

interface LoaderStrip {
  depth: 'far' | 'mid' | 'hero';
  frames: LoaderFrame[];
}

interface AssemblyFragment {
  src: string;
  fromX: string;
  fromY: string;
  rotation: number;
}

const ALL_STRIPS: LoaderStrip[] = [
  {
    depth: 'far',
    frames: [
      { src: '/landing/work-08.jpg', ratio: 'tall' },
      { src: '/landing/work-11.jpg', ratio: 'landscape' },
      { src: '/landing/work-04.jpg', ratio: 'square' },
    ],
  },
  {
    depth: 'mid',
    frames: [
      { src: '/landing/work-06.jpg', ratio: 'portrait', priority: true },
      { src: '/landing/work-02.jpg', ratio: 'landscape', priority: true },
      { src: '/landing/work-10.jpg', ratio: 'square' },
      { src: '/landing/work-12.jpg', ratio: 'tall' },
    ],
  },
  {
    depth: 'hero',
    frames: [
      { src: '/landing/work-03.jpg', ratio: 'landscape', priority: true },
      { src: '/landing/work-01.jpg', ratio: 'portrait', priority: true },
      { src: '/landing/work-05.jpg', ratio: 'square', priority: true },
      { src: '/landing/work-09.jpg', ratio: 'landscape' },
    ],
  },
  {
    depth: 'mid',
    frames: [
      { src: '/landing/work-07.jpg', ratio: 'landscape', priority: true },
      { src: '/landing/work-12.jpg', ratio: 'portrait' },
      { src: '/landing/work-05.jpg', ratio: 'square' },
      { src: '/landing/work-02.jpg', ratio: 'tall' },
    ],
  },
  {
    depth: 'far',
    frames: [
      { src: '/landing/work-10.jpg', ratio: 'square' },
      { src: '/landing/work-04.jpg', ratio: 'portrait' },
      { src: '/landing/work-11.jpg', ratio: 'landscape' },
    ],
  },
];

const ASSEMBLY_FRAGMENTS: AssemblyFragment[] = [
  { src: '/landing/work-03.jpg', fromX: '-25vw', fromY: '-19vh', rotation: -9 },
  { src: '/landing/work-07.jpg', fromX: '23vw', fromY: '-16vh', rotation: 7 },
  { src: '/landing/work-01.jpg', fromX: '-28vw', fromY: '17vh', rotation: 8 },
  { src: '/landing/work-09.jpg', fromX: '26vw', fromY: '20vh', rotation: -6 },
];

/**
 * Public-only opening sequence.
 *
 * The loader owns one GSAP master timeline. It also animates the landing's real
 * `.nf-ring-stage`, so the assembly exposed through the opening curtain is the
 * hero object itself rather than a look-alike that gets swapped after loading.
 */
@Component({
  selector: 'app-nf-loader',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './loader.html',
  styleUrl: './loader.css',
})
export class NfLoader implements OnInit, AfterViewInit, OnDestroy {
  @Output() finished = new EventEmitter<LoaderMode>();

  @ViewChild('loaderRoot', { static: true })
  private loaderRoot!: ElementRef<HTMLElement>;

  public readonly hidden = signal(false);
  public readonly returning = signal(false);
  public readonly strips = this.selectResponsiveStrips();
  public readonly assemblyFragments = ASSEMBLY_FRAGMENTS;

  private readonly host = inject(ElementRef<HTMLElement>);
  // Same real prefers-reduced-motion check as public-header.ts/auth-modal.ts
  // in this folder — a vestibular-disorder user's actual OS setting must
  // win here too; this is every visitor's first screen.
  private readonly reducedMotion =
    typeof window !== 'undefined' && 'matchMedia' in window
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  private gsap?: GsapApi;
  private master?: GsapTimeline;
  private context?: GsapContext;
  private assetsReady = false;
  private flowCycles = 0;
  private animationFrame = 0;
  private destroyed = false;
  private mode: LoaderMode = 'full';
  private previousBodyOverflow = '';

  ngOnInit() {
    this.preloadCriticalAssets();
  }

  ngAfterViewInit() {
    this.lockPage();
    void import('gsap')
      .then(({ gsap }) => {
        if (this.destroyed) return;
        this.gsap = gsap;
        this.animationFrame = requestAnimationFrame(() => this.playFullTimeline());
      })
      .catch(() => this.completeWithoutAnimation());
  }

  /** Runs when the visitor dismisses the login surface on the same route. */
  playReturnTransition(authObjects: HTMLElement[] = []) {
    if (this.destroyed) return;
    if (!this.gsap) {
      window.scrollTo(0, 0);
      this.finished.emit('return');
      return;
    }

    this.mode = 'return';
    this.returning.set(true);
    this.hidden.set(false);
    this.lockPage();

    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = requestAnimationFrame(() => {
      this.animationFrame = requestAnimationFrame(() => this.playReturnTimeline(authObjects));
    });
  }

  private selectResponsiveStrips(): LoaderStrip[] {
    const width = typeof window === 'undefined' ? 1440 : window.innerWidth;
    if (width <= 640) return [ALL_STRIPS[1], ALL_STRIPS[2]];
    if (width <= 1024) return [ALL_STRIPS[1], ALL_STRIPS[2], ALL_STRIPS[3]];
    return ALL_STRIPS;
  }

  private preloadCriticalAssets() {
    const sources = new Set([
      ...this.strips.flatMap((strip) => strip.frames.map((frame) => frame.src)),
      ...Array.from(
        { length: 12 },
        (_, index) => `/landing/work-${String(index + 1).padStart(2, '0')}.jpg`,
      ),
    ]);

    const images = [...sources].map(
      (src) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => resolve();
          image.src = src;
          if (image.complete) resolve();
        }),
    );

    const fonts =
      'fonts' in document ? document.fonts.ready.then(() => undefined) : Promise.resolve();
    Promise.allSettled([...images, fonts]).then(() => {
      this.assetsReady = true;
    });
  }

  private playFullTimeline() {
    if (this.destroyed || !this.gsap) return;
    this.mode = 'full';
    this.returning.set(false);
    this.flowCycles = 0;
    window.scrollTo(0, 0);
    this.disposeTimeline();

    if (this.reducedMotion) {
      this.playReducedFullTimeline();
      return;
    }

    const root = this.loaderRoot.nativeElement;
    const strips = Array.from(root.querySelectorAll<HTMLElement>('.nf-loader__strip'));
    const frames = Array.from(root.querySelectorAll<HTMLElement>('.nf-loader__frame'));
    const media = Array.from(root.querySelectorAll<HTMLElement>('.nf-loader__media'));
    const captions = Array.from(root.querySelectorAll<HTMLElement>('.nf-loader__caption'));
    const hero = this.getHeroElements();

    this.context = this.gsap.context(() => {
      this.master = this.gsap!.timeline({ defaults: { overwrite: 'auto' } });
      const timeline = this.master;

      timeline
        .set(root, { autoAlpha: 1 })
        .set(hero.header, { autoAlpha: 0, y: -18 })
        .set(hero.stage, { autoAlpha: 0, scale: 0.42, transformOrigin: '50% 50%' })
        .set(hero.frames, { autoAlpha: 0, clipPath: 'inset(48% 0 48% 0 round 18px)' })
        .set(hero.lines, { autoAlpha: 1, yPercent: 112 })
        .set([hero.lede, hero.actions, hero.cue], { autoAlpha: 0, y: 24 })
        .set(media, { clipPath: 'inset(100% 0 0 0 round 20px)' })
        .set(frames, { autoAlpha: 1, yPercent: 72, scale: 0.96 })
        .set(captions, { autoAlpha: 0, y: 8 })
        .addLabel('intro')
        .to(
          frames,
          {
            yPercent: 0,
            scale: 1,
            duration: 1.15,
            stagger: { each: 0.055, from: 'center' },
            ease: 'power4.out',
          },
          'intro+=0.05',
        )
        .to(
          media,
          {
            clipPath: 'inset(0% 0 0 0 round 20px)',
            duration: 1,
            stagger: { each: 0.05, from: 'center' },
            ease: 'power4.out',
          },
          'intro+=0.08',
        )
        .to(
          captions,
          { autoAlpha: 1, y: 0, duration: 0.55, stagger: 0.04, ease: 'power3.out' },
          'intro+=0.66',
        )
        .to(
          strips,
          {
            yPercent: (index: number) => (index === Math.floor(strips.length / 2) ? -34 : -22),
            duration: 2.15,
            stagger: 0.035,
            ease: 'power3.inOut',
          },
          'intro+=0.48',
        )
        .call(() => this.finishFlowCycle());
    }, this.host.nativeElement);
  }

  private playReducedFullTimeline() {
    if (!this.gsap) return;
    const root = this.loaderRoot.nativeElement;
    const hero = this.getHeroElements();
    const streams = root.querySelector<HTMLElement>('.nf-loader__streams');
    const media = Array.from(root.querySelectorAll<HTMLElement>('.nf-loader__media'));
    const assembly = root.querySelector<HTMLElement>('.nf-assembly');
    const paths = Array.from(root.querySelectorAll<SVGPathElement>('.nf-assembly__path'));
    const topCurtain = root.querySelector<HTMLElement>('.nf-loader__curtain--top');
    const bottomCurtain = root.querySelector<HTMLElement>('.nf-loader__curtain--bottom');

    this.context = this.gsap.context(() => {
      this.master = this.gsap!.timeline({ defaults: { overwrite: 'auto' } })
        .set(root, { autoAlpha: 1 })
        .set(media, { clipPath: 'inset(0% 0 0 0 round 20px)', autoAlpha: 1 })
        .set(hero.stage, { autoAlpha: 0, scale: 0.94 })
        .set(hero.frames, { autoAlpha: 0 })
        .set(hero.lines, { yPercent: 18, autoAlpha: 0 })
        .set([hero.lede, hero.actions, hero.cue, hero.header], { autoAlpha: 0 })
        .to(streams, { autoAlpha: 0, scale: 0.97, duration: 0.18, ease: 'sine.out' }, 0.24)
        .set(assembly, { autoAlpha: 1 }, 0.28)
        .to(
          paths,
          { strokeDashoffset: 0, duration: 0.22, stagger: 0.025, ease: 'sine.inOut' },
          0.28,
        )
        .to(hero.frames, { autoAlpha: 1, duration: 0.22, stagger: 0.012, ease: 'sine.out' }, 0.36)
        .to(hero.stage, { autoAlpha: 1, scale: 1, duration: 0.28, ease: 'sine.out' }, 0.36)
        .to(assembly, { autoAlpha: 0, duration: 0.16 }, 0.5)
        .to(topCurtain, { yPercent: -101, duration: 0.3, ease: 'sine.inOut' }, 0.48)
        .to(bottomCurtain, { yPercent: 101, duration: 0.3, ease: 'sine.inOut' }, 0.48)
        .to(hero.lines, { yPercent: 0, autoAlpha: 1, duration: 0.2, stagger: 0.025 }, 0.55)
        .to(hero.lede, { autoAlpha: 1, duration: 0.16 }, 0.6)
        .to(hero.header, { autoAlpha: 1, duration: 0.16 }, 0.64)
        .to(hero.actions, { autoAlpha: 1, duration: 0.16 }, 0.68)
        .to(hero.cue, { autoAlpha: 1, duration: 0.14 }, 0.72)
        .set(
          [
            hero.stage,
            ...hero.frames,
            ...hero.lines,
            hero.lede,
            hero.actions,
            hero.cue,
            hero.header,
          ],
          { clearProps: 'opacity,visibility,transform,clipPath,filter' },
        )
        .call(() => this.complete());
    }, this.host.nativeElement);
  }

  /**
   * Extends the same master timeline at a cycle boundary. Assets never cut a
   * strip mid-flight; after three cycles the fallback always enters the hero.
   */
  private finishFlowCycle() {
    if (!this.master || this.destroyed) return;
    this.flowCycles += 1;

    if (this.assetsReady || this.flowCycles >= 3) {
      this.appendAssemblyAndReveal();
      return;
    }

    const strips = Array.from(
      this.loaderRoot.nativeElement.querySelectorAll<HTMLElement>('.nf-loader__strip'),
    );
    this.master
      .to(strips, {
        yPercent: (index: number) => `-=${index === Math.floor(strips.length / 2) ? 19 : 12}`,
        duration: 1.45,
        stagger: 0.025,
        ease: 'sine.inOut',
      })
      .call(() => this.finishFlowCycle())
      .play();
  }

  private appendAssemblyAndReveal() {
    if (!this.master) return;
    const root = this.loaderRoot.nativeElement;
    const hero = this.getHeroElements();
    const flowFrames = Array.from(root.querySelectorAll<HTMLElement>('.nf-loader__frame'));
    const strips = Array.from(root.querySelectorAll<HTMLElement>('.nf-loader__strip'));
    const fragments = Array.from(root.querySelectorAll<HTMLElement>('.nf-assembly__fragment'));
    const paths = Array.from(root.querySelectorAll<SVGPathElement>('.nf-assembly__path'));
    const topCurtain = root.querySelector<HTMLElement>('.nf-loader__curtain--top');
    const bottomCurtain = root.querySelector<HTMLElement>('.nf-loader__curtain--bottom');
    const assembly = root.querySelector<HTMLElement>('.nf-assembly');
    const ringRect = hero.ring?.getBoundingClientRect();
    const targetX = ringRect ? ringRect.left + ringRect.width / 2 : window.innerWidth / 2;
    const targetY = ringRect ? ringRect.top + ringRect.height / 2 : window.innerHeight / 2;

    root.style.setProperty('--assembly-x', `${targetX}px`);
    root.style.setProperty('--assembly-y', `${targetY}px`);

    this.master
      .addLabel('decelerate')
      .to(
        strips,
        {
          yPercent: (index: number) => `-=${index === Math.floor(strips.length / 2) ? 4 : 9}`,
          duration: 0.72,
          stagger: 0.025,
          ease: 'sine.out',
        },
        'decelerate',
      )
      .to(
        flowFrames,
        {
          x: (_: number, element: Element) => {
            const rect = (element as HTMLElement).getBoundingClientRect();
            return targetX - (rect.left + rect.width / 2);
          },
          y: (_: number, element: Element) => {
            const rect = (element as HTMLElement).getBoundingClientRect();
            return targetY - (rect.top + rect.height / 2);
          },
          scale: 0.18,
          autoAlpha: 0,
          filter: 'blur(7px)',
          duration: 1,
          stagger: { each: 0.035, from: 'edges' },
          ease: 'power3.inOut',
        },
        'decelerate+=0.18',
      )
      .set(assembly, { autoAlpha: 1 }, 'decelerate+=0.48')
      .to(
        paths,
        { strokeDashoffset: 0, duration: 0.88, stagger: 0.09, ease: 'power3.inOut' },
        'decelerate+=0.5',
      )
      .to(
        fragments,
        {
          keyframes: [
            {
              x: (_: number, element: Element) => (element as HTMLElement).dataset['bendX'] ?? '0px',
              duration: 0.34,
            },
            { x: 0, y: 0, rotation: 0, scale: 0.32, duration: 0.44 },
          ],
          autoAlpha: 0,
          stagger: 0.07,
          ease: 'power3.inOut',
        },
        'decelerate+=0.62',
      )
      .to(
        hero.frames,
        {
          autoAlpha: 1,
          clipPath: 'inset(0% 0 0% 0 round 18px)',
          duration: 0.72,
          stagger: { each: 0.045, from: 'center' },
          ease: 'power4.out',
        },
        'decelerate+=0.72',
      )
      .to(
        hero.stage,
        { autoAlpha: 1, scale: 1, duration: 1.08, ease: 'expo.out' },
        'decelerate+=0.7',
      )
      .to(
        assembly,
        { scale: 1.08, autoAlpha: 0, duration: 0.52, ease: 'power4.out' },
        'decelerate+=1.28',
      )
      .addLabel('heroReveal', 'decelerate+=1.14')
      .to(topCurtain, { yPercent: -101, duration: 1.05, ease: 'power3.inOut' }, 'heroReveal')
      .to(bottomCurtain, { yPercent: 101, duration: 1.05, ease: 'power3.inOut' }, 'heroReveal')
      .to(
        hero.lines,
        { yPercent: 0, duration: 0.92, stagger: 0.1, ease: 'power4.out' },
        'heroReveal+=0.18',
      )
      .to(hero.lede, { autoAlpha: 1, y: 0, duration: 0.72, ease: 'power4.out' }, 'heroReveal+=0.46')
      .to(
        hero.header,
        { autoAlpha: 1, y: 0, duration: 0.68, ease: 'power4.out' },
        'heroReveal+=0.62',
      )
      .to(
        hero.actions,
        { autoAlpha: 1, y: 0, duration: 0.68, ease: 'power4.out' },
        'heroReveal+=0.76',
      )
      .to(hero.cue, { autoAlpha: 1, y: 0, duration: 0.55, ease: 'sine.out' }, 'heroReveal+=0.9')
      .set(
        [hero.stage, ...hero.frames, ...hero.lines, hero.lede, hero.actions, hero.cue, hero.header],
        { clearProps: 'opacity,visibility,transform,clipPath,filter' },
      )
      .call(() => this.complete())
      .play();
  }

  private playReturnTimeline(authObjects: HTMLElement[]) {
    if (this.destroyed || !this.gsap) return;
    this.disposeTimeline();

    const root = this.loaderRoot.nativeElement;
    const hero = this.getHeroElements();
    const fragments = Array.from(root.querySelectorAll<HTMLElement>('.nf-assembly__fragment'));
    const paths = Array.from(root.querySelectorAll<SVGPathElement>('.nf-assembly__path'));
    const topCurtain = root.querySelector<HTMLElement>('.nf-loader__curtain--top');
    const bottomCurtain = root.querySelector<HTMLElement>('.nf-loader__curtain--bottom');
    const assembly = root.querySelector<HTMLElement>('.nf-assembly');
    const targetX = window.innerWidth / 2;
    const targetY = window.innerHeight / 2;
    const scrollState = { y: window.scrollY || document.documentElement.scrollTop };

    root.style.setProperty('--assembly-x', `${targetX}px`);
    root.style.setProperty('--assembly-y', `${targetY}px`);

    this.context = this.gsap.context(() => {
      this.master = this.gsap!.timeline({ defaults: { overwrite: 'auto' } });
      this.master
        .set(root, { autoAlpha: 1 })
        .set('.nf-loader__streams', { autoAlpha: 0 })
        .set([topCurtain, bottomCurtain], { yPercent: 0, autoAlpha: 0 })
        .set(assembly, { autoAlpha: 0, scale: 0.76 })
        .set(paths, { strokeDashoffset: 1 })
        .set(hero.stage, { autoAlpha: 0, scale: 0.48, transformOrigin: '50% 50%' })
        .set(hero.frames, { autoAlpha: 0, clipPath: 'inset(50% 0 50% 0 round 18px)' })
        .set(hero.lines, { yPercent: 108 })
        .set([hero.lede, hero.actions, hero.cue, hero.header], { autoAlpha: 0, y: 18 })
        .to(
          scrollState,
          {
            y: 0,
            duration: this.reducedMotion ? 0.01 : 0.62,
            ease: 'power3.inOut',
            onUpdate: () => window.scrollTo(0, scrollState.y),
          },
          0,
        )
        .to(
          authObjects,
          {
            x: (_: number, element: Element) => {
              const rect = (element as HTMLElement).getBoundingClientRect();
              return targetX - (rect.left + rect.width / 2);
            },
            y: (_: number, element: Element) => {
              const rect = (element as HTMLElement).getBoundingClientRect();
              return targetY - (rect.top + rect.height / 2);
            },
            rotation: (index: number) => (index % 2 ? -4 : 4),
            scale: 0.16,
            filter: 'blur(2px)',
            autoAlpha: 0.72,
            duration: this.reducedMotion ? 0.08 : 0.34,
            stagger: 0.025,
            ease: 'power3.inOut',
          },
          0,
        )
        .to([topCurtain, bottomCurtain], { autoAlpha: 1, duration: 0.2, ease: 'sine.out' }, 0.16)
        .set(assembly, { autoAlpha: 1 }, 0.25)
        .to(
          paths,
          { strokeDashoffset: 0, duration: 0.48, stagger: 0.05, ease: 'power3.inOut' },
          0.25,
        )
        .to(
          fragments,
          {
            x: 0,
            y: 0,
            rotation: 0,
            scale: 0.28,
            autoAlpha: 0,
            duration: 0.48,
            stagger: 0.045,
            ease: 'power3.inOut',
          },
          0.28,
        )
        .to(
          hero.frames,
          {
            autoAlpha: 1,
            clipPath: 'inset(0% 0 0% 0 round 18px)',
            duration: 0.56,
            stagger: 0.032,
            ease: 'power4.out',
          },
          0.38,
        )
        .to(hero.stage, { autoAlpha: 1, scale: 1, duration: 0.82, ease: 'expo.out' }, 0.38)
        .to(assembly, { autoAlpha: 0, scale: 1.05, duration: 0.35, ease: 'power4.out' }, 0.68)
        .to(topCurtain, { yPercent: -101, duration: 0.72, ease: 'power3.inOut' }, 0.64)
        .to(bottomCurtain, { yPercent: 101, duration: 0.72, ease: 'power3.inOut' }, 0.64)
        .to(hero.lines, { yPercent: 0, duration: 0.68, stagger: 0.07, ease: 'power4.out' }, 0.72)
        .to(hero.lede, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power4.out' }, 0.9)
        .to(hero.header, { autoAlpha: 1, y: 0, duration: 0.48, ease: 'power4.out' }, 1.02)
        .to(hero.actions, { autoAlpha: 1, y: 0, duration: 0.48, ease: 'power4.out' }, 1.12)
        .to(hero.cue, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'sine.out' }, 1.22)
        .set(
          [
            hero.stage,
            ...hero.frames,
            ...hero.lines,
            hero.lede,
            hero.actions,
            hero.cue,
            hero.header,
          ],
          { clearProps: 'opacity,visibility,transform,clipPath,filter' },
        )
        .call(() => this.complete());
    }, this.host.nativeElement);
  }

  private getHeroElements() {
    const documentRoot = document.documentElement;
    return {
      header: documentRoot.querySelector<HTMLElement>('app-public-header'),
      stage: documentRoot.querySelector<HTMLElement>('.nf-ring-stage'),
      ring: documentRoot.querySelector<HTMLElement>('.nf-ring'),
      frames: Array.from(documentRoot.querySelectorAll<HTMLElement>('.nf-ring__frame')),
      lines: Array.from(documentRoot.querySelectorAll<HTMLElement>('.nf-hero__line > span')),
      lede: documentRoot.querySelector<HTMLElement>('.nf-hero__lede'),
      actions: documentRoot.querySelector<HTMLElement>('.nf-hero__actions'),
      cue: documentRoot.querySelector<HTMLElement>('.nf-hero__cue'),
    };
  }

  private complete() {
    if (this.destroyed) return;
    this.hidden.set(true);
    this.returning.set(false);
    this.unlockPage();
    this.finished.emit(this.mode);
  }

  private completeWithoutAnimation() {
    if (this.destroyed) return;
    window.scrollTo(0, 0);
    this.hidden.set(true);
    this.unlockPage();
    this.finished.emit(this.mode);
  }

  private lockPage() {
    if (!this.previousBodyOverflow) this.previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  private unlockPage() {
    document.body.style.overflow = this.previousBodyOverflow;
  }

  private disposeTimeline() {
    this.master?.kill();
    this.master = undefined;
    this.context?.revert();
    this.context = undefined;
  }

  ngOnDestroy() {
    this.destroyed = true;
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.disposeTimeline();
    this.unlockPage();
  }
}
