import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Navbar } from '../../../components/navbar/navbar';
import { UserAvatar } from '../../../shared/user-avatar/user-avatar';
import { PinService, Pin } from '../../../core/services/pin';
import { MembershipService } from '../../../core/services/membership';
import { SupabaseService } from '../../../core/services/supabase';
import { DialogService } from '../../../core/services/dialog';
import { NovaTokenService } from '../../../core/services/novatoken';
import { BoardService, Board } from '../../../core/services/board';
import { ToastService } from '../../../core/services/toast';
import { API_BASE_URL } from '../../../core/api-base';
import { formatNovaToken, vndToNovaToken } from '../../../core/utils/novatoken';

/** Phải khớp chính xác với thông báo ForbiddenException của
 * PinsService.getPinById ở backend, để phân biệt "cần nâng cấp gói" với các
 * lỗi tải khác (404, mất mạng...). */
const FIXED_PRICE_REQUIRED_MESSAGE =
  'Chỉ thành viên Plus hoặc Pro mới có thể xem chi tiết tác phẩm bán giá cố định.';

@Component({
  selector: 'app-fixed-price-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, Navbar, UserAvatar],
  templateUrl: './fixed-price-detail.html',
  styleUrl: './fixed-price-detail.css',
})
export class FixedPriceDetailPage implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private pinService = inject(PinService);
  private dialogService = inject(DialogService);
  private novaTokens = inject(NovaTokenService);
  private boardService = inject(BoardService);
  private toast = inject(ToastService);
  public membership = inject(MembershipService);
  public supabaseService = inject(SupabaseService);

  public readonly formatNovaToken = formatNovaToken;
  public readonly vndToNovaToken = vndToNovaToken;

  public pin = signal<Pin | null>(null);
  public loading = signal(true);
  public error = signal<string | null>(null);

  public buying = signal(false);
  public downloading = signal(false);
  public downloadMessage = signal<string | null>(null);

  public boards = signal<Board[]>([]);
  public showBoardDropdown = signal(false);
  public selectedBoard = signal<Board | null>(null);
  public saving = signal(false);

  private pinId = '';

  ngOnInit(): void {
    if (!this.membership.status()) {
      this.membership.load().catch(() => undefined);
    }
    void this.loadBoards();
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (!id) return;
      this.pinId = id;
      void this.loadPin();
    });
  }

  private async loadBoards(): Promise<void> {
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;
      this.boards.set(await this.boardService.getBoards(token));
    } catch {
      // Bảng chọn bộ sưu tập không tải được thì vẫn cho tạo bộ sưu tập mặc
      // định khi lưu — không chặn luồng chính chỉ vì danh sách này lỗi.
    }
  }

  goBack(): void {
    this.location.back();
  }

  private async loadPin(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const token = await this.supabaseService.getSessionToken();
      const pin = await this.pinService.getPinById(this.pinId, token ?? undefined);
      this.pin.set(pin);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Không thể tải tác phẩm này.');
    } finally {
      this.loading.set(false);
    }
  }

  isRestricted(): boolean {
    return this.error() === FIXED_PRICE_REQUIRED_MESSAGE;
  }

  isOwner(): boolean {
    const p = this.pin();
    const userId = this.supabaseService.user()?.id;
    return !!p && !!userId && p.userId === userId;
  }

  needsPurchase(): boolean {
    const p = this.pin();
    if (!p) return false;
    return !!p.isForSale && !this.isOwner() && !p.hasPurchased;
  }

  goToPricing(): void {
    this.router.navigate(['/pricing']);
  }

  /** Chỉ chủ sở hữu hoặc người ĐÃ MUA thật sự mới được lưu vào bộ sưu tập —
   * ai chỉ đang xem (kể cả có gói Plus/Pro) thì không, khớp đúng quy tắc
   * canSavePin() ở pin-detail.ts. */
  canSave(): boolean {
    const p = this.pin();
    return !!p && (this.isOwner() || p.hasPurchased === true);
  }

  toggleBoardDropdown(event: MouseEvent): void {
    event.stopPropagation();
    if (!this.canSave()) {
      this.toast.error('Bạn cần mua tác phẩm trước khi lưu vào bộ sưu tập.');
      return;
    }
    this.showBoardDropdown.update((v) => !v);
  }

  selectBoard(board: Board, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedBoard.set(board);
    this.showBoardDropdown.set(false);
  }

  getSelectedBoardName(): string {
    const active = this.selectedBoard();
    if (active) return active.name;
    const list = this.boards();
    return list.length > 0 ? list[0].name : 'Lưu vào';
  }

  async saveToBoard(): Promise<void> {
    const p = this.pin();
    if (!p || this.saving()) return;
    if (!this.canSave()) {
      this.toast.error('Bạn cần mua tác phẩm trước khi lưu vào bộ sưu tập.');
      return;
    }

    this.saving.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;

      let boardId = this.selectedBoard()?.id;
      if (!boardId && this.boards().length > 0) {
        boardId = this.boards()[0].id;
      }
      if (!boardId) {
        const newBoard = await this.boardService.createBoard(
          'Bộ sưu tập của tôi',
          'Bộ sưu tập lưu mặc định',
          false,
          token,
        );
        this.boards.update((current) => [newBoard, ...current]);
        boardId = newBoard.id;
      }

      await this.boardService.addPinToBoard(boardId, p.id, token);
      this.toast.success('Đã lưu vào bộ sưu tập.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'Không thể lưu vào bộ sưu tập.');
    } finally {
      this.saving.set(false);
    }
  }

  async buyNow(): Promise<void> {
    const p = this.pin();
    if (!p || this.buying()) return;

    const confirmed = await this.dialogService.confirm({
      variant: 'confirm',
      title: 'Xác nhận mua tác phẩm',
      description: `Bạn sắp mua "${p.title}" với giá ${formatNovaToken(vndToNovaToken(p.price))}. Số tiền sẽ được trừ ngay từ ví của bạn và không thể hoàn lại.`,
      confirmLabel: 'Mua ngay',
      cancelLabel: 'Hủy',
    });
    if (!confirmed) return;

    this.buying.set(true);
    try {
      await this.novaTokens.purchase(p.id);
      this.pin.set({ ...p, hasPurchased: true });
      await this.downloadOriginal();
    } catch (e) {
      this.downloadMessage.set(e instanceof Error ? e.message : 'Không thể hoàn tất giao dịch.');
    } finally {
      this.buying.set(false);
    }
  }

  async downloadOriginal(): Promise<void> {
    const p = this.pin();
    if (!p || this.downloading()) return;
    this.downloadMessage.set('Đang chuẩn bị ảnh...');
    this.downloading.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      const response = await fetch(`${API_BASE_URL}/api/memberships/pins/${p.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Không thể tải ảnh.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${p.title || 'novaframe'}.jpg`;
      anchor.click();
      URL.revokeObjectURL(url);
      this.downloadMessage.set('Đã tải ảnh.');
    } catch (e) {
      this.downloadMessage.set(e instanceof Error ? e.message : 'Không thể tải ảnh.');
    } finally {
      this.downloading.set(false);
    }
  }
}
