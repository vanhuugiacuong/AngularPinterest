import { Component, OnInit, AfterViewInit, OnDestroy, NgZone, inject, signal, computed, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { PinService } from '../../core/services/pin';
import { SupabaseService } from '../../core/services/supabase';
import { PinCardActionsService } from '../../core/services/pin-card-actions';
import { ToastService } from '../../core/services/toast';
import { advanceMarqueePosition } from './interest-marquee';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, Navbar],
  templateUrl: './home.html',
  styleUrl: './home.css'
})
export class Home implements OnInit, AfterViewInit, OnDestroy {
  private pinService = inject(PinService);
  private supabaseService = inject(SupabaseService);
  private toastService = inject(ToastService);
  private zone = inject(NgZone);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  public isTrending = signal<boolean>(false);

  @ViewChild('scrollSentinel') scrollSentinel!: ElementRef;

  public pins = signal<any[]>([]);
  public isLoading = signal<boolean>(true);
  public isScrollingLoad = signal<boolean>(false);
  public numColumns = signal<number>(4);

  // Whether the "for you" horizontal strip is scrolled to the top (visible)
  public isInterestBarVisible = signal<boolean>(true);
  private lastScrollY = 0;

  // Once the user manually drags/touches the interest strip, pause the auto-scroll
  // animation so it doesn't fight their scroll position. Resumes after 10s of no interaction.
  /* --- Interest strip auto-scroll ------------------------------------------
     Driven by scrollLeft in requestAnimationFrame, NOT by a CSS transform.

     It was a `translateX(0 -> -50%)` keyframe animation before, and the strip is
     also manually scrollable, so the two moved the content along two independent
     offsets that simply added up -- the old comment in home.css admitted as much
     and worked around it by pausing the animation on any interaction. Two things
     followed from that. The animation also paused on :hover, and after a wheel
     scroll the cursor is still sitting over the strip, so it stayed stopped for
     as long as the pointer stayed there, well past the 10s resume timer -- which
     is what reads as "it turns off and never comes back". And once resumed, the
     transform carried on from its own position while the manual scrollLeft
     offset stayed added on top.

     Moving the auto-scroll onto scrollLeft removes the conflict rather than
     scheduling around it: both now write the same value, so a manual scroll just
     relocates the animation and it carries on from where the user left it. */
  @ViewChild('interestMarquee') private interestMarqueeRef?: ElementRef<HTMLElement>;
  private marqueeRaf: number | null = null;
  private marqueeLastFrame = 0;
  /** Auto-scroll is suppressed until this timestamp; each interaction pushes it
   * out. 1.6s, not the old 10s: the point is to stay out of the user's way while
   * they are actually dragging, not to stop for a quarter of a minute. */
  private marqueeIdleUntil = 0;
  /** The authoritative offset, as a float. Never read back from scrollLeft while
   * animating -- see advanceMarqueePosition for why that mattered. */
  private marqueePos = 0;

  pauseInterestMarquee() {
    this.marqueeIdleUntil = performance.now() + 1600;
  }

  private startInterestMarquee(): void {
    // Honour the OS setting: a strip that slides on its own is exactly the kind
    // of motion this asks to be spared, and the CSS version got this for free
    // from a prefers-reduced-motion rule.
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    // Outside Angular: this fires 60 times a second and changes nothing the
    // template reads, so inside the zone it would run change detection over the
    // whole feed on every frame.
    this.zone.runOutsideAngular(() => {
      this.marqueeRaf = requestAnimationFrame(this.stepInterestMarquee);
    });
  }

  private stepInterestMarquee = (now: number): void => {
    this.marqueeRaf = requestAnimationFrame(this.stepInterestMarquee);

    const dt = this.marqueeLastFrame ? (now - this.marqueeLastFrame) / 1000 : 0;
    this.marqueeLastFrame = now;

    // Only exists once the pins have loaded -- it is inside an @if.
    const el = this.interestMarqueeRef?.nativeElement;
    if (!el) return;

    // While the user is in control, follow the DOM rather than write to it, so
    // the strip carries on from wherever they left it instead of snapping back
    // to where the animation had got to.
    if (now < this.marqueeIdleUntil) {
      this.marqueePos = el.scrollLeft;
      return;
    }

    const next = advanceMarqueePosition(this.marqueePos, dt, el.scrollWidth / 2);
    if (next === null) return;
    this.marqueePos = next;
    el.scrollLeft = next;
  };

