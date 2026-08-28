import { Component, ElementRef, HostListener, OnInit, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { CreatePostModalComponent } from '../../components/create-post-modal/create-post-modal';
import { EditImageComponent, EditResult } from '../../components/edit-image/edit-image';
import { PinService } from '../../core/services/pin';
import { BoardService, Board } from '../../core/services/board';
import { SupabaseService } from '../../core/services/supabase';
import { ToastService } from '../../core/services/toast';
import { ModerationService } from '../../core/services/moderation';
import { BillingService, PREMIUM_PRICE_MIN, PREMIUM_PRICE_MAX } from '../../core/services/billing';
import { CreateDraftService } from '../../core/services/create-draft';
import { CollageTransferService } from '../collage/services/collage-transfer.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-create',
  standalone: true,
  imports: [
    CommonModule,
    Navbar,
    FormsModule,
    CreatePostModalComponent,
    EditImageComponent,
  ],
  templateUrl: './create.html',
  styleUrl: './create.css'
})
export class Create implements OnInit {
  private router = inject(Router);
  private pinService = inject(PinService);
  private boardService = inject(BoardService);
  private toastService = inject(ToastService);
  private moderationService = inject(ModerationService);
  public supabaseService = inject(SupabaseService);
  public billing = inject(BillingService);
  private draft = inject(CreateDraftService);
  private collageTransfer = inject(CollageTransferService);

  // Form Fields
  public title = '';
  public description = '';
  public activeTab = signal<'upload' | 'ai'>('upload');

  // Premium (bán ảnh — trả credit để tải HD)
  public isPremium = signal<boolean>(false);
  public premiumPrice = 50;
  public readonly priceMin = PREMIUM_PRICE_MIN;
  public readonly priceMax = PREMIUM_PRICE_MAX;

  /**
   * Bán ảnh Premium là quyền lợi gói Pro. Backend cũng chặn độc lập
   * (pins.service.ts normalizePremium) nên đây chỉ là lớp hướng dẫn người dùng,
   * không phải lớp bảo mật.
   */
  togglePremium() {
    if (!this.billing.isPro()) {
      this.toastService.info('Chỉ thành viên Pro mới bán được ảnh Premium. Nâng cấp để mở khoá.');
      this.router.navigate(['/pro']);
      return;
    }
    this.isPremium.update((v) => !v);
  }

  private clampPrice(): number {
    const n = Math.round(Number(this.premiumPrice) || 0);
    return Math.max(this.priceMin, Math.min(this.priceMax, n));
  }

  /** Phần trăm nền tảng giữ lại — khớp PLATFORM_FEE_PERCENT ở backend. */
  public readonly platformFeePercent = 30;
  public get sellerSharePercent(): number {
    return 100 - this.platformFeePercent;
  }
  /** Số credit người bán thực nhận mỗi lượt — tính y hệt backend (làm tròn phí). */
  public get sellerEarnPerSale(): number {
    const price = this.clampPrice();
    return price - Math.round((price * this.platformFeePercent) / 100);
  }
  
  // Boards selector fields
  public boards = signal<Board[]>([]);
  public selectedBoard = signal<Board | null>(null);
  public showBoardDropdown = signal<boolean>(false);

  // Upload mode fields
  public selectedFile: File | null = null;
  public imagePreviewUrl = signal<string | null>(null);
  // Object URL for an image handed back from "Chỉnh sửa" — tracked so we can revoke it.
  private editedPreviewUrl: string | null = null;

  // AI mode fields
  public aiPrompt = '';
  public aiModel = 'flux'; // flux | flux-anime | flux-realism | flux-3d

  /**
   * Danh sách model cho dropdown TỰ VẼ.
   *
   * Không dùng <select> gốc: phần popup của nó do hệ điều hành vẽ (nền trắng,
   * dòng chọn tô xanh dương mặc định của Windows), không style được nên lạc
   * hẳn khỏi giao diện tối — đúng lý do đã bỏ <select> ở ô chọn ngân hàng
   * trong trang Ví.
   */
  public readonly aiModels = [
    { value: 'flux', label: 'Flux Standard', hint: 'Chi tiết cao', icon: 'auto_awesome' },
    { value: 'flux-anime', label: 'Flux Anime', hint: 'Hoạt hình Nhật Bản', icon: 'animation' },
    { value: 'flux-realism', label: 'Flux Realism', hint: 'Ảnh chụp chân thực', icon: 'photo_camera' },
    { value: 'flux-3d', label: 'Flux 3D Art', hint: 'Tranh vẽ 3D', icon: 'deployed_code' },
  ];
  public modelDropdownOpen = signal(false);

  get selectedModel() {
    return this.aiModels.find((m) => m.value === this.aiModel) ?? this.aiModels[0];
  }

  toggleModelDropdown() {
    if (this.isGenerating() || this.isSubmitting()) return;
    this.modelDropdownOpen.update((v) => !v);
  }

