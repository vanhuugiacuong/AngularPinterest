import { Injectable, effect, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'pinhub-theme';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  public theme = signal<Theme>((localStorage.getItem(STORAGE_KEY) as Theme) || 'light');

  constructor() {
    effect(() => {
      const theme = this.theme();
      document.documentElement.classList.toggle('dark', theme === 'dark');
      localStorage.setItem(STORAGE_KEY, theme);
    });
  }

  toggleTheme() {
    this.theme.set(this.theme() === 'dark' ? 'light' : 'dark');
  }
}
