import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Navbar } from '../../components/navbar/navbar';
import { ThemeService, ThemePreference } from '../../core/services/theme';

interface ThemeOption {
  value: ThemePreference;
  label: string;
  description: string;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, Navbar],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings {
  protected readonly theme = inject(ThemeService);

  protected readonly themeOptions: ThemeOption[] = [
    { value: 'system', label: 'Theo hệ thống', description: 'Tự động khớp với giao diện thiết bị của bạn.' },
    { value: 'light', label: 'Sáng', description: 'Sương Ngọc — nền sáng, dịu mắt ban ngày.' },
    { value: 'dark', label: 'Tối', description: 'Đêm Lam — nền tối, phù hợp không gian thiếu sáng.' },
  ];

  selectTheme(value: ThemePreference): void {
    this.theme.setTheme(value);
  }

  toggleQuickToggle(): void {
    this.theme.setShowQuickToggle(!this.theme.showQuickToggle());
  }
}
