import { Injectable, signal } from '@angular/core';

export type Theme = 'dark';

const STORAGE_KEY = 'pinhub-theme';

/**
 * Dark-only: toàn site chạy dark mode. Giữ API cũ (theme()/toggleTheme) để các
 * component đang gọi không vỡ, nhưng luôn cố định 'dark'.
 */
@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  public theme = signal<Theme>('dark');

  constructor() {
    document.documentElement.classList.add('dark');
    try {
      localStorage.setItem(STORAGE_KEY, 'dark');
    } catch {
      // localStorage không dùng được — vẫn dark nhờ class trên <html>.
    }
  }

  /** Dark-only nên không đổi theme. Giữ hàm để tương thích chỗ gọi cũ. */
  toggleTheme() {
    this.theme.set('dark');
    document.documentElement.classList.add('dark');
  }
}
