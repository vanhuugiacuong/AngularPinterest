import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { Board, BoardService } from '../../core/services/board';
import { SupabaseService } from '../../core/services/supabase';
import { toUserMessage } from '../../core/utils/http-error';

interface BoardPinView {
  id: string;
  title: string;
  image: string;
  isAiGenerated: boolean;
}

type LoadErrorKind = 'not-found' | 'auth' | 'network' | null;

@Component({
  selector: 'app-board-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, Navbar],
  templateUrl: './board-detail.html',
  styleUrl: './board-detail.css',
})
export class BoardDetail implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private boardService = inject(BoardService);
  public supabaseService = inject(SupabaseService);

  public board = signal<Board | null>(null);
  public pins = signal<BoardPinView[]>([]);
  public isLoading = signal(true);
  public loadError = signal<string | null>(null);
  public loadErrorKind = signal<LoadErrorKind>(null);

  public isEditing = signal(false);
  public editName = '';
  public editDescription = '';
  public editIsSecret = false;
  public savingEdit = signal(false);
  public editError = signal('');

  public deleteConfirmOpen = signal(false);
  public deleting = signal(false);

  private currentBoardId: string | null = null;

  isOwner(): boolean {
    const board = this.board();
    const myId = this.supabaseService.dbUser()?.id;
    return !!board && !!myId && board.userId === myId;
  }

  async ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.currentBoardId = id;
        this.loadBoardDetail(id);
      }
    });
  }

  retryLoad() {
    if (this.currentBoardId) {
      this.loadBoardDetail(this.currentBoardId);
    }
  }

  async loadBoardDetail(id: string) {
    this.isLoading.set(true);
    this.loadError.set(null);
    this.loadErrorKind.set(null);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) {
        this.loadErrorKind.set('auth');
        this.loadError.set('Vui lòng đăng nhập để xem bộ sưu tập này.');
        return;
      }

      const boardData = await this.boardService.getBoardById(id, token);
      this.board.set(boardData);

      const boardPinsList = (boardData.boardPins as Array<{ pin: { id: string; title: string; imageUrl: string; isAiGenerated: boolean } }>) || [];
      this.pins.set(
        boardPinsList.map((bp) => ({
          id: bp.pin.id,
          title: bp.pin.title,
          image: bp.pin.imageUrl,
          isAiGenerated: bp.pin.isAiGenerated,
        })),
      );
    } catch (error) {
      console.error('Error loading board detail:', error);
      const message = toUserMessage(error, 'Không thể tải bộ sưu tập này.');
      if (message.includes('404') || /không tìm thấy/i.test(message)) {
        this.loadErrorKind.set('not-found');
        this.loadError.set('Không tìm thấy bộ sưu tập này — có thể đã bị xoá hoặc là bộ sưu tập riêng tư của người khác.');
      } else {
        this.loadErrorKind.set('network');
        this.loadError.set(message);
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  goBackToProfile() {
    const username = this.supabaseService.dbUser()?.username;
    if (username) {
      this.router.navigate(['/profile', username]);
    } else {
      this.router.navigate(['/feed']);
    }
  }

  navigateToPin(pinId: string) {
    this.router.navigate(['/pin', pinId]);
  }

  async removePin(pinId: string, event: MouseEvent) {
    event.stopPropagation();
    const currentBoard = this.board();
    if (!currentBoard || !this.isOwner()) return;

    const previous = this.pins();
    this.pins.update((curr) => curr.filter((p) => p.id !== pinId));
    try {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        await this.boardService.removePinFromBoard(currentBoard.id, pinId, token);
      }
    } catch (error) {
      console.error('Error removing pin from board:', error);
      this.pins.set(previous);
    }
  }

  startEdit() {
    const board = this.board();
    if (!board) return;
    this.editName = board.name;
    this.editDescription = board.description || '';
    this.editIsSecret = board.isSecret;
    this.editError.set('');
    this.isEditing.set(true);
  }

  cancelEdit() {
    this.isEditing.set(false);
  }

  async saveEdit() {
    const board = this.board();
    if (!board) return;
    if (!this.editName.trim()) {
      this.editError.set('Tên bộ sưu tập là bắt buộc.');
      return;
    }
    this.savingEdit.set(true);
    this.editError.set('');
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      const updated = await this.boardService.updateBoard(
        board.id,
        { name: this.editName.trim(), description: this.editDescription.trim(), isSecret: this.editIsSecret },
        token,
      );
      this.board.set({ ...board, ...updated });
      this.isEditing.set(false);
    } catch (error) {
      this.editError.set(toUserMessage(error, 'Không thể cập nhật bộ sưu tập.'));
    } finally {
      this.savingEdit.set(false);
    }
  }

  openDeleteConfirm() {
    this.deleteConfirmOpen.set(true);
  }

  cancelDelete() {
    if (this.deleting()) return;
    this.deleteConfirmOpen.set(false);
  }

  async confirmDelete() {
    const board = this.board();
    if (!board) return;
    this.deleting.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      await this.boardService.deleteBoard(board.id, token);
      this.goBackToProfile();
    } catch (error) {
      this.editError.set(toUserMessage(error, 'Không thể xoá bộ sưu tập.'));
      this.deleteConfirmOpen.set(false);
    } finally {
      this.deleting.set(false);
    }
  }
}
