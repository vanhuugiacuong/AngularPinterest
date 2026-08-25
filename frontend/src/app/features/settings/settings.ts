import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { Switch } from '../../shared/switch/switch';
import { ThemeService, ThemePreference } from '../../core/services/theme';
import { MembershipService } from '../../core/services/membership';
import { SupabaseService } from '../../core/services/supabase';
import { UserService } from '../../core/services/user';
import {
  WatermarkPosition,
  WatermarkPreset,
  WatermarkPresetForm,
  WatermarkService,
  WatermarkType,
} from '../../core/services/watermark';
import { SUPPORTED_BANKS } from '../../core/utils/vietqr';

interface ThemeOption {
  value: ThemePreference;
  label: string;
  description: string;
}

const POSITIONS: { value: WatermarkPosition; label: string }[] = [
  { value: 'TOP_LEFT', label: 'Trên · Trái' }, { value: 'TOP_CENTER', label: 'Trên · Giữa' }, { value: 'TOP_RIGHT', label: 'Trên · Phải' },
  { value: 'MIDDLE_LEFT', label: 'Giữa · Trái' }, { value: 'MIDDLE_CENTER', label: 'Giữa · Giữa' }, { value: 'MIDDLE_RIGHT', label: 'Giữa · Phải' },
  { value: 'BOTTOM_LEFT', label: 'Dưới · Trái' }, { value: 'BOTTOM_CENTER', label: 'Dưới · Giữa' }, { value: 'BOTTOM_RIGHT', label: 'Dưới · Phải' },
];

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, Navbar, Switch],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings implements OnInit {
  protected readonly theme = inject(ThemeService);
  protected readonly membership = inject(MembershipService);
  protected readonly watermark = inject(WatermarkService);
  private readonly supabaseService = inject(SupabaseService);
  private readonly userService = inject(UserService);

  protected readonly themeOptions: ThemeOption[] = [
    { value: 'system', label: 'Theo hệ thống', description: 'Tự động khớp với giao diện thiết bị của bạn.' },
    { value: 'light', label: 'Sáng', description: 'Sương Ngọc — nền sáng, dịu mắt ban ngày.' },
    { value: 'dark', label: 'Tối', description: 'Đêm Lam — nền tối, phù hợp không gian thiếu sáng.' },
  ];

  protected readonly positions = POSITIONS;
  protected readonly supportedBanks = SUPPORTED_BANKS;
  protected membershipLoading = signal(true);
  // --- Thông tin nhận thanh toán (người bán) ---
  protected payoutBankCode = '';
  protected payoutAccountNumber = '';
  protected payoutAccountName = '';
  protected payoutLoading = signal(false);
  protected payoutSaving = signal(false);
  protected payoutError = signal('');
  protected payoutSaved = signal(false);

  protected privacyPending = signal(false);
  protected privacyError = signal('');
  protected previewPinId = signal<string | null>(null);
  protected previewUrl = signal<string | null>(null);
  protected previewLoading = signal(false);
  protected formError = signal('');
  protected saving = signal(false);
  protected editingId = signal<string | null>(null);

  protected name = 'Watermark của tôi';
  protected type: WatermarkType = 'TEXT';
  protected text = 'NovaFrame';
  protected logoFile: File | undefined;
  protected position: WatermarkPosition = 'BOTTOM_RIGHT';
  protected opacity = 0.6;
  protected scale = 0.2;
  protected margin = 0.03;
  protected rotation = 0;
  protected tiled = false;
  protected spacing = 0.5;
  protected isDefault = false;

  async ngOnInit(): Promise<void> {
    try {
      await this.membership.load();
    } catch {
      // Trang Settings vẫn hiển thị được (mục Watermark ở trạng thái khoá) dù không tải được trạng thái gói.
    } finally {
      this.membershipLoading.set(false);
    }
    if (this.canSell()) {
      void this.loadPayoutAccount();
    }
    if (!this.canUseWatermark()) return;
    try {
      await this.watermark.list();
      await this.loadPreviewPin();
    } catch {
      // Không chặn phần còn lại của trang nếu tải preset/preview thất bại.
    }
  }

  canUseWatermark(): boolean {
    return this.membership.status()?.customWatermark === true;
  }

  canSell(): boolean {
    return this.membership.status()?.canSell === true;
  }

  private async loadPayoutAccount(): Promise<void> {
    this.payoutLoading.set(true);
    try {
      const account = await this.membership.getPayoutAccount();
      if (account) {
        this.payoutBankCode = account.bankCode;
        this.payoutAccountNumber = account.accountNumber;
        this.payoutAccountName = account.accountName;
      }
    } catch {
      // Không chặn phần còn lại của trang nếu tải thất bại — form vẫn trống, người dùng nhập lại được.
    } finally {
      this.payoutLoading.set(false);
    }
  }

  async savePayoutAccount(): Promise<void> {
    this.payoutSaved.set(false);
    if (!this.payoutBankCode) {
      this.payoutError.set('Vui lòng chọn ngân hàng.');
      return;
    }
    if (!/^\d{6,19}$/.test(this.payoutAccountNumber.trim())) {
      this.payoutError.set('Số tài khoản không hợp lệ (chỉ chữ số, 6-19 ký tự).');
      return;
    }
    if (!this.payoutAccountName.trim()) {
      this.payoutError.set('Vui lòng nhập tên chủ tài khoản.');
      return;
    }

    this.payoutError.set('');
    this.payoutSaving.set(true);
    try {
      await this.membership.updatePayoutAccount({
        bankCode: this.payoutBankCode,
        accountNumber: this.payoutAccountNumber.trim(),
        accountName: this.payoutAccountName.trim(),
      });
      this.payoutSaved.set(true);
    } catch (e) {
      this.payoutError.set(e instanceof Error ? e.message : 'Không thể lưu thông tin nhận thanh toán.');
    } finally {
      this.payoutSaving.set(false);
    }
  }

  canUseAdvanced(): boolean {
    return this.membership.status()?.advancedWatermark === true;
  }

  presetLimitReached(): boolean {
    const status = this.membership.status();
    if (!status) return false;
    return this.watermark.presets().length >= status.maxWatermarkPresets && !this.editingId();
  }

  private async loadPreviewPin(): Promise<void> {
    const username = this.supabaseService.dbUser()?.username;
    if (!username) return;
    try {
      const token = await this.supabaseService.getSessionToken();
      const result = await this.userService.getUserPosts(username, 1, 1, token ?? undefined);
      this.previewPinId.set(result.items[0]?.id ?? null);
    } catch {
      this.previewPinId.set(null);
    }
  }

  onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.logoFile = input.files?.[0];
  }

  private currentForm(): WatermarkPresetForm {
    return {
      name: this.name.trim() || 'Watermark',
      type: this.type,
      text: this.type === 'TEXT' ? this.text.trim() : undefined,
      position: this.position,
      opacity: this.opacity,
      scale: this.scale,
      margin: this.margin,
      rotation: this.canUseAdvanced() ? this.rotation : 0,
      tiled: this.canUseAdvanced() ? this.tiled : false,
      spacing: this.spacing,
      isDefault: this.isDefault,
      logo: this.logoFile,
    };
  }

  async refreshPreview(): Promise<void> {
    const pinId = this.previewPinId();
    if (!pinId) {
      this.formError.set('Bạn cần có ít nhất 1 ảnh đã đăng để xem trước watermark.');
      return;
    }
    if (this.type === 'TEXT' && !this.text.trim()) {
      this.formError.set('Nhập nội dung chữ trước khi xem trước.');
      return;
    }
    this.formError.set('');
    this.previewLoading.set(true);
    try {
      const url = await this.watermark.preview(pinId, this.currentForm());
      const previous = this.previewUrl();
      this.previewUrl.set(url);
      if (previous) URL.revokeObjectURL(previous);
    } catch (e) {
      this.formError.set(e instanceof Error ? e.message : 'Không thể tạo bản xem trước.');
    } finally {
      this.previewLoading.set(false);
    }
  }

  async savePreset(): Promise<void> {
    if (!this.name.trim()) { this.formError.set('Nhập tên cấu hình.'); return; }
    if (this.type === 'TEXT' && !this.text.trim()) { this.formError.set('Nhập nội dung chữ.'); return; }
    if (this.type === 'LOGO' && !this.logoFile && !this.editingId()) { this.formError.set('Chọn file logo.'); return; }

    this.formError.set('');
    this.saving.set(true);
    try {
      const id = this.editingId();
      if (id) await this.watermark.update(id, this.currentForm());
      else await this.watermark.create(this.currentForm());
      this.resetForm();
    } catch (e) {
      this.formError.set(e instanceof Error ? e.message : 'Không thể lưu cấu hình.');
    } finally {
      this.saving.set(false);
    }
  }

  editPreset(preset: WatermarkPreset): void {
    this.editingId.set(preset.id);
    this.name = preset.name;
    this.type = preset.type;
    this.text = preset.text ?? '';
    this.position = preset.position;
    this.opacity = preset.opacity;
    this.scale = preset.scale;
    this.margin = preset.margin;
    this.rotation = preset.rotation;
    this.tiled = preset.tiled;
    this.spacing = preset.spacing;
    this.isDefault = preset.isDefault;
    this.logoFile = undefined;
    this.formError.set('');
  }

  cancelEdit(): void {
    this.resetForm();
  }

  private resetForm(): void {
    this.editingId.set(null);
    this.name = 'Watermark của tôi';
    this.type = 'TEXT';
    this.text = 'NovaFrame';
    this.logoFile = undefined;
    this.position = 'BOTTOM_RIGHT';
    this.opacity = 0.6;
    this.scale = 0.2;
    this.margin = 0.03;
    this.rotation = 0;
    this.tiled = false;
    this.spacing = 0.5;
    this.isDefault = false;
  }

  async deletePreset(id: string): Promise<void> {
    this.formError.set('');
    try {
      await this.watermark.remove(id);
      if (this.editingId() === id) this.resetForm();
    } catch (e) {
      this.formError.set(e instanceof Error ? e.message : 'Không thể xoá cấu hình.');
    }
  }

  async setDefault(preset: WatermarkPreset): Promise<void> {
    try {
      await this.watermark.update(preset.id, { name: preset.name, type: preset.type, isDefault: true });
    } catch (e) {
      this.formError.set(e instanceof Error ? e.message : 'Không thể đặt mặc định.');
    }
  }

  isPrivateAccount(): boolean {
    return this.supabaseService.dbUser()?.isPrivate === true;
  }

  async togglePrivacy(): Promise<void> {
    if (this.privacyPending()) return;
    const current = this.supabaseService.dbUser();
    if (!current) return;
    const nextValue = !current.isPrivate;
    this.privacyPending.set(true);
    this.privacyError.set('');
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) throw new Error('Phiên đăng nhập đã hết hạn.');
      const result = await this.userService.updatePrivacy(nextValue, token);
      this.supabaseService.dbUser.set({ ...current, isPrivate: result.isPrivate });
    } catch (e) {
      this.privacyError.set(e instanceof Error ? e.message : 'Không thể cập nhật quyền riêng tư.');
    } finally {
      this.privacyPending.set(false);
    }
  }

  selectTheme(value: ThemePreference): void {
    this.theme.setTheme(value);
  }

  toggleQuickToggle(): void {
    this.theme.setShowQuickToggle(!this.theme.showQuickToggle());
  }
}
