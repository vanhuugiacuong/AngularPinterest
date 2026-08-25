import { Component, OnInit, AfterViewInit, OnDestroy, inject, signal, computed, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { PinService } from '../../core/services/pin';
import { SupabaseService } from '../../core/services/supabase';
import { BoardService, Board } from '../../core/services/board';
import { ToastService } from '../../core/services/toast';

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
  private boardService = inject(BoardService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  public isTrending = signal<boolean>(false);

  @ViewChild('scrollSentinel') scrollSentinel!: ElementRef;

  public pins = signal<any[]>([]);
  public boards = signal<Board[]>([]);
  public activeDropdownPinId = signal<string | null>(null);
  public activeOptionsMenuPinId = signal<string | null>(null);
  public selectedBoardMap = signal<Record<string, Board>>({});
  public isLoading = signal<boolean>(true);
  public isScrollingLoad = signal<boolean>(false);
  public numColumns = signal<number>(4);

  // Whether the "for you" horizontal strip is scrolled to the top (visible)
  public isInterestBarVisible = signal<boolean>(true);
  private lastScrollY = 0;

  // Once the user manually drags/touches the interest strip, pause the auto-scroll
  // animation so it doesn't fight their scroll position. Resumes after 10s of no interaction.
  public isInterestMarqueePaused = signal<boolean>(false);
  private marqueeResumeTimer: any = null;
  pauseInterestMarquee() {
    this.isInterestMarqueePaused.set(true);
    clearTimeout(this.marqueeResumeTimer);
    this.marqueeResumeTimer = setTimeout(() => this.isInterestMarqueePaused.set(false), 10000);
  }

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
  }

  ngOnDestroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
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
    const currentUser = this.supabaseService.user();
    if (currentUser) {
      try {
        const token = await this.supabaseService.getSessionToken();
        if (token) {
          const list = await this.boardService.getBoards(token);
          this.boards.set(list);
        }
      } catch (error) {
        console.error('Error fetching user boards:', error);
      }
    }
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

  async toggleLike(pin: any, event: MouseEvent) {
    event.stopPropagation();
    const currentUser = this.supabaseService.user();
    if (!currentUser) return;

    try {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        const result = await this.pinService.toggleLike(pin.id, token);
        console.log('Toggle like result:', result);
        if (result.liked) {
          pin.likes = (pin.likes || 0) + 1;
        } else {
          if (pin.likes !== undefined) {
            pin.likes = Math.max(0, pin.likes - 1);
          }
        }
        // Force Signal updates on template
        this.pins.update(current => [...current]);
      }
    } catch (error) {
      console.error('Error toggling like:', error);
    }
  }

  toggleOptionsMenu(pinId: string, event: MouseEvent) {
    event.stopPropagation();
    this.activeOptionsMenuPinId.set(this.activeOptionsMenuPinId() === pinId ? null : pinId);
  }

  async markInterest(pinId: string, event: MouseEvent) {
    event.stopPropagation();
    this.activeOptionsMenuPinId.set(null);
    const token = await this.supabaseService.getSessionToken();
    if (!token) return;
    try {
      await this.pinService.markInterest(pinId, token);
      this.toastService.success('Sẽ hiện nhiều ảnh như thế này hơn cho bạn!');
    } catch (error) {
      console.error('Error marking interest:', error);
      this.toastService.error('Không thể ghi nhận yêu cầu.');
    }
  }

  async hidePin(pinId: string, event: MouseEvent) {
    event.stopPropagation();
    this.activeOptionsMenuPinId.set(null);
    const token = await this.supabaseService.getSessionToken();
    if (!token) return;
    try {
      await this.pinService.hidePin(pinId, token);
      this.pins.update(current => current.filter(p => p.id !== pinId));
      this.toastService.success('Đã ẩn ảnh này khỏi bảng tin của bạn.');
    } catch (error) {
      console.error('Error hiding pin:', error);
      this.toastService.error('Không thể ẩn ảnh này.');
    }
  }

  async reportPin(pinId: string, event: MouseEvent) {
    event.stopPropagation();
    this.activeOptionsMenuPinId.set(null);
    const token = await this.supabaseService.getSessionToken();
    if (!token) return;
    try {
      await this.pinService.reportPin(pinId, token);
      this.toastService.success('Đã gửi báo cáo, cảm ơn bạn!');
    } catch (error) {
      console.error('Error reporting pin:', error);
      this.toastService.error('Không thể gửi báo cáo.');
    }
  }

  toggleBoardDropdown(pinId: string, event: MouseEvent) {
    event.stopPropagation();
    if (this.activeDropdownPinId() === pinId) {
      this.activeDropdownPinId.set(null);
    } else {
      this.activeDropdownPinId.set(pinId);
    }
  }

  // "Lưu" opens the board picker so the user chooses where to save — if they have
  // no boards yet, there's nothing to pick from, so we fall back to saving into an
  // auto-created default board immediately (same as before).
  async onSaveClick(pinId: string, event: MouseEvent) {
    event.stopPropagation();
    if (this.boards().length > 0) {
      this.activeDropdownPinId.set(this.activeDropdownPinId() === pinId ? null : pinId);
      return;
    }
    await this.saveToBoard(pinId, null, event);
  }

  async saveToBoard(pinId: string, board: Board | null, event: MouseEvent) {
    event.stopPropagation();
    this.activeDropdownPinId.set(null);
    const currentUser = this.supabaseService.user();
    if (!currentUser) return;

    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;

      let boardId = board?.id;
      let boardName = board?.name;

      if (!boardId) {
        const newBoard = await this.boardService.createBoard(
          'Hồ sơ',
          'Bảng lưu mặc định',
          false,
          token
        );
        this.boards.update(current => [newBoard, ...current]);
        boardId = newBoard.id;
        boardName = newBoard.name;
      }

      this.selectedBoardMap.update(current => ({ ...current, [pinId]: { id: boardId!, name: boardName! } as Board }));
      await this.boardService.addPinToBoard(boardId, pinId, token);
      this.toastService.success(`Đã lưu vào bảng "${boardName}"!`);
    } catch (error) {
      console.error('Error saving pin to board:', error);
      this.toastService.error('Lỗi khi lưu ảnh vào bảng.');
    }
  }
}