  // Pins the user likely has an interest in, derived from the (personalized) feed order
  public interestPins = computed(() => this.pins().slice(0, 15));

  private currentPage = 1;
  private limit = 20;
  private hasMore = true;
  private observer?: IntersectionObserver;
  private feedSeed = Math.random().toString(36).substring(2, 15);

  // Fallback mock pin data to demonstrate Pinterest-style masonry grid heights and themes
  private mockPins = [
    {
      id: '1',
      title: 'Anime Swordsman',
      image: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&auto=format&fit=crop',
      hasBottomBar: false,
    },
    {
      id: '2',
      title: 'Boy Portrait',
      image: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=500&auto=format&fit=crop',
      hasBottomBar: true,
      author: 'Cường',
    },
    {
      id: '3',
      title: 'Cat with Wallet',
      image: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=500&auto=format&fit=crop',
      hasBottomBar: false,
    },
    {
      id: '4',
      title: 'Samura',
      image: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=500&auto=format&fit=crop',
      hasBottomBar: true,
      author: 'Samura',
    },
    {
      id: '5',
      title: 'Monkey Praying Art',
      image: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=500&auto=format&fit=crop',
      hasBottomBar: false,
    },
    {
      id: '6',
      title: 'về chưa?',
      image: 'https://images.unsplash.com/photo-1579783928621-7a13d66a62d1?w=500&auto=format&fit=crop',
      hasBottomBar: true,
      author: 'Sketchy',
    },
    {
      id: '7',
      title: 'Casual Outfit Male',
      image: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=500&auto=format&fit=crop',
      hasBottomBar: false,
    },
    {
      id: '8',
      title: 'Boy walking on beach',
      image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=500&auto=format&fit=crop',
      hasBottomBar: false,
    },
    {
      id: '9',
      title: 'Duck Plush Toy',
      image: 'https://images.unsplash.com/photo-1559715745-e1b34a256f3f?w=500&auto=format&fit=crop',
      hasBottomBar: true,
      likes: 138,
      author: 'Duckie',
    },
    {
      id: '10',
      title: 'Girl in Red Tank Top',
      image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&auto=format&fit=crop',
      hasBottomBar: false,
    }
  ];

  async ngOnInit() {
    this.updateNumColumns();
    this.isTrending.set(this.route.snapshot.queryParamMap.get('sort') === 'trending');
    await this.loadPins();
    await this.loadBoards();
  }

  @HostListener('window:resize')
  onResize() {
    this.updateNumColumns();
  }


  updateNumColumns() {
    const width = window.innerWidth;
    if (width >= 1536) {
      this.numColumns.set(6);
    } else if (width >= 1280) {
      this.numColumns.set(5);
    } else if (width >= 768) {
      this.numColumns.set(4);
    } else if (width >= 640) {
      this.numColumns.set(3);
    } else {
      this.numColumns.set(2);
    }
  }

  getColumnsArray(): number[] {
    return Array.from({ length: this.numColumns() }, (_, i) => i);
  }

  getPinsForColumn(colIndex: number): any[] {
    return this.pins().filter((_, index) => index % this.numColumns() === colIndex);
  }

  getSkeletonsForColumn(colIndex: number): number[] {
    const dummyArray = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    return dummyArray.filter((_, index) => index % this.numColumns() === colIndex);
  }

  getScrollingSkeletonsForColumn(colIndex: number): number[] {
    const dummyArray = [1, 2, 3, 4, 5, 6];
    return dummyArray.filter((_, index) => index % this.numColumns() === colIndex);
  }