  selectModel(value: string) {
    this.aiModel = value;
    this.modelDropdownOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocClickCloseModel(ev: MouseEvent) {
    if (!this.modelDropdownOpen()) return;
    const el = this.modelPickerEl?.nativeElement;
    if (el && !el.contains(ev.target as Node)) this.modelDropdownOpen.set(false);
  }

  @ViewChild('modelPickerEl') modelPickerEl?: ElementRef<HTMLElement>;
  public aiImagePreviewUrl = signal<string | null>(null);
  public isGenerating = signal<boolean>(false);

  /** Đã có ảnh chưa? -> quyết định hiện cột chi tiết + xem trước (progressive). */
  get hasContent(): boolean {
    if (this.activeTab() === 'upload') return !!this.imagePreviewUrl();
    if (this.activeTab() === 'ai') return !!this.aiImagePreviewUrl();
    return false;
  }

  // Submit status
  public isSubmitting = signal<boolean>(false);
  public isCheckingImage = signal<boolean>(false);

  // Visibility segmented control — UI-only for now, the create API doesn't accept it yet.
  public visibility = signal<'public' | 'private'>('public');

  // "+ Tạo bảng mới" row inside the board dropdown — swaps the list for a name input
  // instead of opening a separate modal.
  public showNewBoardInput = signal(false);
  public newBoardName = '';
  public newBoardError = signal<string | null>(null);
  public isCreatingBoard = signal(false);

  async ngOnInit() {
    // Restore first (local IndexedDB/sessionStorage reads) so a reloaded edit session
    // reappears immediately, without waiting on the boards network request.
    await this.restoreEditDraft();
    this.adoptCollageHandoff();
    await this.loadBoards();
  }

  /** Picks up the PNG the collage editor exported before it navigated here.
   * Without this the file is set on the service and then silently dropped — the
   * user finishes a collage and lands on an empty Create form.
   *
   * Runs AFTER restoreEditDraft so an arriving collage wins over a stale
   * half-finished edit session: the user just asked for this file explicitly. */
  private adoptCollageHandoff(): void {
    const collageFile = this.collageTransfer.take();
    if (!collageFile) return;
    this.releaseEditedPreview();
    this.editedPreviewUrl = URL.createObjectURL(collageFile);
    this.selectedFile = collageFile;
    this.imagePreviewUrl.set(this.editedPreviewUrl);
    this.activeTab.set('upload');
  }

  // Re-open the "Chỉnh sửa" step with the same images if this page just reloaded mid-edit
  // (e.g. the Vite dev server forced a reload after a tab switch).
  private async restoreEditDraft() {
    const saved = this.draft.loadCropState();
    if (!saved) {
      this.draft.clear();
      return;
    }
    const files = await this.draft.loadFiles();
    if (!this.draft.filesMatch(files, saved.fileMeta)) {
      this.draft.clear();
      return;
    }
    this.createPostFiles.set(files);
    this.showCreatePostModal.set(true);
    this.createPostStep.set('edit');
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

  /** "Ghép ảnh" tab. Its own route rather than an overlay here: the editor needs
   * the full viewport for a three-column layout, and squeezing that into this
   * page's overlay left the artboard tiny. The finished PNG comes back through
   * CollageTransferService — see adoptCollageHandoff below. */
  openCollage() {
    void this.router.navigate(['/collage']);
  }

  // "Sửa ảnh" tab opens the multi-file create-post modal in place,
  // instead of navigating to the old standalone collage editor route.
  public showCreatePostModal = signal(false);
  // The crop step was removed — picking images now goes straight to "Chỉnh sửa".
  public createPostStep = signal<'select' | 'edit'>('select');
  public createPostFiles = signal<File[]>([]);

  openCreatePostModal() {
    this.showCreatePostModal.set(true);
  }

  closeCreatePostModal() {
    this.showCreatePostModal.set(false);
    this.createPostStep.set('select');
    this.createPostFiles.set([]);
    this.draft.clear();
  }

  onCreatePostFilesSelected(files: File[]) {
    // Skip the old crop screen entirely — the picked images go through at their original
    // size, straight to the "Chỉnh sửa" step.
    this.createPostFiles.set(files);
    this.createPostStep.set('edit');
    void this.draft.saveFiles(files);
    // Seed a draft record so a reload mid-edit restores the right step + images.
    // `step: 'crop'` here is a legacy sentinel the draft service still checks for — it no
    // longer means the crop screen; restoreEditDraft() reopens at the 'edit' step.
    this.draft.saveCropState({
      step: 'crop',
      currentIndex: 0,
      aspectKeys: files.map(() => 'original'),
      transforms: files.map(() => ({ scale: 1, translateUnit: 'px' })),
      cropperPositions: files.map(() => undefined),
      fileMeta: this.draft.metaFor(files),
    });
  }

  onEditBack() {
    this.createPostStep.set('select');
    this.draft.clear();
  }

  onEditNext(result: EditResult) {
    // The flattened image (original + text + strokes + stickers) becomes the pin photo,
    // exactly as if the user had picked it in the "Đăng ảnh thường" tab. This fills the
    // "HÌNH ẢNH GHIM" box and the "XEM TRƯỚC" panel (both read imagePreviewUrl on this tab).
    this.releaseEditedPreview();
    this.editedPreviewUrl = URL.createObjectURL(result.file);
    this.selectedFile = result.file;
    this.imagePreviewUrl.set(this.editedPreviewUrl);
    this.activeTab.set('upload');
    this.closeCreatePostModal();
  }

  // Drop the current upload image (the "Thay đổi ảnh khác" button) — kept as a method so the
  // object URL from "Chỉnh sửa" gets revoked instead of leaked.
  clearUploadImage() {
    this.imagePreviewUrl.set(null);
    this.selectedFile = null;
    this.releaseEditedPreview();
  }

  private releaseEditedPreview() {
    if (this.editedPreviewUrl) {
      URL.revokeObjectURL(this.editedPreviewUrl);
      this.editedPreviewUrl = null;
    }
  }

  goToFeed() {
    this.router.navigate(['/feed']);
  }

  onCancel() {
    this.router.navigate(['/feed']);
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

  // Preview card on the right mirrors whichever tab is currently producing an image.
  previewImage(): string | null {
    return this.activeTab() === 'ai' ? this.aiImagePreviewUrl() : this.imagePreviewUrl();
  }

  setVisibility(value: 'public' | 'private') {
    this.visibility.set(value);
  }

  toggleBoardDropdown(event: MouseEvent) {
    event.stopPropagation();
    const opening = !this.showBoardDropdown();
    this.showBoardDropdown.set(opening);
    if (!opening) {
      this.cancelNewBoard(event);
    }
  }

  selectBoard(board: Board, event: MouseEvent) {
    event.stopPropagation();
    this.selectedBoard.set(board);
    this.showBoardDropdown.set(false);
  }

  openNewBoardInput(event: MouseEvent) {
    event.stopPropagation();
    this.showNewBoardInput.set(true);
    this.newBoardName = '';
    this.newBoardError.set(null);
  }

  cancelNewBoard(event: Event) {
    event.stopPropagation();
    this.showNewBoardInput.set(false);
    this.newBoardName = '';
    this.newBoardError.set(null);
  }

  async confirmNewBoard(event: Event) {
    event.stopPropagation();
    const name = this.newBoardName.trim();
    if (!name) {
      this.newBoardError.set('Vui lòng nhập tên bảng.');
      return;
    }
    const duplicate = this.boards().some((b) => b.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      this.newBoardError.set('Bạn đã có bảng trùng tên này rồi.');
      return;
    }

    const token = await this.supabaseService.getSessionToken();
    if (!token) return;

    this.isCreatingBoard.set(true);
    try {
      const newBoard = await this.boardService.createBoard(name, '', false, token);
      this.boards.update((list) => [...list, newBoard]);
      this.selectedBoard.set(newBoard);
      this.showNewBoardInput.set(false);
      this.showBoardDropdown.set(false);
      this.newBoardName = '';
      this.newBoardError.set(null);
    } catch (error) {
      console.error('Error creating board from Create page:', error);
      this.newBoardError.set('Không tạo được bảng. Vui lòng thử lại.');
    } finally {
      this.isCreatingBoard.set(false);
    }
  }

  getSelectedBoardName(): string {
    const active = this.selectedBoard();
    if (active) {
      return active.name;
    }
    return 'Chọn bảng';
  }

  async onFileSelected(event: any) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      await this.processSelectedFile(file);
    }
    input.value = '';
  }

  public isDraggingOverDropzone = signal<boolean>(false);

  onDropzoneDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDraggingOverDropzone.set(true);
  }

  onDropzoneDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDraggingOverDropzone.set(false);
  }

  async onDropzoneDrop(event: DragEvent) {
    event.preventDefault();
    this.isDraggingOverDropzone.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      await this.processSelectedFile(file);
    }
  }

  private async processSelectedFile(file: File) {
    if (!file.type.startsWith('image/')) {
      this.toastService.error('Vui lòng chọn một file ảnh.');
      return;
    }

    this.isCheckingImage.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (token) {
        await this.moderationService.checkImage(file, token);
      }
      this.releaseEditedPreview();
      this.selectedFile = file;
      const objectUrl = URL.createObjectURL(file);
      this.imagePreviewUrl.set(objectUrl);
    } catch (error) {
      this.toastService.error(error instanceof Error ? error.message : 'Ảnh không hợp lệ.');
    } finally {
      this.isCheckingImage.set(false);
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
        if (this.isPremium()) {
          formData.append('isPremium', 'true');
          formData.append('priceCredits', String(this.clampPrice()));
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
          generationModel: this.aiModel,
          isPremium: this.isPremium(),
          priceCredits: this.isPremium() ? this.clampPrice() : undefined,
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
