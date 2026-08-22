import { Component, OnInit, inject, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { PinService } from '../../core/services/pin';
import { BoardService, Board } from '../../core/services/board';
import { SupabaseService } from '../../core/services/supabase';
import { FormsModule } from '@angular/forms';
import { ImageEditor } from './image-editor/image-editor';
import { PublishDialogStatus, PublishProgressDialog } from './publish-progress-dialog/publish-progress-dialog';
import { MembershipService } from '../../core/services/membership';
import { CollageTransferService } from '../collage/services/collage-transfer.service';
import { DialogService } from '../../core/services/dialog';

/** 'idle' — no file selected / check not run yet.
 * 'checking' — request in flight.
 * 'safe' — moderation service confirmed the image is clear.
 * 'unsafe' — moderation service confirmed NSFW content above threshold.
 * 'error' — the check itself failed (network/timeout/service down); this is
 * NOT a verdict on the image and must never be treated as 'unsafe'. */
type ImageModerationStatus = 'idle' | 'checking' | 'safe' | 'unsafe' | 'error';

@Component({
  selector: 'app-create',
  standalone: true,
  imports: [CommonModule, Navbar, FormsModule, ImageEditor, PublishProgressDialog],
  templateUrl: './create.html',
  styleUrl: './create.css'
})
export class Create implements OnInit {
  private router = inject(Router);
  private pinService = inject(PinService);
  private boardService = inject(BoardService);
  public supabaseService = inject(SupabaseService);
  public membership = inject(MembershipService);
  private collageTransfer = inject(CollageTransferService);
  private dialogService = inject(DialogService);

  // Only ever mounted while activeTab() === 'upload' and an image is
  // selected — <app-image-editor> is not present anywhere in the AI tab.
  @ViewChild('editor') editorRef?: ImageEditor;

  // Form Fields
  public title = '';
  public description = '';
  public price: number | null = null;
  public activeTab = signal<'upload' | 'ai'>('upload');

  // Boards selector fields
  public boards = signal<Board[]>([]);
  public selectedBoard = signal<Board | null>(null);
  public showBoardDropdown = signal<boolean>(false);

  // Upload mode fields
  public selectedFile: File | null = null;
  public imagePreviewUrl = signal<string | null>(null);

  // NSFW pre-submit moderation check (server-side gate is enforced again on
  // submit — this is UX only, to disable "Đăng" before the user even tries).
  // Kept as one discriminated status instead of separate booleans so
  // "check failed" (error) can never be conflated with "confirmed NSFW"
  // (unsafe) — they have different messages and only 'unsafe' blocks
  // permanently; 'error' offers a retry.
  public imageModerationStatus = signal<ImageModerationStatus>('idle');
  public imageModerationMessage = signal<string | null>(null);

  // AI mode fields
  public aiPrompt = '';
  public aiModel = 'flux'; // flux | flux-anime | flux-realism | flux-3d
  public aiImagePreviewUrl = signal<string | null>(null);
  public isGenerating = signal<boolean>(false);

  // Submit status
  public isSubmitting = signal<boolean>(false);
  public formError = signal<string | null>(null);

  // Publish progress dialog — replaces alert()/confirm() for submit results.
  public dialogOpen = signal(false);
  public dialogStatus = signal<PublishDialogStatus>('processing');
  public dialogMessage = signal('');
  public dialogErrorMessage = signal('');

  async ngOnInit() {
    await this.membership.load();
    const collageFile = this.collageTransfer.take();
    if (collageFile) {
      this.selectedFile = collageFile;
      this.formError.set(null);
      this.resetImageModeration();
      this.imagePreviewUrl.set(URL.createObjectURL(collageFile));
      await this.checkSelectedImage(collageFile);
    }
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

  setTab(tab: 'upload' | 'ai') {
    if (this.dialogOpen() || tab === this.activeTab()) return;
    this.runOrConfirmDiscard(() => this.applyTabSwitch(tab));
  }

  private applyTabSwitch(tab: 'upload' | 'ai') {
    this.activeTab.set(tab);
    this.imagePreviewUrl.set(null);
    this.aiImagePreviewUrl.set(null);
    this.selectedFile = null;
    this.aiPrompt = '';
    this.title = '';
    this.description = '';
    this.formError.set(null);
    this.resetImageModeration();
  }

  private resetImageModeration(): void {
    this.imageModerationStatus.set('idle');
    this.imageModerationMessage.set(null);
  }

  /** Routes an action that would discard the editor's in-progress edits
   * (switching tabs, replacing the image) through the shared confirm dialog
   * instead of window.confirm(). Runs immediately when there's nothing to lose. */
  private async runOrConfirmDiscard(action: () => void): Promise<void> {
    if (this.activeTab() === 'upload' && this.editorRef?.isDirty()) {
      const confirmed = await this.dialogService.confirm({
        variant: 'warning',
        title: 'Bạn có chỉnh sửa chưa lưu',
        description: 'Tiếp tục sẽ làm mất các thay đổi màu sắc và caption trên ảnh này. Bạn có chắc chắn muốn tiếp tục?',
        confirmLabel: 'Tiếp tục, bỏ chỉnh sửa',
        cancelLabel: 'Hủy',
      });
      if (confirmed) action();
      return;
    }
    action();
  }

  replaceUploadedImage() {
    if (this.dialogOpen()) return;
    this.runOrConfirmDiscard(() => {
      this.imagePreviewUrl.set(null);
      this.selectedFile = null;
      this.resetImageModeration();
    });
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
    return 'Chọn bộ sưu tập';
  }

  async onFileSelected(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    this.selectedFile = file;
    this.formError.set(null);
    this.resetImageModeration();
    const objectUrl = URL.createObjectURL(file);
    this.imagePreviewUrl.set(objectUrl);

    await this.checkSelectedImage(file);
  }

  /** Runs the pre-submit NSFW check for a just-selected file. Guards every
   * state write with `this.selectedFile === file` so that if the user swaps
   * in a different image (or removes it) while this request is in flight,
   * a late response can't stamp a stale result onto the current image.
   *
   * 'unsafe' is set ONLY when the moderation service actually returned a
   * verdict saying the image is NSFW. Any network failure, timeout, or
   * non-2xx response instead sets 'error' — the image was never judged,
   * so it must not be treated as blocked-for-content. */
  private async checkSelectedImage(file: File): Promise<void> {
    const token = await this.supabaseService.getSessionToken();
    if (!token || this.selectedFile !== file) return;

    this.imageModerationStatus.set('checking');
    this.imageModerationMessage.set(null);

    try {
      const result = await this.pinService.checkImageModeration(file, token);
      if (this.selectedFile !== file) return;

      if (result.safe) {
        this.imageModerationStatus.set('safe');
      } else {
        this.imageModerationStatus.set('unsafe');
        this.imageModerationMessage.set(
          result.message || 'Ảnh có thể chứa nội dung không phù hợp hoặc nội dung 18+. Vui lòng chọn ảnh khác.',
        );
      }
    } catch (error) {
      console.error('Error checking image moderation (service/network failure, not a content verdict):', error);
      if (this.selectedFile !== file) return;
      this.imageModerationStatus.set('error');
      this.imageModerationMessage.set('Không thể kiểm tra ảnh lúc này. Vui lòng thử lại.');
    }
  }

  /** Re-runs the moderation check for the currently selected file after an
   * 'error' status (service/network failure). */
  retryImageCheck(): void {
    if (!this.selectedFile) return;
    void this.checkSelectedImage(this.selectedFile);
  }

  async generateAiImage() {
    if (this.dialogOpen() || !this.aiPrompt.trim()) return;
    this.formError.set(null);
    // Kiểm tra mềm dựa trên trạng thái đã cache - chặn thật sự nằm ở
    // saveAiPin() phía backend (trừ quota nguyên tử khi lưu, không thể bị
    // bỏ qua bằng cách gọi thẳng Pollinations rồi chỉ submit form).
    const remaining = this.membership.status()?.aiRemaining;
    if (remaining !== undefined && remaining <= 0) {
      this.formError.set('Bạn đã hết lượt tạo AI hôm nay.');
      return;
    }
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
      this.formError.set('Lỗi tạo ảnh AI. Vui lòng thử lại.');
      this.isGenerating.set(false);
    };
  }

  async onSubmit() {
    if (this.isSubmitting()) return;
    this.formError.set(null);

    const currentUser = this.supabaseService.user();
    if (!currentUser) {
      this.formError.set('Vui lòng đăng nhập để tiếp tục.');
      return;
    }

    const currentTab = this.activeTab();

    if (currentTab === 'upload' && !this.selectedFile) {
      this.formError.set('Vui lòng chọn ảnh tải lên!');
      return;
    }
    if (currentTab === 'upload' && this.imageModerationStatus() !== 'safe') {
      const status = this.imageModerationStatus();
      if (status === 'checking') {
        this.formError.set('Vui lòng đợi kiểm tra ảnh xong.');
      } else {
        this.formError.set(this.imageModerationMessage() || 'Ảnh chưa vượt qua kiểm duyệt. Vui lòng chọn ảnh khác.');
      }
      return;
    }
    if (currentTab === 'ai' && !this.aiImagePreviewUrl()) {
      this.formError.set('Vui lòng tạo ảnh AI trước!');
      return;
    }
    if (!this.title.trim()) {
      this.formError.set('Vui lòng nhập tiêu đề!');
      return;
    }

    if (currentTab === 'upload') {
      await this.submitUpload();
    } else {
      await this.submitAi();
    }
  }

  /** Resolves the board to save into, creating the default "Hồ sơ" board on
   * first use — unchanged from the previous flow. */
  private async resolveBoardId(token: string): Promise<string | undefined> {
    let boardId = this.selectedBoard()?.id;
    if (!boardId && this.boards().length > 0) {
      boardId = this.boards()[0].id;
    }
    if (!boardId) {
      try {
        const defaultBoard = await this.boardService.createBoard('Hồ sơ', 'Bộ sưu tập lưu mặc định', false, token);
        this.boards.update(list => [defaultBoard, ...list]);
        boardId = defaultBoard.id;
      } catch (err) {
        console.error('Failed to create default board:', err);
      }
    }
    return boardId;
  }

  private async submitUpload(): Promise<void> {
    const token = await this.supabaseService.getSessionToken();
    if (!token || !this.selectedFile) {
      this.formError.set('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      return;
    }

    const isDirty = !!this.editorRef?.isDirty();
    this.openDialog(isDirty ? 'Đang xử lý ảnh…' : 'Đang tải ảnh lên…');
    this.isSubmitting.set(true);

    try {
      let fileToUpload: File = this.selectedFile;

      // Only re-encode through the editor if the user actually changed
      // something — otherwise upload the original file to avoid needless
      // quality loss/CPU cost.
      if (isDirty && this.editorRef) {
        this.dialogMessage.set('Đang áp dụng màu sắc và caption…');
        try {
          fileToUpload = await this.editorRef.exportFile(`pin_${Date.now()}`, this.selectedFile.type);
        } catch (error) {
          console.error('Error exporting edited image:', error);
          this.showDialogError('Không thể xử lý ảnh đã chỉnh sửa. Vui lòng thử lại.');
          return;
        }
      }

      this.dialogMessage.set('Đang tải ảnh lên…');
      const boardId = await this.resolveBoardId(token);

      const formData = new FormData();
      formData.append('image', fileToUpload);
      formData.append('title', this.title.trim());
      formData.append('description', this.description.trim());
      if (boardId) {
        formData.append('boardId', boardId);
      }
      if (this.membership.status()?.canSell && this.price) formData.append('price', String(this.price));
      // Regular uploads never carry AI metadata, regardless of tab history.

      await this.pinService.createUploadPin(formData, token);
      await this.handlePublishSuccess();
    } catch (error) {
      console.error('Error uploading pin:', error);
      // Server-thrown business messages (e.g. the NSFW rejection, which can
      // still happen here if this request bypassed the pre-submit check)
      // are shown as-is; raw network failures fall back to a generic message.
      const message = error instanceof Error ? error.message : '';
      const isNetworkError = !message || message.includes('Failed to fetch') || message.startsWith('Failed to upload pin:');
      this.showDialogError(
        isNetworkError ? 'Không thể tải ảnh lên. Vui lòng kiểm tra kết nối và thử lại.' : message,
      );
    } finally {
      this.isSubmitting.set(false);
    }
  }

  private async submitAi(): Promise<void> {
    const token = await this.supabaseService.getSessionToken();
    const previewUrl = this.aiImagePreviewUrl();
    if (!token || !previewUrl) {
      this.formError.set('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      return;
    }

    this.openDialog('Đang lưu ảnh AI…');
    this.isSubmitting.set(true);

    try {
      const boardId = await this.resolveBoardId(token);
      const body = {
        previewUrl,
        title: this.title.trim(),
        description: this.description.trim(),
        boardId: boardId || undefined,
        promptUsed: this.aiPrompt.trim(),
        generationModel: this.aiModel,
      };

      await this.pinService.saveAiPin(body, token);
      await this.membership.load();
      await this.handlePublishSuccess();
    } catch (error) {
      console.error('Error saving AI pin:', error);
      this.showDialogError(error instanceof Error ? error.message : 'Không thể lưu ảnh AI. Vui lòng thử lại.');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  private openDialog(message: string): void {
    this.dialogErrorMessage.set('');
    this.dialogMessage.set(message);
    this.dialogStatus.set('processing');
    this.dialogOpen.set(true);
  }

  private showDialogError(message: string): void {
    this.dialogErrorMessage.set(message);
    this.dialogStatus.set('error');
  }

  private async handlePublishSuccess(): Promise<void> {
    this.dialogStatus.set('success');
    await new Promise(resolve => setTimeout(resolve, 800));

    const username = await this.resolveOwnUsername();
    try {
      if (username) {
        const navigated = await this.router.navigate(['/profile', username]);
        if (navigated) return;
        console.error('Navigating to own profile did not complete; falling back to /feed.');
      } else {
        console.error("Could not resolve the current user's username after publishing; falling back to /feed.");
      }
      await this.router.navigate(['/feed']);
    } catch (navError) {
      console.error('Unexpected navigation error after publishing:', navError);
      await this.router.navigate(['/feed']);
    }
  }

  /** Username for the post-publish redirect, in priority order: the synced
   * DB user (retried briefly in case sync is still in flight), then
   * Supabase auth metadata, then the email local-part as a last resort. */
  private async resolveOwnUsername(): Promise<string | null> {
    const immediate = this.supabaseService.dbUser()?.username;
    if (immediate) return immediate;

    for (let i = 0; i < 4; i++) {
      await new Promise(resolve => setTimeout(resolve, 120));
      const retried = this.supabaseService.dbUser()?.username;
      if (retried) return retried;
    }

    const user = this.supabaseService.user();
    if (!user) return null;

    const metaUsername = (user.user_metadata?.['full_name'] || user.user_metadata?.['name'] || '').trim();
    if (metaUsername) return metaUsername;

    const email = user.email || '';
    const prefix = email.split('@')[0];
    return prefix || null;
  }

  onDialogRetry(): void {
    void this.onSubmit();
  }

  onDialogDismiss(): void {
    if (this.dialogStatus() !== 'error') return;
    this.dialogOpen.set(false);
  }
}
