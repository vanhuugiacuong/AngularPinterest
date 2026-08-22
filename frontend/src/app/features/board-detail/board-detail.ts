import { Component, OnInit, inject, signal, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { FormsModule } from '@angular/forms';
import { BoardService } from '../../core/services/board';
import { SupabaseService } from '../../core/services/supabase';
import { ToastService } from '../../core/services/toast';
import { ConfirmService } from '../../core/services/confirm';

@Component({
  selector: 'app-board-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, Navbar],
  templateUrl: './board-detail.html',
  styleUrl: './board-detail.css'
})
export class BoardDetail implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private boardService = inject(BoardService);
  private toastService = inject(ToastService);
  private confirmService = inject(ConfirmService);
  private elementRef = inject(ElementRef);
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
          isAiGenerated: bp.pin.isAiGenerated
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
