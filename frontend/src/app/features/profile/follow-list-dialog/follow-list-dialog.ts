import { Component, HostListener, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { UserAvatar } from '../../../shared/user-avatar/user-avatar';
import { UserConnection, UserService } from '../../../core/services/user';
import { SupabaseService } from '../../../core/services/supabase';
import { toUserMessage } from '../../../core/utils/http-error';

type ConnectionTab = 'followers' | 'following';

interface ConnectionState {
  items: UserConnection[];
  page: number;
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

function emptyState(): ConnectionState {
  return { items: [], page: 1, hasMore: false, loaded: false, loading: false, loadingMore: false, error: null };
}

const PAGE_SIZE = 20;

@Component({
  selector: 'app-follow-list-dialog',
  standalone: true,
  imports: [CommonModule, UserAvatar],
  templateUrl: './follow-list-dialog.html',
  styleUrl: './follow-list-dialog.css',
})
export class FollowListDialog implements OnInit {
  username = input.required<string>();
  initialTab = input<ConnectionTab>('followers');
  isOwnProfile = input<boolean>(false);
  closeDialog = output<void>();

  private userService = inject(UserService);
  private supabaseService = inject(SupabaseService);
  private router = inject(Router);

  activeTab = signal<ConnectionTab>('followers');
  followersState = signal<ConnectionState>(emptyState());
  followingState = signal<ConnectionState>(emptyState());
  pendingIds = signal<ReadonlySet<string>>(new Set());

  currentState = computed(() => (this.activeTab() === 'followers' ? this.followersState() : this.followingState()));

  ngOnInit(): void {
    this.activeTab.set(this.initialTab());
    void this.loadTab(this.activeTab());
  }

  setTab(tab: ConnectionTab): void {
    this.activeTab.set(tab);
    void this.loadTab(tab);
  }

  retry(): void {
    void this.loadTab(this.activeTab());
  }

  loadMore(): void {
    const state = this.currentState();
    if (state.loadingMore || !state.hasMore) return;
    void this.loadTab(this.activeTab(), true);
  }

  private stateSignal(tab: ConnectionTab) {
    return tab === 'followers' ? this.followersState : this.followingState;
  }

  private async loadTab(tab: ConnectionTab, loadMore = false): Promise<void> {
    const stateSignal = this.stateSignal(tab);
    const current = stateSignal();
    if (loadMore && !current.hasMore) return;
    if (!loadMore && current.loaded) return;

    const page = loadMore ? current.page + 1 : 1;
    stateSignal.set({ ...current, loading: !loadMore, loadingMore: loadMore, error: null });

    try {
      const token = (await this.supabaseService.getSessionToken()) || undefined;
      const fetcher = tab === 'followers' ? this.userService.getFollowers : this.userService.getFollowing;
      const result = await fetcher.call(this.userService, this.username(), page, PAGE_SIZE, token);
      const previousItems = loadMore ? stateSignal().items : [];
      const seen = new Set(previousItems.map((u) => u.id));
      const merged = [...previousItems, ...result.items.filter((u) => !seen.has(u.id))];
      stateSignal.set({
        items: merged,
        page: result.page,
        hasMore: result.hasMore,
        loaded: true,
        loading: false,
        loadingMore: false,
        error: null,
      });
    } catch (error) {
      stateSignal.set({
        ...stateSignal(),
        loading: false,
        loadingMore: false,
        error: toUserMessage(error, 'Không thể tải danh sách.'),
      });
    }
  }

  async toggleFollow(user: UserConnection): Promise<void> {
    if (this.pendingIds().has(user.id)) return;
    this.pendingIds.update((set) => new Set(set).add(user.id));

    const patch = (items: UserConnection[]) =>
      items.map((u) => (u.id === user.id ? { ...u, viewerIsFollowing: !u.viewerIsFollowing } : u));
    this.followersState.update((s) => ({ ...s, items: patch(s.items) }));
    this.followingState.update((s) => ({ ...s, items: patch(s.items) }));

    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      const result = await this.userService.toggleFollow(user.id, token);
      const confirm = (items: UserConnection[]) =>
        items.map((u) => (u.id === user.id ? { ...u, viewerIsFollowing: result.followRequestStatus === 'ACCEPTED' } : u));
      this.followersState.update((s) => ({ ...s, items: confirm(s.items) }));
      this.followingState.update((s) => ({ ...s, items: confirm(s.items) }));
    } catch {
      // Rollback: khôi phục lại trạng thái ban đầu trước khi optimistic update.
      const rollback = (items: UserConnection[]) =>
        items.map((u) => (u.id === user.id ? { ...u, viewerIsFollowing: user.viewerIsFollowing } : u));
      this.followersState.update((s) => ({ ...s, items: rollback(s.items) }));
      this.followingState.update((s) => ({ ...s, items: rollback(s.items) }));
    } finally {
      this.pendingIds.update((set) => {
        const next = new Set(set);
        next.delete(user.id);
        return next;
      });
    }
  }

  myUserId(): string | undefined {
    return this.supabaseService.dbUser()?.id;
  }

  goToProfile(username: string): void {
    this.closeDialog.emit();
    this.router.navigate(['/profile', username]);
  }

  onOverlayClick(): void {
    this.closeDialog.emit();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.closeDialog.emit();
      return;
    }
    if (event.key === 'Tab') {
      const dialog = document.querySelector<HTMLElement>('[data-follow-dialog]');
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
}
