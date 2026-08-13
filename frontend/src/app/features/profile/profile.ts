import { CommonModule } from '@angular/common';
import {
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  WritableSignal,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, combineLatest } from 'rxjs';
import { Navbar } from '../../components/navbar/navbar';
import { BoardService } from '../../core/services/board';
import { PinService } from '../../core/services/pin';
import { SupabaseService } from '../../core/services/supabase';
import { ProfileAlbum, ProfilePin, ProfileSummary, UserService } from '../../core/services/user';

type ProfileTab = 'favorites' | 'albums' | 'posts';

interface TabState<T> {
  items: T[];
  page: number;
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, Navbar, FormsModule],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
})
export class Profile implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);
  private readonly boardService = inject(BoardService);
  private readonly pinService = inject(PinService);
  private readonly supabaseService = inject(SupabaseService);

  readonly profile = signal<ProfileSummary | null>(null);
  readonly profileLoading = signal(true);
  readonly profileError = signal<string | null>(null);
  readonly activeTab = signal<ProfileTab>('posts');
  readonly favoritesState = signal(this.emptyState<ProfilePin>());
  readonly albumsState = signal(this.emptyState<ProfileAlbum>());
  readonly postsState = signal(this.emptyState<ProfilePin>());
  readonly followPending = signal(false);
  readonly shareMessage = signal<string | null>(null);
  readonly actionMessage = signal<string | null>(null);
  readonly activePostMenu = signal<string | null>(null);

  readonly showCreateAlbumModal = signal(false);
  readonly albumSubmitPending = signal(false);
  readonly albumFormError = signal<string | null>(null);
  newAlbumName = '';
  newAlbumDescription = '';
  newAlbumSecret = false;

  readonly deleteTarget = signal<ProfilePin | null>(null);
  readonly deletePending = signal(false);
  readonly deleteError = signal<string | null>(null);

  private readonly pageSize = 20;
  private routeSubscription?: Subscription;
  private currentUsername = '';
  private requestVersion = 0;
  private dialogReturnFocus?: HTMLElement;

  ngOnInit() {
    this.routeSubscription = combineLatest([
      this.route.paramMap,
      this.route.queryParamMap,
    ]).subscribe(([params, query]) => {
      const username = params.get('username');
      if (!username) return;

      const requestedTab = this.parseTab(query.get('tab'));
      if (username !== this.currentUsername) {
        this.currentUsername = username;
        void this.loadProfile(username, requestedTab);
      } else if (this.profile()) {
        this.activateRequestedTab(requestedTab);
      }
    });
  }

  ngOnDestroy() {
    this.routeSubscription?.unsubscribe();
    this.requestVersion += 1;
  }

  async loadProfile(username = this.currentUsername, requestedTab?: ProfileTab) {
    const version = ++this.requestVersion;
    this.profileLoading.set(true);
    this.profileError.set(null);
    this.profile.set(null);
    this.resetTabStates();
    this.activePostMenu.set(null);

    try {
      const token = (await this.supabaseService.getSessionToken()) || undefined;
      const summary = await this.userService.getUserProfile(username, token);
      if (version !== this.requestVersion) return;

      this.profile.set(summary);
      this.activateRequestedTab(requestedTab || 'posts');
    } catch (error) {
      if (version !== this.requestVersion) return;
      this.profileError.set(this.errorMessage(error, 'Không thể tải hồ sơ này.'));
    } finally {
      if (version === this.requestVersion) {
        this.profileLoading.set(false);
      }
    }
  }

  setTab(tab: ProfileTab, focusTab = false) {
    if (!this.canUseTab(tab)) tab = 'posts';
    this.activeTab.set(tab);
    void this.ensureTabLoaded(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    if (focusTab) {
      setTimeout(() => document.getElementById(`profile-tab-${tab}`)?.focus());
    }
  }

  onTabKeydown(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = this.availableTabs();
    const currentIndex = Math.max(0, tabs.indexOf(this.activeTab()));
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    this.setTab(tabs[nextIndex], true);
  }

  async retryActiveTab() {
    await this.loadTab(this.activeTab(), false, true);
  }

  async loadMore() {
    await this.loadTab(this.activeTab(), true);
  }

  async toggleFollow() {
    const summary = this.profile();
    if (!summary || summary.viewer.isOwnProfile || this.followPending()) return;

    const previousFollowing = summary.viewer.isFollowing;
    const previousCount = summary.counts.followers;
    this.followPending.set(true);
    this.profile.set({
      ...summary,
      viewer: { ...summary.viewer, isFollowing: !previousFollowing },
      counts: {
        ...summary.counts,
        followers: Math.max(0, previousCount + (previousFollowing ? -1 : 1)),
      },
    });

    try {
      const token = await this.requireToken();
      const result = await this.userService.toggleFollow(summary.user.id, token);
      this.updateProfile((current) => ({
        ...current,
        viewer: { ...current.viewer, isFollowing: result.followed },
        counts: { ...current.counts, followers: result.followerCount },
      }));
    } catch (error) {
      this.updateProfile((current) => ({
        ...current,
        viewer: { ...current.viewer, isFollowing: previousFollowing },
        counts: { ...current.counts, followers: previousCount },
      }));
      this.announce(this.errorMessage(error, 'Không thể cập nhật theo dõi.'));
    } finally {
      this.followPending.set(false);
    }
  }

  async shareProfile() {
    const summary = this.profile();
    if (!summary) return;
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `@${summary.user.username} trên NovaFrame`,
          text: `Khám phá không gian sáng tạo của @${summary.user.username}.`,
          url,
        });
        this.shareMessage.set('Đã mở bảng chia sẻ.');
      } else {
        await navigator.clipboard.writeText(url);
        this.shareMessage.set('Đã sao chép liên kết hồ sơ.');
      }
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        this.shareMessage.set('Không thể chia sẻ liên kết lúc này.');
      }
    }
    setTimeout(() => this.shareMessage.set(null), 3000);
  }

  navigateToPin(pinId: string) {
    void this.router.navigate(['/pin', pinId]);
  }

  navigateToAlbum(albumId: string) {
    void this.router.navigate(['/board', albumId]);
  }

  navigateTo(path: string) {
    void this.router.navigate([path]);
  }

  async removeFavorite(pin: ProfilePin, event: Event) {
    event.stopPropagation();
    const state = this.favoritesState();
    const index = state.items.findIndex((item) => item.id === pin.id);
    if (index < 0) return;

    const optimisticItems = state.items.filter((item) => item.id !== pin.id);
    this.favoritesState.set({ ...state, items: optimisticItems });
    this.adjustCount('favorites', -1);

    try {
      const token = await this.requireToken();
      const result = await this.pinService.toggleLike(pin.id, token);
      if (result.liked) {
        throw new Error('Tác phẩm vẫn đang ở trạng thái yêu thích.');
      }
      this.announce('Đã bỏ khỏi Yêu thích.');
    } catch (error) {
      const restored = [...this.favoritesState().items];
      restored.splice(Math.min(index, restored.length), 0, pin);
      this.favoritesState.update((current) => ({ ...current, items: restored }));
      this.adjustCount('favorites', 1);
      this.announce(this.errorMessage(error, 'Không thể bỏ yêu thích.'));
    }
  }

  togglePostMenu(pinId: string, event: Event) {
    event.stopPropagation();
    this.activePostMenu.update((current) => (current === pinId ? null : pinId));
  }

  openDeleteDialog(pin: ProfilePin, event?: Event) {
    event?.stopPropagation();
    this.activePostMenu.set(null);
    this.dialogReturnFocus = document.activeElement as HTMLElement;
    this.deleteError.set(null);
    this.deleteTarget.set(pin);
    setTimeout(() => document.getElementById('confirm-delete-pin')?.focus());
  }

  closeDeleteDialog() {
    if (this.deletePending()) return;
    this.deleteTarget.set(null);
    this.deleteError.set(null);
    this.restoreDialogFocus();
  }

  async confirmDeletePin() {
    const pin = this.deleteTarget();
    if (!pin || this.deletePending()) return;
    this.deletePending.set(true);
    this.deleteError.set(null);
    try {
      const token = await this.requireToken();
      await this.pinService.deletePin(pin.id, token);
      this.postsState.update((current) => ({
        ...current,
        items: current.items.filter((item) => item.id !== pin.id),
      }));
      this.adjustCount('posts', -1);
      this.deleteTarget.set(null);
      this.announce('Đã xóa bài đăng.');
      this.restoreDialogFocus();
    } catch (error) {
      this.deleteError.set(this.errorMessage(error, 'Không thể xóa bài đăng.'));
    } finally {
      this.deletePending.set(false);
    }
  }

  openCreateAlbumModal() {
    if (!this.isOwnProfile()) return;
    this.dialogReturnFocus = document.activeElement as HTMLElement;
    this.newAlbumName = '';
    this.newAlbumDescription = '';
    this.newAlbumSecret = false;
    this.albumFormError.set(null);
    this.showCreateAlbumModal.set(true);
    setTimeout(() => document.getElementById('album-name')?.focus());
  }

  closeCreateAlbumModal() {
    if (this.albumSubmitPending()) return;
    this.showCreateAlbumModal.set(false);
    this.albumFormError.set(null);
    this.restoreDialogFocus();
  }

  async createAlbum() {
    const name = this.newAlbumName.trim();
    if (!name || this.albumSubmitPending()) return;
    this.albumSubmitPending.set(true);
    this.albumFormError.set(null);
    try {
      const token = await this.requireToken();
      const board = await this.boardService.createBoard(
        name,
        this.newAlbumDescription.trim(),
        this.newAlbumSecret,
        token,
      );
      const album: ProfileAlbum = {
        ...board,
        description: board.description || null,
        pinCount: 0,
        thumbnails: [],
      };
      this.albumsState.update((current) => ({
        ...current,
        loaded: true,
        items: [album, ...current.items],
      }));
      this.adjustCount('albums', 1);
      this.showCreateAlbumModal.set(false);
      this.announce('Album mới đã được tạo.');
      this.restoreDialogFocus();
    } catch (error) {
      this.albumFormError.set(this.errorMessage(error, 'Không thể tạo album.'));
    } finally {
      this.albumSubmitPending.set(false);
    }
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (this.deleteTarget()) this.closeDeleteDialog();
      else if (this.showCreateAlbumModal()) this.closeCreateAlbumModal();
      else this.activePostMenu.set(null);
      return;
    }

    if (event.key === 'Tab' && (this.deleteTarget() || this.showCreateAlbumModal())) {
      const dialog = document.querySelector<HTMLElement>('[data-profile-dialog="active"]');
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  isOwnProfile() {
    return this.profile()?.viewer.isOwnProfile === true;
  }

  currentState() {
    if (this.activeTab() === 'favorites') return this.favoritesState();
    if (this.activeTab() === 'albums') return this.albumsState();
    return this.postsState();
  }

  formatDate(value: string) {
    return new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(value));
  }

  trackById(_index: number, item: { id: string }) {
    return item.id;
  }

  private async ensureTabLoaded(tab: ProfileTab) {
    const state = this.stateFor(tab)();
    if (!state.loaded && !state.loading) await this.loadTab(tab);
  }

  private async loadTab(tab: ProfileTab, loadMore = false, force = false) {
    if (!this.canUseTab(tab)) return;
    const stateSignal = this.stateFor(tab) as unknown as WritableSignal<
      TabState<ProfilePin | ProfileAlbum>
    >;
    const current = stateSignal();
    if (current.loading || current.loadingMore) return;
    if (loadMore && !current.hasMore) return;
    if (!loadMore && current.loaded && !force) return;

    const version = this.requestVersion;
    const page = loadMore ? current.page + 1 : 1;
    stateSignal.set({
      ...current,
      loading: !loadMore,
      loadingMore: loadMore,
      error: null,
    });

    try {
      const token = (await this.supabaseService.getSessionToken()) || undefined;
      let response;
      if (tab === 'favorites') {
        if (!token) throw new Error('Phiên đăng nhập đã hết hạn.');
        response = await this.userService.getFavorites(page, this.pageSize, token);
      } else if (tab === 'albums') {
        response = await this.userService.getUserAlbums(
          this.currentUsername,
          page,
          this.pageSize,
          token,
        );
      } else {
        response = await this.userService.getUserPosts(
          this.currentUsername,
          page,
          this.pageSize,
          token,
        );
      }
      if (version !== this.requestVersion) return;

      const previousItems = loadMore ? stateSignal().items : [];
      const seen = new Set(previousItems.map((item) => item.id));
      const items = [...previousItems, ...response.items.filter((item) => !seen.has(item.id))];
      stateSignal.set({
        items,
        page: response.page,
        hasMore: response.hasMore,
        loaded: true,
        loading: false,
        loadingMore: false,
        error: null,
      });
      this.setCount(tab, response.total);
    } catch (error) {
      if (version !== this.requestVersion) return;
      stateSignal.update((state) => ({
        ...state,
        loaded: state.items.length > 0,
        loading: false,
        loadingMore: false,
        error: this.errorMessage(error, 'Không thể tải nội dung.'),
      }));
    }
  }

  private activateRequestedTab(tab: ProfileTab) {
    const validTab = this.canUseTab(tab) ? tab : 'posts';
    this.activeTab.set(validTab);
    void this.ensureTabLoaded(validTab);
    if (validTab !== tab) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { tab: validTab },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  private parseTab(raw: string | null): ProfileTab {
    return raw === 'favorites' || raw === 'albums' || raw === 'posts' ? raw : 'posts';
  }

  private canUseTab(tab: ProfileTab) {
    return tab !== 'favorites' || this.profile()?.viewer.canViewFavorites === true;
  }

  private availableTabs(): ProfileTab[] {
    return this.canUseTab('favorites') ? ['posts', 'albums', 'favorites'] : ['posts', 'albums'];
  }

  private stateFor(tab: ProfileTab) {
    if (tab === 'favorites') return this.favoritesState;
    if (tab === 'albums') return this.albumsState;
    return this.postsState;
  }

  private emptyState<T>(): TabState<T> {
    return {
      items: [],
      page: 0,
      hasMore: false,
      loaded: false,
      loading: false,
      loadingMore: false,
      error: null,
    };
  }

  private resetTabStates() {
    this.favoritesState.set(this.emptyState<ProfilePin>());
    this.albumsState.set(this.emptyState<ProfileAlbum>());
    this.postsState.set(this.emptyState<ProfilePin>());
  }

  private setCount(tab: ProfileTab, total: number) {
    const key = tab === 'albums' ? 'albums' : tab;
    this.updateProfile((current) => ({
      ...current,
      counts: { ...current.counts, [key]: total },
    }));
  }

  private adjustCount(tab: ProfileTab, difference: number) {
    const key = tab === 'albums' ? 'albums' : tab;
    this.updateProfile((current) => {
      const currentValue = current.counts[key];
      return {
        ...current,
        counts: {
          ...current.counts,
          [key]: Math.max(0, (currentValue || 0) + difference),
        },
      };
    });
  }

  private updateProfile(update: (profile: ProfileSummary) => ProfileSummary) {
    const current = this.profile();
    if (current) this.profile.set(update(current));
  }

  private async requireToken() {
    const token = await this.supabaseService.getSessionToken();
    if (!token) throw new Error('Phiên đăng nhập đã hết hạn.');
    return token;
  }

  private announce(message: string) {
    this.actionMessage.set(message);
    setTimeout(() => this.actionMessage.set(null), 3500);
  }

  private errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  private restoreDialogFocus() {
    const target = this.dialogReturnFocus;
    this.dialogReturnFocus = undefined;
    setTimeout(() => target?.focus());
  }
}
