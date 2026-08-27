import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { UserService } from '../../core/services/user';
import { BoardService } from '../../core/services/board';
import { SupabaseService } from '../../core/services/supabase';
import { ToastService } from '../../core/services/toast';
import { ChatService, PublicUserSummary } from '../../core/services/chat';
import { ProAvatar } from '../../shared/pro-avatar/pro-avatar';
import { FormsModule } from '@angular/forms';

export interface CollageDraft {
  id: string;
  title?: string;
  thumbnail?: string;
  updatedAt?: number;
  layers?: Array<{ type: string; src?: string; [key: string]: any }>;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, Navbar, FormsModule, ProAvatar],
  templateUrl: './profile.html',
  styleUrl: './profile.css'
})
export class Profile implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private userService = inject(UserService);
  private boardService = inject(BoardService);
  private toastService = inject(ToastService);
  private chatService = inject(ChatService);
  public supabaseService = inject(SupabaseService);
  public messagingUser = signal(false);

  public userProfile = signal<any | null>(null);
  public isLoading = signal<boolean>(true);
  public isFollowing = signal<boolean>(false);
  public activeTab = signal<'boards' | 'created' | 'collage'>('boards');

  // "Ảnh ghép" tab: published collages (real Pins with isCollage=true, comes from the
  // profile fetch) + local drafts (drafts only ever live in the owner's own browser
  // storage — see CollageService/Collage component — so they only ever load for isMyProfile()).
  public collageSubTab = signal<'published' | 'drafts'>('published');
  public collageDrafts = signal<CollageDraft[]>([]);

  public collagePins = computed(() => {
    const pins: any[] = this.userProfile()?.pins || [];
    return pins.filter((p) => p.isCollage);
  });

  setCollageSubTab(tab: 'published' | 'drafts') {
    this.collageSubTab.set(tab);
    window.scrollTo({ top: 0 });
  }

  private loadCollageDrafts() {
    if (!this.isMyProfile()) {
      this.collageDrafts.set([]);
      return;
    }
    try {
      const userId = this.supabaseService.dbUser()?.id || this.supabaseService.user()?.id || 'guest';
      const raw = localStorage.getItem(`pinhub_collage_drafts_${userId}`);
      this.collageDrafts.set(raw ? JSON.parse(raw) : []);
    } catch (error) {
      console.error('Error loading collage drafts on profile:', error);
      this.collageDrafts.set([]);
    }
  }

  formatDraftDate(timestamp?: number): string {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    return `${d.getDate()} thg ${d.getMonth() + 1}`;
  }

  collageDraftThumbnail(draft: CollageDraft): string | null {
    if (draft.thumbnail) return draft.thumbnail;
    const imageLayer = draft.layers?.find((l: any) => l.type === 'image');
    return imageLayer?.src ?? null;
  }

  openCollageDraft(draft: CollageDraft) {
    this.router.navigate(['/collage'], { queryParams: { draft: draft.id } });
  }

  goToCollageEditor() {
    this.router.navigate(['/collage']);
  }

  // Board sort/filter menu (the "tune" icon in the Bảng tab's action bar)
  public showBoardSortMenu = signal<boolean>(false);
  public boardSortOrder = signal<'recent' | 'az' | 'custom'>('recent');

  // "Nhóm" button in the Bảng tab's action bar: switches between boards this profile
  // owns and boards where this profile was invited as a collaborator ("group boards").
  public boardViewMode = signal<'mine' | 'group'>('mine');
  public groupBoards = signal<any[]>([]);
  public isLoadingGroupBoards = signal<boolean>(false);

  async toggleBoardViewMode() {
    const next = this.boardViewMode() === 'mine' ? 'group' : 'mine';
    this.boardViewMode.set(next);
    window.scrollTo({ top: 0 });
    if (next === 'group' && this.isMyProfile()) {
      this.isLoadingGroupBoards.set(true);
      try {
        const token = await this.supabaseService.getSessionToken();
        if (token) {
          this.groupBoards.set(await this.boardService.getGroupBoards(token));
        }
      } catch (error) {
        console.error('Error loading group boards:', error);
      } finally {
        this.isLoadingGroupBoards.set(false);
      }
    }
  }

  public sortedBoards = computed(() => {
    const boards: any[] = this.userProfile()?.boards || [];
    const order = this.boardSortOrder();

    if (order === 'az') {
      return [...boards].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi', { sensitivity: 'base' }));
    }
    if (order === 'recent') {
      // "Đã thêm Ghim cuối cùng" — boards with the most recently-added pin float to the
      // top; a board with no pins yet falls back to when the board itself was created.
      const lastActivity = (board: any): number => {
        const pinTimes = (board.boardPins || []).map((bp: any) => new Date(bp.addedAt).getTime());
        const latestPin = pinTimes.length ? Math.max(...pinTimes) : 0;
        return Math.max(latestPin, new Date(board.createdAt).getTime());
      };
      return [...boards].sort((a, b) => lastActivity(b) - lastActivity(a));
    }
    // 'custom' — no manual drag-reorder yet, so this is just creation order as-is.
    return boards;
  });

  toggleBoardSortMenu(event: MouseEvent) {
    event.stopPropagation();
    this.showBoardSortMenu.update((v) => !v);
  }

  setBoardSortOrder(order: 'recent' | 'az' | 'custom', event: MouseEvent) {
    event.stopPropagation();
    this.boardSortOrder.set(order);
    this.showBoardSortMenu.set(false);
  }

  // Display settings modal ("Quản lý chế độ hiển thị")
  public showDisplaySettingsModal = signal<boolean>(false);
  public isSavingDisplaySettings = signal<boolean>(false);

  onEditProfileLayoutClick(event: MouseEvent) {
    event.stopPropagation();
    this.showBoardSortMenu.set(false);
    this.showDisplaySettingsModal.set(true);
  }

  closeDisplaySettingsModal() {
    this.showDisplaySettingsModal.set(false);
  }

  async toggleShowAllPins() {
    const profile = this.userProfile();
    if (!profile || this.isSavingDisplaySettings()) return;

    const previous = profile.showAllPins !== false;
    const next = !previous;
    this.userProfile.set({ ...profile, showAllPins: next });

    this.isSavingDisplaySettings.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) throw new Error('Phiên đăng nhập đã hết hạn.');
      await this.userService.updateProfile({ showAllPins: next }, token);
    } catch (error) {
      // Revert on failure
      this.userProfile.set({ ...profile, showAllPins: previous });
      this.toastService.error(error instanceof Error ? error.message : 'Không thể lưu thay đổi.');
    } finally {
      this.isSavingDisplaySettings.set(false);
    }
  }

  // New board modal properties
  public showCreateBoardModal = signal<boolean>(false);
  public newBoardName = '';
  public newBoardDesc = '';
  public newBoardSecret = false;
  public isSubmittingBoard = false;

  // "Bảng nhóm" — invite collaborators right from the create-board modal, matching
  // Pinterest's own flow. Same search-as-you-type pattern as board-detail.ts's invite box.
  // Signal (not a plain string) — this app's change detection is signal-driven, so a
  // plain field updated by [(ngModel)] on a DOM 'input' event doesn't reliably re-render
  // OTHER bindings that depend on it (here, the results dropdown's *ngIf) until something
  // else forces a check. Same root cause fixed earlier for board-detail's visibility modal.
  public showNewBoardInvite = signal(false);
  public newBoardInviteQuery = signal('');
  public newBoardInviteResults = signal<PublicUserSummary[]>([]);
  public isSearchingNewBoardInvite = signal(false);
  public newBoardInvitees = signal<PublicUserSummary[]>([]);
  private newBoardInviteDebounce: ReturnType<typeof setTimeout> | null = null;
  private newBoardInviteSeq = 0;

  async ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const username = params.get('username');
      if (username) {
        // Reset here (not inside loadProfile) since loadProfile is also re-run after
        // toggleFollow() itself, which must not wipe the state it just set.
        this.isFollowing.set(false);
        this.loadProfile(username);
      }
    });
  }

  async loadProfile(username: string) {
    this.isLoading.set(true);
    try {
      const profile = await this.userService.getUserProfile(username);
      
      const currentUser = this.supabaseService.user();
      const isCurrentUser = currentUser && (currentUser.email === profile.email);
      
      if (isCurrentUser) {
        try {
          const token = await this.supabaseService.getSessionToken();
          if (token) {
            const allBoards = await this.boardService.getBoards(token);
            profile.boards = allBoards;
          }
        } catch (boardError) {
          console.error('Error fetching boards for user profile:', boardError);
          profile.boards = [];
        }
      }

      this.userProfile.set(profile);
    } catch (error) {
      console.error('Error loading user profile:', error);
      this.toastService.error(`Không tìm thấy trang cá nhân "${username}".`);
      this.router.navigate(['/feed']);
    } finally {
      this.isLoading.set(false);
    }
  }

  isMyProfile(): boolean {
    const profile = this.userProfile();
    const currentUser = this.supabaseService.user();
    if (!profile || !currentUser) return false;
    return currentUser.email === profile.email;
  }

  getBoardPreviews(board: any): string[] {
    const list = board.boardPins || [];
    return list.slice(0, 3).map((bp: any) => bp.pin?.imageUrl).filter(Boolean);
  }

  getSavedPins(): any[] {
    const profile = this.userProfile();
    if (!profile) return [];

    const savedMap = new Map<string, any>();
    const boards = profile.boards || [];
    for (const board of boards) {
      const boardPins = board.boardPins || [];
      for (const bp of boardPins) {
        if (bp.pin) {
          savedMap.set(bp.pin.id, {
            id: bp.pin.id,
            title: bp.pin.title,
            imageUrl: bp.pin.imageUrl,
            isAiGenerated: bp.pin.isAiGenerated,
            userId: bp.pin.userId,
            // Which board this came from — needed to toggle its favorite star; if the
            // same pin sits in several boards, whichever board is encountered first here
            // "wins" for display/toggling purposes.
            boardId: board.id,
            isFavorite: !!bp.isFavorite,
          });
        }
      }
    }

    return Array.from(savedMap.values());
  }

  // "Yêu thích" / "Do bạn tạo" pills in the Ghim tab's action bar
  public savedPinsFilter = signal<'all' | 'favorites' | 'mine'>('all');
  public savedPinsViewMode = signal<'default' | 'compact'>('default');
  public showSavedPinsOptionsMenu = signal(false);

  getFilteredSavedPins(): any[] {
    const all = this.getSavedPins();
    const filter = this.savedPinsFilter();
    if (filter === 'favorites') return all.filter((p) => p.isFavorite);
    if (filter === 'mine') {
      const myId = this.userProfile()?.id;
      return all.filter((p) => p.userId === myId);
    }
    return all;
  }

  setSavedPinsFilter(filter: 'all' | 'favorites' | 'mine') {
    this.savedPinsFilter.update((current) => (current === filter ? 'all' : filter));
    // Switching filters only swaps local state (no navigation), so the browser keeps
    // whatever scroll position was left over from before — if that was scrolled down
    // into a long list and the filtered result is short, the page title ends up
    // clipped behind the fixed navbar. Reset to the top on every filter change.
    window.scrollTo({ top: 0 });
  }

  toggleSavedPinsOptionsMenu(event: Event) {
    event.stopPropagation();
    this.showSavedPinsOptionsMenu.update((v) => !v);
  }

  setSavedPinsViewMode(mode: 'default' | 'compact', event: Event) {
    event.stopPropagation();
    this.savedPinsViewMode.set(mode);
  }

  async toggleSavedPinFavorite(pin: any, event: Event) {
    event.stopPropagation();
    const profile = this.userProfile();
    if (!profile || !pin.boardId) return;

    const previous = profile;
    // Optimistic flip, applied inside the real nested board/boardPin structure so
    // getSavedPins()/getFilteredSavedPins() (which read straight from userProfile())
    // pick it up immediately.
    this.userProfile.set({
      ...profile,
      boards: (profile.boards || []).map((b: any) =>
        b.id !== pin.boardId
          ? b
          : {
              ...b,
              boardPins: (b.boardPins || []).map((bp: any) =>
                bp.pin?.id !== pin.id ? bp : { ...bp, isFavorite: !bp.isFavorite },
              ),
            },
      ),
    });

    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) throw new Error('Phiên đăng nhập đã hết hạn.');
      await this.boardService.toggleFavoritePin(pin.boardId, pin.id, token);
    } catch (error) {
      this.userProfile.set(previous);
      this.toastService.error(error instanceof Error ? error.message : 'Không thể đánh dấu yêu thích.');
    }
  }

  setTab(tab: 'boards' | 'created' | 'collage') {
    this.activeTab.set(tab);
    window.scrollTo({ top: 0 });
    if (tab === 'collage') {
      this.loadCollageDrafts();
    }
  }

  navigateToBoard(boardId: string) {
    this.router.navigate(['/board', boardId]);
  }

  navigateToPin(pinId: string) {
    this.router.navigate(['/pin', pinId]);
  }

  goToExplore() {
    this.router.navigate(['/feed']);
  }

  openCreateBoardModal() {
    this.showCreateBoardModal.set(true);
    this.newBoardName = '';
    this.newBoardDesc = '';
    this.newBoardSecret = false;
    this.showNewBoardInvite.set(false);
    this.newBoardInviteQuery.set('');
    this.newBoardInviteResults.set([]);
    this.newBoardInvitees.set([]);
  }

  closeCreateBoardModal() {
    this.showCreateBoardModal.set(false);
  }

  toggleNewBoardInvite(event: Event) {
    event.stopPropagation();
    this.showNewBoardInvite.update((v) => !v);
  }

  // Debounced search-as-you-type for the "Bảng nhóm" invite box — same pattern used by
  // board-detail.ts's own collaborator invite (lists matches as you type, no exact
  // full-username requirement).
  onNewBoardInviteInput(value: string) {
    this.newBoardInviteQuery.set(value);
    const query = value.trim();
    if (this.newBoardInviteDebounce) clearTimeout(this.newBoardInviteDebounce);

    if (!query) {
      this.newBoardInviteResults.set([]);
      this.isSearchingNewBoardInvite.set(false);
      return;
    }

    this.isSearchingNewBoardInvite.set(true);
    this.newBoardInviteDebounce = setTimeout(async () => {
      const mySeq = ++this.newBoardInviteSeq;
      try {
        const token = await this.supabaseService.getSessionToken();
        if (!token) return;
        const results = await this.chatService.searchUsers(query, token);
        if (mySeq !== this.newBoardInviteSeq) return;
        const alreadyPicked = new Set(this.newBoardInvitees().map((u) => u.id));
        this.newBoardInviteResults.set(results.filter((u) => !alreadyPicked.has(u.id)));
      } catch (error) {
        console.error('Error searching users for new-board invite:', error);
      } finally {
        if (mySeq === this.newBoardInviteSeq) this.isSearchingNewBoardInvite.set(false);
      }
    }, 250);
  }

  addNewBoardInvitee(user: PublicUserSummary) {
    this.newBoardInvitees.update((list) => (list.some((u) => u.id === user.id) ? list : [...list, user]));
    this.newBoardInviteQuery.set('');
    this.newBoardInviteResults.set([]);
  }

  removeNewBoardInvitee(userId: string) {
    this.newBoardInvitees.update((list) => list.filter((u) => u.id !== userId));
  }

  async createBoard() {
    if (!this.newBoardName.trim()) return;
    this.isSubmittingBoard = true;
    try {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        const newBoard = await this.boardService.createBoard(
          this.newBoardName.trim(),
          this.newBoardDesc.trim(),
          this.newBoardSecret,
          token
        );

        const invitees = this.newBoardInvitees();
        if (invitees.length > 0) {
          const results = await Promise.allSettled(
            invitees.map((u) => this.boardService.addCollaborator(newBoard.id, u.username, token)),
          );
          const failed = results.filter((r) => r.status === 'rejected').length;
          if (failed > 0) {
            this.toastService.error(`Không thể mời ${failed} người vào bảng nhóm.`);
          }
        }

        const profile = this.userProfile();
        if (profile) {
          const updatedBoards = [newBoard, ...(profile.boards || [])];
          this.userProfile.set({ ...profile, boards: updatedBoards });
        }
        this.closeCreateBoardModal();
        this.toastService.success('Tạo bảng thành công!');
      }
    } catch (error) {
      console.error('Error creating board:', error);
      this.toastService.error('Lỗi khi tạo bảng.');
    } finally {
      this.isSubmittingBoard = false;
    }
  }

  async toggleFollow() {
    const profile = this.userProfile();
    const currentUser = this.supabaseService.user();
    if (!profile || !currentUser || this.isMyProfile()) return;

    try {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        const result = await this.userService.toggleFollow(profile.id, token);
        this.isFollowing.set(result.followed);

        // Update the follower count locally instead of re-fetching the whole profile
        // (avoids a jarring full-page loading flash for what's a tiny count change).
        const delta = result.followed ? 1 : -1;
        this.userProfile.set({
          ...profile,
          _count: {
            ...profile._count,
            followers: Math.max(0, (profile._count?.followers || 0) + delta),
          },
        });
      }
    } catch (error) {
      console.error('Error toggling follow:', error);
    }
  }

  async shareProfile() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      this.toastService.success('Đã sao chép liên kết hồ sơ!');
    } catch (error) {
      console.error('Error copying profile link:', error);
    }
  }

  async messageUser() {
    const profile = this.userProfile();
    if (!profile || this.isMyProfile() || this.messagingUser()) return;

    this.messagingUser.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) throw new Error('Phiên đăng nhập đã hết hạn.');
      const conversation = await this.chatService.openDirectConversation(profile.id, token);
      this.router.navigate(['/chat', conversation.id]);
    } catch (error) {
      this.toastService.error(error instanceof Error ? error.message : 'Không thể mở cuộc trò chuyện.');
    } finally {
      this.messagingUser.set(false);
    }
  }
}
