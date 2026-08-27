import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { BoardService } from '../../core/services/board';
import { SupabaseService } from '../../core/services/supabase';
import { ToastService } from '../../core/services/toast';
import { ConfirmService } from '../../core/services/confirm';

interface OrganizePin {
  id: string;
  title: string;
  image: string;
}

@Component({
  selector: 'app-board-organize',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './board-organize.html',
  styleUrl: './board-organize.css',
})
export class BoardOrganize implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private boardService = inject(BoardService);
  private supabaseService = inject(SupabaseService);
  private toastService = inject(ToastService);
  private confirmService = inject(ConfirmService);

  private boardId = '';
  public boardName = signal('');
  public pins = signal<OrganizePin[]>([]);
  public isLoading = signal(true);

  public selectedIds = signal<Set<string>>(new Set());
  public allSelected = computed(() => this.pins().length > 0 && this.selectedIds().size === this.pins().length);
  public hasSelection = computed(() => this.selectedIds().size > 0);

  // Drag reorder — dragged card fades like a ghost (see .opacity-40 binding in the
  // template) while it's being dragged, and the hovered drop target gets a ring.
  public draggingId = signal<string | null>(null);
  public dragOverId = signal<string | null>(null);

  // Unified "Chọn bảng" picker, shared by the "move" and "add" toolbar buttons — which
  // action it performs on the chosen board depends on boardPickerMode.
  public boardPickerMode = signal<'move' | 'add' | null>(null);
  public myBoards = signal<any[]>([]);
  public boardPickerQuery = signal('');
  public filteredBoards = computed(() => {
    const query = this.boardPickerQuery().trim().toLowerCase();
    const boards = this.myBoards();
    if (!query) return boards;
    return boards.filter((b) => (b.name || '').toLowerCase().includes(query));
  });

  public isCreatingBoard = signal(false);
  public newBoardName = '';
  public isSavingNewBoard = signal(false);

  async ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) {
        this.boardId = id;
        this.loadBoard(id);
      }
    });
  }

  async loadBoard(id: string) {
    this.isLoading.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;
      const board = await this.boardService.getBoardById(id, token);
      this.boardName.set(board.name);
      const list: OrganizePin[] = (board.boardPins || []).map((bp: any) => ({
        id: bp.pin.id,
        title: bp.pin.title,
        image: bp.pin.imageUrl,
      }));
      this.pins.set(list);
    } catch (error) {
      console.error('Error loading board for organize:', error);
      this.toastService.error('Không tải được bảng này.');
      this.goBack();
    } finally {
      this.isLoading.set(false);
    }
  }

  goBack() {
    this.router.navigate(['/board', this.boardId]);
  }

  toggleSelect(pinId: string, event: Event) {
    event.stopPropagation();
    this.selectedIds.update((set) => {
      const next = new Set(set);
      if (next.has(pinId)) next.delete(pinId);
      else next.add(pinId);
      return next;
    });
  }

  toggleSelectAll() {
    this.selectedIds.set(this.allSelected() ? new Set() : new Set(this.pins().map((p) => p.id)));
  }

  isSelected(pinId: string): boolean {
    return this.selectedIds().has(pinId);
  }

  // === Drag reorder ===

  onDragStart(pinId: string, event: DragEvent) {
    this.draggingId.set(pinId);
    event.dataTransfer?.setData('text/plain', pinId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onDragOver(pinId: string, event: DragEvent) {
    event.preventDefault();
    if (this.draggingId() && this.draggingId() !== pinId) {
      this.dragOverId.set(pinId);
    }
  }

  onDragLeave(pinId: string) {
    if (this.dragOverId() === pinId) this.dragOverId.set(null);
  }

  onDrop(targetId: string, event: DragEvent) {
    event.preventDefault();
    this.dragOverId.set(null);
    const draggedId = this.draggingId();
    this.draggingId.set(null);
    if (!draggedId || draggedId === targetId) return;

    const list = [...this.pins()];
    const fromIndex = list.findIndex((p) => p.id === draggedId);
    const toIndex = list.findIndex((p) => p.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    this.pins.set(list);
    this.persistOrder();
  }

  onDragEnd() {
    this.draggingId.set(null);
    this.dragOverId.set(null);
  }

  private async persistOrder() {
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;
      await this.boardService.reorderPins(this.boardId, this.pins().map((p) => p.id), token);
    } catch (error) {
      console.error('Error saving pin order:', error);
      this.toastService.error('Không thể lưu thứ tự mới.');
    }
  }

  // === Bottom toolbar: "Chọn bảng" picker (move / add) ===

  async openBoardPicker(mode: 'move' | 'add', event: Event) {
    event.stopPropagation();
    if (!this.hasSelection()) return;
    this.boardPickerQuery.set('');
    this.isCreatingBoard.set(false);
    if (this.myBoards().length === 0) {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        try {
          this.myBoards.set((await this.boardService.getBoards(token)).filter((b: any) => b.id !== this.boardId));
        } catch (error) {
          console.error('Error loading boards for the board picker:', error);
        }
      }
    }
    this.boardPickerMode.set(mode);
  }

  closeBoardPicker() {
    this.boardPickerMode.set(null);
    this.isCreatingBoard.set(false);
  }

  async chooseBoard(targetBoardId: string) {
    const mode = this.boardPickerMode();
    const ids = Array.from(this.selectedIds());
    if (!mode || ids.length === 0) return;
    this.boardPickerMode.set(null);

    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;

      if (mode === 'add') {
        await Promise.all(ids.map((pinId) => this.boardService.addPinToBoard(targetBoardId, pinId, token)));
        this.toastService.success(`Đã thêm ${ids.length} Ghim vào bảng!`);
      } else {
        await Promise.all(
          ids.map(async (pinId) => {
            await this.boardService.addPinToBoard(targetBoardId, pinId, token);
            await this.boardService.removePinFromBoard(this.boardId, pinId, token);
          }),
        );
        const moved = this.selectedIds();
        this.pins.update((list) => list.filter((p) => !moved.has(p.id)));
        this.selectedIds.set(new Set());
        this.toastService.success(`Đã chuyển ${ids.length} Ghim sang bảng khác!`);
      }
    } catch (error) {
      console.error('Error moving/adding selected pins to board:', error);
      this.toastService.error(mode === 'add' ? 'Không thể thêm vào bảng.' : 'Không thể chuyển bảng.');
    }
  }

  startCreatingBoard(event: Event) {
    event.stopPropagation();
    this.newBoardName = '';
    this.isCreatingBoard.set(true);
  }

  async createBoardAndChoose() {
    const name = this.newBoardName.trim();
    if (!name || this.isSavingNewBoard()) return;

    this.isSavingNewBoard.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;
      const newBoard = await this.boardService.createBoard(name, '', false, token);
      this.myBoards.update((list) => [newBoard, ...list]);
      this.isCreatingBoard.set(false);
      await this.chooseBoard(newBoard.id);
    } catch (error) {
      console.error('Error creating board from organize picker:', error);
      this.toastService.error('Không thể tạo bảng mới.');
    } finally {
      this.isSavingNewBoard.set(false);
    }
  }

  async deleteSelected() {
    const ids = Array.from(this.selectedIds());
    if (ids.length === 0) return;

    const confirmed = await this.confirmService.ask(
      `Gỡ ${ids.length} Ghim đã chọn khỏi bảng này? Ảnh sẽ không bị xóa, chỉ gỡ khỏi bảng này.`,
      { title: 'Gỡ khỏi bảng', confirmLabel: 'Gỡ', danger: true },
    );
    if (!confirmed) return;

    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;
      await Promise.all(ids.map((pinId) => this.boardService.removePinFromBoard(this.boardId, pinId, token)));
      const removed = this.selectedIds();
      this.pins.update((list) => list.filter((p) => !removed.has(p.id)));
      this.selectedIds.set(new Set());
      this.toastService.success('Đã gỡ khỏi bảng.');
    } catch (error) {
      console.error('Error removing selected pins:', error);
      this.toastService.error('Không thể gỡ khỏi bảng.');
    }
  }
}
