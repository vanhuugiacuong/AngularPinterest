import { Component, OnInit, OnDestroy, inject, signal, computed, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { FormsModule } from '@angular/forms';
import { BoardService } from '../../core/services/board';
import { SupabaseService } from '../../core/services/supabase';
import { ToastService } from '../../core/services/toast';
import { ConfirmService } from '../../core/services/confirm';
import { ChatService, PublicUserSummary } from '../../core/services/chat';

@Component({
  selector: 'app-board-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, Navbar],
  templateUrl: './board-detail.html',
  styleUrl: './board-detail.css'
})
export class BoardDetail implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private boardService = inject(BoardService);
  private toastService = inject(ToastService);
  private confirmService = inject(ConfirmService);
  private elementRef = inject(ElementRef);
  private chatService = inject(ChatService);
  public supabaseService = inject(SupabaseService);

  public board = signal<any | null>(null);
  public pins = signal<any[]>([]);
  public isLoading = signal<boolean>(true);

  public showOptionsMenu = signal(false);
  public showEditModal = signal(false);
  public editName = '';
  public editDesc = '';
  public editSecret = false;
  public isSavingEdit = signal(false);

  // Visibility (public/secret) quick-toggle modal, opened by clicking the pill badge.
  // The switch itself always starts OFF — it means "flip to the opposite of the current
  // state", not "this board is currently secret" — matching the reference, where the
  // title/description/label stay fixed to the board's real (saved) state for the whole
  // modal session and only the switch's own position reflects what you're about to do.
  // All of this is signal-based (not plain properties): this app's change detection is
  // signal-driven, so a plain field flipped inside a click handler doesn't reliably
  // re-render the template until something else forces it (e.g. reopening the modal).
  public showVisibilityModal = signal(false);
  public flipVisibilityRequested = signal(false);
  public isSavingVisibility = signal(false);

  openVisibilityModal(event: MouseEvent) {
    event.stopPropagation();
    if (!this.isOwner()) return;
    if (!this.board()) return;
    this.flipVisibilityRequested.set(false);
    this.showVisibilityModal.set(true);
  }

  closeVisibilityModal() {
    this.showVisibilityModal.set(false);
  }

  toggleVisibilityModalSecret() {
    this.flipVisibilityRequested.update((v) => !v);
  }

  async saveVisibility() {
    const board = this.board();
    if (!board || this.isSavingVisibility() || !this.flipVisibilityRequested()) return;

    this.isSavingVisibility.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;
      const updated = await this.boardService.updateBoard(board.id, { isSecret: !board.isSecret }, token);
      this.board.set({ ...board, ...updated });
      this.showVisibilityModal.set(false);
      this.toastService.success('Đã cập nhật bảng!');
    } catch (error: any) {
      console.error('Error updating board visibility:', error);
      this.toastService.error(error?.message || 'Lỗi khi cập nhật bảng.');
    } finally {
      this.isSavingVisibility.set(false);
    }
  }

  // Collaborators
  public showCollaboratorsModal = signal(false);
  public inviteUsername = '';
  public isInviting = signal(false);
  public removingCollaboratorId = signal<string | null>(null);

  // Search-as-you-type user picker for the invite box
  public inviteSearchResults = signal<PublicUserSummary[]>([]);
  public isSearchingUsers = signal(false);
  private inviteSearchDebounce: ReturnType<typeof setTimeout> | null = null;
  private inviteSearchSeq = 0;

  get collaborators(): any[] {
    return this.board()?.collaborators || [];
  }

  isCollaborator(): boolean {
    const board = this.board();
    const currentUser = this.supabaseService.user();
    if (!board || !currentUser) return false;
    return this.collaborators.some((c) => c.userId === currentUser.id);
  }

  canManageBoard(): boolean {
    return this.isOwner() || this.isCollaborator();
  }

  // Search within this board's pins. Manual reordering ("Sắp xếp") now lives on its own
  // full-screen picker/drag page (see goToOrganizePins) rather than a simple dropdown here.
  public boardSearchQuery = signal<string>('');

  // Filter/view-options popover above the pins grid
  public showFilterMenu = signal(false);
  public pinFilter = signal<'all' | 'favorites'>('all');
  public viewMode = signal<'default' | 'compact'>('default');

  public visiblePins = computed(() => {
    const query = this.boardSearchQuery().trim().toLowerCase();
    let list = this.pins();
    if (this.pinFilter() === 'favorites') {
      list = list.filter((p) => p.isFavorite);
    }
    if (query) {
      list = list.filter((p) => (p.title || '').toLowerCase().includes(query));
    }
    return list;
  });

  toggleFilterMenu(event: MouseEvent) {
    event.stopPropagation();
    this.showFilterMenu.update((v) => !v);
  }

  setPinFilter(filter: 'all' | 'favorites', event: MouseEvent) {
    event.stopPropagation();
    this.pinFilter.set(filter);
  }

  setViewMode(mode: 'default' | 'compact', event: MouseEvent) {
    event.stopPropagation();
    this.viewMode.set(mode);
  }

  async toggleFavoritePin(pinId: string, event: MouseEvent) {
    event.stopPropagation();
    const previous = this.pins();
    // Optimistic flip so the star responds instantly.
    this.pins.update((list) => list.map((p) => (p.id === pinId ? { ...p, isFavorite: !p.isFavorite } : p)));
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) throw new Error('Phiên đăng nhập đã hết hạn.');
      const board = this.board();
      if (!board) return;
      const result = await this.boardService.toggleFavoritePin(board.id, pinId, token);
      this.pins.update((list) => list.map((p) => (p.id === pinId ? { ...p, isFavorite: result.isFavorite } : p)));
    } catch (error) {
      this.pins.set(previous);
      this.toastService.error(error instanceof Error ? error.message : 'Không thể đánh dấu yêu thích.');
    }
  }

  goToOrganizePins() {
    const board = this.board();
    if (!board) return;
    this.router.navigate(['/board', board.id, 'organize']);
  }

  goToCollageEditor() {
    this.router.navigate(['/collage']);
  }

  goExploreMoreIdeas() {
    const board = this.board();
    if (!board) return;
    this.router.navigate(['/board', board.id, 'ideas']);
  }

  async shareBoard() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      this.toastService.success('Đã sao chép liên kết bảng!');
    } catch (error) {
      console.error('Error copying board link:', error);
    }
  }

  async ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.loadBoardDetail(id);
      }
    });
  }

  async loadBoardDetail(id: string) {
    this.isLoading.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        const boardData = await this.boardService.getBoardById(id, token);
        this.board.set(boardData);
        
        const boardPinsList = boardData.boardPins || [];
        const pinsList = boardPinsList.map((bp: any) => ({
          id: bp.pin.id,
          title: bp.pin.title,
          image: bp.pin.imageUrl,
          isAiGenerated: bp.pin.isAiGenerated,
          addedAt: bp.addedAt,
          isFavorite: bp.isFavorite
        }));
        
        this.pins.set(pinsList);
      }
    } catch (error) {
      console.error('Error loading board detail:', error);
      this.toastService.error('Không tải được bảng này.');
      this.router.navigate(['/feed']);
    } finally {
      this.isLoading.set(false);
    }
  }

  async goBackToProfile() {
    const dbUser = await this.supabaseService.ensureDbUser();
    if (dbUser?.username) {
      this.router.navigate(['/profile', dbUser.username]);
      return;
    }

    const profileUser = this.supabaseService.user();
    if (profileUser) {
      const email = profileUser.email || '';
      const username = profileUser.user_metadata?.['full_name'] || profileUser.user_metadata?.['name'] || email.split('@')[0];
      this.router.navigate(['/profile', username]);
    } else {
      this.router.navigate(['/feed']);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!this.elementRef.nativeElement.contains(target)) {
      this.showOptionsMenu.set(false);
      this.showFilterMenu.set(false);
    }
  }

  navigateToPin(pinId: string) {
    this.router.navigate(['/pin', pinId]);
  }

  isOwner(): boolean {
    const board = this.board();
    const currentUser = this.supabaseService.user();
    return !!board && !!currentUser && board.userId === currentUser.id;
  }

  toggleOptionsMenu(event: MouseEvent) {
    event.stopPropagation();
    this.showOptionsMenu.update((v) => !v);
  }

  openEditModal(event: MouseEvent) {
    event.stopPropagation();
    const board = this.board();
    if (!board) return;
    this.editName = board.name;
    this.editDesc = board.description || '';
    this.editSecret = board.isSecret;
    this.showOptionsMenu.set(false);
    this.showEditModal.set(true);
  }

  closeEditModal() {
    this.showEditModal.set(false);
  }

  async saveBoardEdit() {
    const board = this.board();
    if (!board || !this.editName.trim()) return;

    this.isSavingEdit.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;
      const updated = await this.boardService.updateBoard(
        board.id,
        { name: this.editName.trim(), description: this.editDesc.trim(), isSecret: this.editSecret },
        token
      );
      this.board.set({ ...board, ...updated });
      this.showEditModal.set(false);
      this.toastService.success('Đã cập nhật bảng!');
    } catch (error: any) {
      console.error('Error updating board:', error);
      this.toastService.error(error?.message || 'Lỗi khi cập nhật bảng.');
    } finally {
      this.isSavingEdit.set(false);
    }
  }

  async deleteCurrentBoard(event: MouseEvent) {
    event.stopPropagation();
    const board = this.board();
    if (!board) return;
    this.showOptionsMenu.set(false);

    const confirmed = await this.confirmService.ask(
      `Bạn có chắc muốn xóa bảng "${board.name}"? Ảnh trong bảng sẽ không bị xóa, chỉ gỡ khỏi bảng này. Hành động này không thể hoàn tác.`,
      { title: 'Xóa bảng', confirmLabel: 'Xóa', danger: true }
    );
    if (!confirmed) return;

    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;
      await this.boardService.deleteBoard(board.id, token);
      this.toastService.success('Đã xóa bảng!');
      this.goBackToProfile();
    } catch (error: any) {
      console.error('Error deleting board:', error);
      this.toastService.error(error?.message || 'Lỗi khi xóa bảng.');
    }
  }

  openCollaboratorsModal(event?: MouseEvent) {
    event?.stopPropagation();
    this.inviteUsername = '';
    this.inviteSearchResults.set([]);
    this.showOptionsMenu.set(false);
    this.showCollaboratorsModal.set(true);
    // Fixed-position backdrops don't stop the page behind them from scrolling on
    // wheel/trackpad — lock the body itself while the modal is up, same as any
    // native modal would.
    document.body.style.overflow = 'hidden';
  }

  closeCollaboratorsModal() {
    this.showCollaboratorsModal.set(false);
    document.body.style.overflow = '';
  }

  ngOnDestroy() {
    document.body.style.overflow = '';
  }

  // Debounced search-as-you-type — fires on every keystroke in the invite box and lists
  // matching users to pick from, instead of requiring the exact full username up front.
  onInviteUsernameInput() {
    const query = this.inviteUsername.trim();
    if (this.inviteSearchDebounce) clearTimeout(this.inviteSearchDebounce);

    if (!query) {
      this.inviteSearchResults.set([]);
      this.isSearchingUsers.set(false);
      return;
    }

    this.isSearchingUsers.set(true);
    this.inviteSearchDebounce = setTimeout(async () => {
      const mySeq = ++this.inviteSearchSeq;
      try {
        const token = await this.supabaseService.getSessionToken();
        if (!token) return;
        const results = await this.chatService.searchUsers(query, token);
        if (mySeq !== this.inviteSearchSeq) return; // a newer keystroke already superseded this search

        const board = this.board();
        const alreadyIn = new Set([board?.userId, ...this.collaborators.map((c) => c.userId)]);
        this.inviteSearchResults.set(results.filter((u) => !alreadyIn.has(u.id)));
      } catch (error) {
        console.error('Error searching users for board invite:', error);
      } finally {
        if (mySeq === this.inviteSearchSeq) this.isSearchingUsers.set(false);
      }
    }, 250);
  }

  async selectInviteCandidate(candidate: PublicUserSummary) {
    const board = this.board();
    if (!board || this.isInviting()) return;

    this.isInviting.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) throw new Error('Phiên đăng nhập đã hết hạn.');
      const collaborator = await this.boardService.addCollaborator(board.id, candidate.username, token);
      this.board.set({ ...board, collaborators: [...(board.collaborators || []), collaborator] });
      this.inviteUsername = '';
      this.inviteSearchResults.set([]);
      this.toastService.success(`Đã mời @${collaborator.user.username} cộng tác trên bảng!`);
    } catch (error) {
      this.toastService.error(error instanceof Error ? error.message : 'Không thể mời cộng tác viên.');
    } finally {
      this.isInviting.set(false);
    }
  }

  async removeCollaboratorUser(userId: string, event?: MouseEvent) {
    event?.stopPropagation();
    const board = this.board();
    if (!board || this.removingCollaboratorId()) return;

    this.removingCollaboratorId.set(userId);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) throw new Error('Phiên đăng nhập đã hết hạn.');
      await this.boardService.removeCollaborator(board.id, userId, token);
      this.board.set({ ...board, collaborators: (board.collaborators || []).filter((c: any) => c.userId !== userId) });

      const currentUser = this.supabaseService.user();
      if (currentUser?.id === userId) {
        // Left the board myself — no longer have access, go back.
        this.toastService.success('Bạn đã rời khỏi bảng này.');
        this.goBackToProfile();
      } else {
        this.toastService.success('Đã gỡ cộng tác viên.');
      }
    } catch (error) {
      this.toastService.error(error instanceof Error ? error.message : 'Không thể gỡ cộng tác viên.');
    } finally {
      this.removingCollaboratorId.set(null);
    }
  }

  async removePin(pinId: string, event: MouseEvent) {
    event.stopPropagation();
    const currentBoard = this.board();
    if (!currentBoard) return;

    try {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        await this.boardService.removePinFromBoard(currentBoard.id, pinId, token);
        this.pins.update(curr => curr.filter(p => p.id !== pinId));
        this.toastService.success('Đã gỡ ảnh khỏi bảng.');
      }
    } catch (error) {
      console.error('Error removing pin from board:', error);
      this.toastService.error('Lỗi khi gỡ ảnh khỏi bảng.');
    }
  }
}