  ngAfterViewInit() {
    this.setupIntersectionObserver();
    // Safe to start before the strip exists: the loop skips frames while the
    // @if has not produced the element yet.
    this.startInterestMarquee();
  }

  ngOnDestroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
    // Otherwise the burst timer fires into a destroyed component after a fast
    // like-then-navigate; pin-detail.ts clears its own the same way.
    if (this.marqueeRaf !== null) cancelAnimationFrame(this.marqueeRaf);
  }

  setupIntersectionObserver() {
    this.observer = new IntersectionObserver(async (entries) => {
      const entry = entries[0];
      if (entry.isIntersecting && !this.isLoading() && !this.isScrollingLoad() && this.hasMore) {
        await this.loadMorePins();
      }
    }, {
      rootMargin: '200px',
    });

    if (this.scrollSentinel) {
      this.observer.observe(this.scrollSentinel.nativeElement);
    }
  }

  async loadBoards() {
    // Delegated: the service loads once per session, and every page that
    // shows a card shares the one result.
    await this.cardActions.loadBoards();
  }

  async loadPins() {
    this.isLoading.set(true);
    this.currentPage = 1;
    this.hasMore = true;
    try {
      const token = await this.supabaseService.getSessionToken() || undefined;
      const apiPins = await this.pinService.getPins(this.currentPage, this.limit, token, this.feedSeed);
      if (apiPins && apiPins.length > 0) {
        const mapped = this.mapPins(apiPins);
        this.pins.set(this.isTrending() ? this.sortByLikes(mapped) : mapped);
        if (apiPins.length < this.limit) {
          this.hasMore = false;
        }
      } else {
        this.pins.set(this.mockPins);
        this.hasMore = false;
      }
    } catch (error) {
      console.error('Error fetching pins from backend, falling back to mock pins:', error);
      this.pins.set(this.mockPins);
      this.hasMore = false;
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadMorePins() {
    if (this.isScrollingLoad() || !this.hasMore) return;
    this.isScrollingLoad.set(true);
    this.currentPage++;
    try {
      const token = await this.supabaseService.getSessionToken() || undefined;
      const apiPins = await this.pinService.getPins(this.currentPage, this.limit, token, this.feedSeed);
      if (apiPins && apiPins.length > 0) {
        const mapped = this.mapPins(apiPins);
        this.pins.update(current => {
          const combined = [...current, ...mapped];
          return this.isTrending() ? this.sortByLikes(combined) : combined;
        });
        if (apiPins.length < this.limit) {
          this.hasMore = false;
        }
      } else {
        this.hasMore = false;
      }
    } catch (error) {
      console.error('Error loading more pins:', error);
      this.hasMore = false;
    } finally {
      this.isScrollingLoad.set(false);
    }
  }

  private sortByLikes(pins: any[]): any[] {
    return [...pins].sort((a, b) => (b.likes || 0) - (a.likes || 0));
  }

  private mapPins(apiPins: any[]): any[] {
    return apiPins.map(p => {
      const author = p.user?.username || 'Pinterest AI';
      const likes = (p as any)._count?.likes ?? 0;

      let idHash = 0;
      for (let i = 0; i < p.id.length; i++) {
        idHash += p.id.charCodeAt(i);
      }
      const hasBottomBar = (idHash % 10) < 6;

      return {
        id: p.id,
        title: p.title,
        image: p.imageUrl,
        hasBottomBar,
        author,
        likes,
        isAiGenerated: p.isAiGenerated
      };
    });
  }

  navigateToPin(pinId: string) {
    this.router.navigate(['/pin', pinId]);
  }

  /** Save/like live in a shared service — see PinCardActionsService for why
   * this page no longer carries its own copy. Public so the template can
   * bind straight to its signals. */
  public readonly cardActions = inject(PinCardActionsService);

  /** Handed to cardActions.toggleLike: the pins list holds plain objects that
   * the service mutates in place, so the signal needs poking for the new count
   * to reach the template. Bound as a field, not a method, because it is passed
   * by reference from the template. */
  public readonly refreshPins = () => this.pins.update((current) => [...current]);
}
