import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { SupabaseService } from '../../core/services/supabase';
import { UserService } from '../../core/services/user';
import { ToastService } from '../../core/services/toast';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, Navbar],
  templateUrl: './settings.html',
  styleUrl: './settings.css'
})
export class Settings implements OnInit {
  public supabaseService = inject(SupabaseService);
  private userService = inject(UserService);
  private toastService = inject(ToastService);
  private router = inject(Router);

  public username = '';
  public bio = '';
  public avatarUrl = signal<string>('');
  public isLoadingProfile = signal(true);
  public isSavingProfile = signal(false);
  public isUploadingAvatar = signal(false);

  async ngOnInit() {
    const dbUser = await this.supabaseService.ensureDbUser();
    if (dbUser) {
      this.username = dbUser.username || '';
      this.bio = dbUser.bio || '';
      this.avatarUrl.set(dbUser.avatarUrl || '');
    }
    this.isLoadingProfile.set(false);
  }

  get bioLength(): number {
    return this.bio.length;
  }

  async onAvatarFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.isUploadingAvatar.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;
      const updated = await this.userService.uploadAvatar(file, token);
      this.avatarUrl.set(updated.avatarUrl);
      this.supabaseService.dbUser.set(updated);
      this.toastService.success('Đã cập nhật ảnh đại diện!');
    } catch (error) {
      console.error('Error uploading avatar:', error);
      this.toastService.error('Lỗi khi tải ảnh đại diện lên.');
    } finally {
      this.isUploadingAvatar.set(false);
      input.value = '';
    }
  }

  async saveProfile() {
    if (this.username.trim().length < 3) {
      this.toastService.error('Tên người dùng phải có ít nhất 3 ký tự.');
      return;
    }

    this.isSavingProfile.set(true);
    try {
      const token = await this.supabaseService.getSessionToken();
      if (!token) return;
      const updated = await this.userService.updateProfile(
        { username: this.username.trim(), bio: this.bio.trim() },
        token
      );
      this.supabaseService.dbUser.set(updated);
      this.toastService.success('Đã lưu thông tin hồ sơ!');
    } catch (error: any) {
      console.error('Error saving profile:', error);
      this.toastService.error(error?.message || 'Lỗi khi lưu hồ sơ.');
    } finally {
      this.isSavingProfile.set(false);
    }
  }

  async signOut() {
    await this.supabaseService.signOut();
    this.router.navigate(['/']);
  }
}
