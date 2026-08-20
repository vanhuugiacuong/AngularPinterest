import {
  Component,
  inject,
  signal,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ElementRef,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService } from '../../core/services/supabase';
import { PublicHeader } from './components/public-header/public-header';
import { AuthModal } from './components/auth-modal/auth-modal';
import { NfLoader } from './components/loader/loader';
import { ScrollScenes } from './scroll-scenes';

/** Kept in step with EXIT_MS in auth-modal.ts: how long the dialog takes to
 *  animate out, and therefore how long to wait before replaying the hero. */
const AUTH_EXIT_MS = 420;

/** One artwork in the exhibition strip.
 *
 *  These are real catalogue entries: the titles and categories come straight
 *  from the project's own pin seed (backend/prisma/seed*.ts), and the images
 *  are those same photos fetched once and committed under public/landing.
 *  Serving them locally rather than hotlinking keeps the first paint of the
 *  public page independent of any third-party host. */
interface Artwork {
  src: string;
  title: string;
  meta: string;
}

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, PublicHeader, AuthModal, NfLoader],
  templateUrl: './landing.html',
  styleUrl: './landing.css'
})
export class Landing implements OnInit, AfterViewInit, OnDestroy {
  private supabaseService = inject(SupabaseService);
  private host: ElementRef<HTMLElement> = inject(ElementRef);

  @ViewChild('heroScene') heroScene?: ElementRef<HTMLElement>;
  @ViewChild('exploreScene') exploreScene?: ElementRef<HTMLElement>;
  @ViewChild('collectScene') collectScene?: ElementRef<HTMLElement>;
  @ViewChild('creationScene') creationScene?: ElementRef<HTMLElement>;
  @ViewChild('aiScene') aiScene?: ElementRef<HTMLElement>;
  @ViewChild('ctaScene') ctaScene?: ElementRef<HTMLElement>;

  // --- Auth state (logic unchanged from before: same service, same flow) ---
  public showLoginModal = signal<boolean>(false);
  public errorMsg = signal<string | null>(null);
  public isSigningIn = signal<boolean>(false);

  public readonly loaderDone = signal(false);
  public currentYear = new Date().getFullYear();

  /** The twelve frames of the hero's rotating ring, each carrying one work. */
  public readonly ringFrames: Artwork[] = [
    { src: '/landing/work-01.jpg', title: 'Ánh đèn neon lung linh thời trang sân khấu', meta: 'K-Pop' },
    { src: '/landing/work-02.jpg', title: 'Tranh vẽ sơn dầu trừu tượng rực rỡ', meta: 'Drawing' },
    { src: '/landing/work-03.jpg', title: 'Nghệ thuật ánh sáng Neon Synthwave', meta: 'Anime' },
    { src: '/landing/work-04.jpg', title: 'Corgi mặc áo mưa màu vàng chói lóa', meta: 'Meme' },
    { src: '/landing/work-05.jpg', title: 'Khay pha màu acrylic đầy màu sắc', meta: 'Drawing' },
    { src: '/landing/work-06.jpg', title: 'Phố đêm Tokyo lung linh ánh điện', meta: 'Anime' },
    { src: '/landing/work-07.jpg', title: 'Bầu không khí concert rực rỡ', meta: 'K-Pop' },
    { src: '/landing/work-08.jpg', title: 'Ký họa than chì Charcoal đen trắng', meta: 'Drawing' },
    { src: '/landing/work-09.jpg', title: 'Góc chơi game ngập tràn đèn LED RGB', meta: 'Anime' },
    { src: '/landing/work-10.jpg', title: 'Chú mèo mặt cười Smug cực kỳ đắc ý', meta: 'Meme' },
    { src: '/landing/work-11.jpg', title: 'Vibe đường phố Seoul buổi tối', meta: 'K-Pop' },
    { src: '/landing/work-12.jpg', title: 'Họa sĩ sáng tác tranh khổ lớn', meta: 'Drawing' }
  ];

