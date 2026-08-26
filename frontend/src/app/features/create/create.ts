import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { PinService } from '../../core/services/pin';
import { BoardService, Board } from '../../core/services/board';
import { SupabaseService } from '../../core/services/supabase';
import { ToastService } from '../../core/services/toast';
import { BillingService, PREMIUM_PRICE_MIN, PREMIUM_PRICE_MAX } from '../../core/services/billing';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-create',
  standalone: true,
  imports: [CommonModule, Navbar, FormsModule],
  templateUrl: './create.html',
  styleUrl: './create.css'
})
export class Create implements OnInit {
  private router = inject(Router);
  private pinService = inject(PinService);
  private boardService = inject(BoardService);
  private toastService = inject(ToastService);
  public supabaseService = inject(SupabaseService);
  public billing = inject(BillingService);

  // Form Fields
  public title = '';
  public description = '';
  public activeTab = signal<'upload' | 'ai'>('upload');

  // Premium (bán ảnh — trả credit để tải HD)
  public isPremium = signal<boolean>(false);
  public premiumPrice = 50;
  public readonly priceMin = PREMIUM_PRICE_MIN;
  public readonly priceMax = PREMIUM_PRICE_MAX;

  togglePremium() {
    this.isPremium.update((v) => !v);
  }

  private clampPrice(): number {
    const n = Math.round(Number(this.premiumPrice) || 0);
    return Math.max(this.priceMin, Math.min(this.priceMax, n));
  }
  
  // Boards selector fields
  public boards = signal<Board[]>([]);
  public selectedBoard = signal<Board | null>(null);
  public showBoardDropdown = signal<boolean>(false);

  // Upload mode fields
  public selectedFile: File | null = null;
  public imagePreviewUrl = signal<string | null>(null);

  // AI mode fields
  public aiPrompt = '';
  public aiModel = 'flux'; // flux | flux-anime | flux-realism | flux-3d
  public aiImagePreviewUrl = signal<string | null>(null);
  public isGenerating = signal<boolean>(false);

  // Submit status
  public isSubmitting = signal<boolean>(false);

  async ngOnInit() {
    await this.loadBoards();
  }

  async loadBoards() {
    const currentUser = this.supabaseService.user();
    if (currentUser) {
      try {
        const token = await this.supabaseService.getSessionToken();
        if (token) {
          const list = await this.boardService.getBoards(token);
          this.boards.set(list);
          if (list.length > 0) {
            this.selectedBoard.set(list[0]);
          }
        }
      } catch (error) {
        console.error('Error fetching user boards inside Create page:', error);
      }
    }
  }

  goToCollage() {
    this.router.navigate(['/collage']);
  }

  setTab(tab: 'upload' | 'ai') {
    this.activeTab.set(tab);
    // Clear preview images
    this.imagePreviewUrl.set(null);
    this.aiImagePreviewUrl.set(null);
    this.selectedFile = null;
    this.aiPrompt = '';
    this.title = '';
    this.description = '';
    this.isPremium.set(false);
    this.premiumPrice = 50;
  }

  toggleBoardDropdown(event: MouseEvent) {
    event.stopPropagation();
    this.showBoardDropdown.update(val => !val);
  }

  selectBoard(board: Board, event: MouseEvent) {
    event.stopPropagation();
    this.selectedBoard.set(board);
    this.showBoardDropdown.set(false);
  }

  getSelectedBoardName(): string {
    const active = this.selectedBoard();
    if (active) {
      return active.name;
    }
    return 'Chọn bảng';
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      const objectUrl = URL.createObjectURL(file);
      this.imagePreviewUrl.set(objectUrl);
    }
  }

  generateAiImage() {
    if (!this.aiPrompt.trim()) return;
    this.isGenerating.set(true);

    const seed = Math.floor(Math.random() * 1000000);
    let modelQuery = '';
    if (this.aiModel === 'flux-anime') {
      modelQuery = '&model=flux-anime';
    } else if (this.aiModel === 'flux-realism') {
      modelQuery = '&model=flux-real';
    } else if (this.aiModel === 'flux-3d') {
      modelQuery = '&model=flux-3d';
    }

    const previewUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(this.aiPrompt.trim())}?width=800&height=1200&seed=${seed}&nologo=true${modelQuery}`;

    const img = new Image();
    img.src = previewUrl;
    img.onload = () => {
      this.aiImagePreviewUrl.set(previewUrl);
      this.isGenerating.set(false);
    };
    img.onerror = () => {
      console.error('Error generating AI image');
      this.toastService.error('Lỗi tạo ảnh AI. Vui lòng thử lại.');
      this.isGenerating.set(false);
    };
  }

  async onSubmit() {
    const currentUser = this.supabaseService.user();
    if (!currentUser) return;

    const token = await this.supabaseService.getSessionToken();
    if (!token) return;

    const currentTab = this.activeTab();
    
    let boardId = this.selectedBoard()?.id;
    if (!boardId && this.boards().length > 0) {
      boardId = this.boards()[0].id;
    }

    if (!boardId) {
      try {
        const defaultBoard = await this.boardService.createBoard(
          'Hồ sơ',
          'Bảng lưu mặc định',
          false,
          token
        );
        boardId = defaultBoard.id;
      } catch (err) {
        console.error('Failed to create default board:', err);
      }
    }

    if (currentTab === 'upload') {
      if (!this.selectedFile) {
        this.toastService.error('Vui lòng chọn ảnh tải lên!');
        return;
      }
      if (!this.title.trim()) {
        this.toastService.error('Vui lòng nhập tiêu đề!');
        return;
      }

      this.isSubmitting.set(true);
      try {
        const formData = new FormData();
        formData.append('image', this.selectedFile);
        formData.append('title', this.title.trim());
        formData.append('description', this.description.trim());
        if (boardId) {
          formData.append('boardId', boardId);
        }

        const created = await this.pinService.createUploadPin(formData, token);
        if (this.isPremium() && created?.id) {
          this.billing.markPremium(created.id, this.clampPrice());
        }
        this.toastService.success('Tạo ghim thành công!');
        this.router.navigate(['/feed']);
      } catch (error) {
        console.error('Error uploading pin:', error);
        this.toastService.error(error instanceof Error ? error.message : 'Lỗi khi tải ghim lên.');
      } finally {
        this.isSubmitting.set(false);
      }
    } else {
      const previewUrl = this.aiImagePreviewUrl();
      if (!previewUrl) {
        this.toastService.error('Vui lòng tạo ảnh AI trước!');
        return;
      }
      if (!this.title.trim()) {
        this.toastService.error('Vui lòng nhập tiêu đề!');
        return;
      }

      this.isSubmitting.set(true);
      try {
        const body = {
          previewUrl,
          title: this.title.trim(),
          description: this.description.trim(),
          boardId: boardId || undefined,
          promptUsed: this.aiPrompt.trim(),
          generationModel: this.aiModel
        };

        const created = await this.pinService.saveAiPin(body, token);
        if (this.isPremium() && created?.id) {
          this.billing.markPremium(created.id, this.clampPrice());
        }
        this.toastService.success('Tạo ghim AI thành công!');
        this.router.navigate(['/feed']);
      } catch (error) {
        console.error('Error saving AI pin:', error);
        this.toastService.error(error instanceof Error ? error.message : 'Lỗi khi lưu ghim AI.');
      } finally {
        this.isSubmitting.set(false);
      }
    }
  }
}
