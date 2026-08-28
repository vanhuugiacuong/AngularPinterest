import { Component, inject, effect, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { SupabaseService } from './core/services/supabase';
import { ThemeService } from './core/services/theme';
import { OfflineBanner } from './shared/offline-banner/offline-banner';
import { ToastHost } from './shared/toast-host/toast-host';
import { DialogHost } from './shared/dialog-host/dialog-host';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, OfflineBanner, ToastHost, DialogHost],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private supabaseService = inject(SupabaseService);
  private router = inject(Router);
  // Injected (not just imported) so it's instantiated once at bootstrap —
  // its constructor effect keeps <html data-theme> in sync app-wide, on
  // every route, not just once the user visits /settings.
  private themeService = inject(ThemeService);

  /** Đường dẫn hiện tại THẬT SỰ — khác `router.url`, cái này không bị "kẹt"
   * ở '/' trong lúc một điều hướng vào route có guard bất đồng bộ (authGuard
   * chờ session load xong) còn đang xử lý dở. Angular chỉ cập nhật
   * `router.url` khi điều hướng đó HOÀN TẤT (NavigationEnd) — nếu F5 thẳng
   * vào /collage hay /create và đọc `router.url` ngay khi session vừa xác
   * thực xong (trước khi authGuard kịp resolve), nó vẫn còn là '/' và effect
   * bên dưới tưởng nhầm là đang đứng ở trang chủ, đá thẳng về /feed giữa
   * chừng — làm mất trang đang mở (collage/create) dù dữ liệu vẫn còn.
   * Giá trị khởi tạo lấy trực tiếp từ window.location.pathname vì trình
   * duyệt đã thực sự ở đó ngay từ đầu khi reload cứng, không cần chờ Router. */
  private currentUrl = signal(
    typeof window !== 'undefined' ? window.location.pathname : this.router.url,
  );

  constructor() {
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event) => this.currentUrl.set(event.urlAfterRedirects));

    // Automatically redirect users based on authentication status changes
    effect(() => {
      const user = this.supabaseService.user();
      const loading = this.supabaseService.loading();

      if (!loading) {
        const url = this.currentUrl();
        if (user) {
          // Redirect logged-in users away from landing/login pages to their feed
          if (url === '/' || url.includes('/login')) {
            this.router.navigate(['/feed']);
          }
        } else {
          // Redirect logged-out users trying to access protected feed back to landing
          if (url === '/feed') {
            this.router.navigate(['/']);
          }
        }
      }
    });
  }
}