  /** The exhibition strip. Same catalogue, shown large with its metadata. */
  public readonly artworks: Artwork[] = [
    { src: '/landing/work-03.jpg', title: 'Nghệ thuật ánh sáng Neon Synthwave', meta: 'NF-003 · Anime' },
    { src: '/landing/work-02.jpg', title: 'Tranh vẽ sơn dầu trừu tượng rực rỡ', meta: 'NF-002 · Drawing' },
    { src: '/landing/work-07.jpg', title: 'Bầu không khí concert rực rỡ', meta: 'NF-007 · K-Pop' },
    { src: '/landing/work-04.jpg', title: 'Corgi mặc áo mưa màu vàng chói lóa', meta: 'NF-004 · Meme' },
    { src: '/landing/work-06.jpg', title: 'Phố đêm Tokyo lung linh ánh điện', meta: 'NF-006 · Anime' },
    { src: '/landing/work-12.jpg', title: 'Họa sĩ sáng tác tranh khổ lớn', meta: 'NF-012 · Drawing' }
  ];

  private readonly reducedMotion =
    typeof window !== 'undefined' && 'matchMedia' in window
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  private scenes?: ScrollScenes;
  private pointerFrame = 0;
  private returnFrame = 0;
  private returnTimer = 0;
  /** Saved so the authenticated app gets its dark body back untouched. */
  private previousBodyBackground = '';

  ngOnInit() {
    // The public experience is light-toned while the authenticated app stays
    // dark. Rather than editing the global stylesheet (which would follow the
    // user past login), the body colour is overridden inline here and
    // restored verbatim in ngOnDestroy, so the override lives exactly as long
    // as this route does.
    this.previousBodyBackground = document.body.style.backgroundColor;
    document.body.style.backgroundColor = '#f7f7f2';

    // Surface an OAuth error that Google redirected back with.
    const searchParams = new URLSearchParams(window.location.search);
    let errorDescription = searchParams.get('error_description');

    if (!errorDescription && window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      errorDescription = hashParams.get('error_description');
    }

    if (errorDescription) {
      this.errorMsg.set(decodeURIComponent(errorDescription.replace(/\+/g, ' ')));
      this.showLoginModal.set(true);
    }
  }

  // --- Auth: unchanged behaviour, same SupabaseService call ---------------

  openLoginModal() {
    this.errorMsg.set(null);
    this.showLoginModal.set(true);
  }

  /** Dismissing the dialog returns the visitor to the top of the story: the
   *  page eases back to the hero and the hero plays its entrance again, so
   *  leaving sign-in feels like stepping back into the page rather than
   *  being dropped wherever the scroll happened to be. */
  closeLoginModal() {
    this.showLoginModal.set(false);
    this.errorMsg.set(null);
    this.returnToHero();
  }

  private returnToHero() {
    clearTimeout(this.returnTimer);
    if (this.returnFrame) cancelAnimationFrame(this.returnFrame);

    const start = window.scrollY || document.documentElement.scrollTop;

    if (this.reducedMotion) {
      window.scrollTo(0, 0);
      return;
    }

    // Already at the hero: start rebuilding straight away. The dialog is still
    // fading over the top, so the moment where the hero is briefly empty
    // happens behind the glass instead of in front of the visitor.
    if (start < 8) {
      this.replayHeroEntrance();
      return;
    }

    // A native `scrollTo({behavior:'smooth'})` from twelve thousand pixels up
    // crawls; this keeps the duration bounded no matter how deep the page was
    // scrolled, and eases out so the hero settles rather than slams into place.
    const duration = Math.min(1150, Math.max(650, start * 0.16));
    const begin = performance.now();
    let replayed = false;

    const step = (now: number) => {
      const t = Math.min((now - begin) / duration, 1);
      // easeInOutCubic
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      window.scrollTo(0, start * (1 - eased));

      // Kick the entrance off slightly before the scroll lands, so the hero is
      // already assembling as it comes into view rather than appearing blank
      // and then filling in.
      if (!replayed && eased > 0.7) {
        replayed = true;
        this.replayHeroEntrance();
      }

      if (t < 1) {
        this.returnFrame = requestAnimationFrame(step);
        return;
      }
      this.returnFrame = 0;
      if (!replayed) this.replayHeroEntrance();
    };

    this.returnFrame = requestAnimationFrame(step);
  }

  /** Restarts the hero's CSS entrance. Removing the class, reading a layout
   *  property to force a synchronous reflow, then re-adding it is what makes
   *  the browser treat this as a brand-new animation; because it all happens
   *  in one task, nothing is painted in between and there is no flash. */
  private replayHeroEntrance() {
    const hero = this.heroScene?.nativeElement;
    if (!hero || this.reducedMotion) return;
    hero.classList.remove('nf-hero--enter');
    void hero.offsetWidth;
    hero.classList.add('nf-hero--enter');
  }

  async login() {
    try {
      this.isSigningIn.set(true);
      this.errorMsg.set(null);
      await this.supabaseService.signInWithGoogle();
    } catch (err: any) {
      this.errorMsg.set(err.message || 'Có lỗi xảy ra khi kết nối tới Google OAuth.');
    } finally {
      this.isSigningIn.set(false);
    }
  }

  // --- Navigation within the page ----------------------------------------

  onLoaderFinished() {
    this.loaderDone.set(true);
    // The hero's entrance is held back until the loader curtain has opened,
    // so the two motions read as one continuous reveal.
    this.replayHeroEntrance();
  }

  scrollToId(targetId: string) {
    document.getElementById(targetId)?.scrollIntoView({
      behavior: this.reducedMotion ? 'auto' : 'smooth',
      block: 'start'
    });
  }

  // --- Pointer-driven depth on the hero object ---------------------------

  onHeroPointerMove(event: MouseEvent) {
    if (this.reducedMotion || this.pointerFrame) return;
    const target = event.currentTarget as HTMLElement;
    this.pointerFrame = requestAnimationFrame(() => {
      const rect = target.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      target.style.setProperty('--mx', x.toFixed(3));
      target.style.setProperty('--my', y.toFixed(3));
      this.pointerFrame = 0;
    });
  }

  onHeroPointerLeave(event: MouseEvent) {
    const target = event.currentTarget as HTMLElement;
    target.style.setProperty('--mx', '0');
    target.style.setProperty('--my', '0');
  }

  /** Magnetic hover — a few px of pull toward the pointer, spring back on
   *  leave. Capped small so it reads as attraction, not a jump. */
  onMagneticMove(event: MouseEvent) {
    if (this.reducedMotion) return;
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    target.style.transform = `translate(${(x * 14).toFixed(1)}px, ${(y * 8).toFixed(1)}px)`;
  }

  onMagneticLeave(event: MouseEvent) {
    (event.currentTarget as HTMLElement).style.transform = '';
  }

  // --- Scroll choreography ------------------------------------------------

  ngAfterViewInit() {
    this.scenes = new ScrollScenes(this.reducedMotion);
    this.scenes.add(this.heroScene?.nativeElement, 'pin');
    this.scenes.add(this.exploreScene?.nativeElement, 'pin');
    this.scenes.add(this.collectScene?.nativeElement, 'pin');
    this.scenes.add(this.creationScene?.nativeElement, 'pin');
    this.scenes.add(this.aiScene?.nativeElement, 'pin');
    this.scenes.add(this.ctaScene?.nativeElement, 'through');
    this.scenes.start();
  }

  ngOnDestroy() {
    this.scenes?.destroy();
    if (this.pointerFrame) cancelAnimationFrame(this.pointerFrame);
    if (this.returnFrame) cancelAnimationFrame(this.returnFrame);
    clearTimeout(this.returnTimer);
    document.body.style.backgroundColor = this.previousBodyBackground;
  }
}
