import { Component, ElementRef, inject, effect, viewChild } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { SupabaseService } from './core/services/supabase';
import { ThemeService } from './core/services/theme';
import { PresenceService } from './core/services/presence';
import { ImageProtectionService } from './core/services/image-protection';
import { AdminService } from './core/services/admin';
import { ToastContainer } from './components/toast-container/toast-container';
import { ConfirmDialog } from './components/confirm-dialog/confirm-dialog';
import { ReportDialog } from './components/report-dialog/report-dialog';
import { VisualSearchModal } from './components/visual-search-modal/visual-search-modal';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastContainer, ConfirmDialog, ReportDialog, VisualSearchModal],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private supabaseService = inject(SupabaseService);
  private router = inject(Router);
  private themeService = inject(ThemeService);
  private presenceService = inject(PresenceService);
  private imageProtectionService = inject(ImageProtectionService);
  private adminService = inject(AdminService);

  private routeHost = viewChild<ElementRef<HTMLElement>>('routeHost');

  /**
   * Fade nhẹ mỗi lần đổi trang cho đỡ "cắt phựt". Dùng Web Animations API thay
   * vì @angular/animations để khỏi kéo thêm package vào bundle; animate() chạy
   * lại được mỗi lần gọi nên không cần trick reflow như CSS animation.
   */
  private installRouteTransition() {
    const reduceMotion =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        const host = this.routeHost()?.nativeElement;
        if (!host?.animate) return;
        host.animate(
          [
            { opacity: 0, transform: 'translateY(6px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
        );
      });
  }

  constructor() {
    this.imageProtectionService.install();
    this.installRouteTransition();

    // Automatically redirect users based on authentication status changes
    effect(() => {
      const user = this.supabaseService.user();
      const loading = this.supabaseService.loading();
      
      if (!loading) {
        if (user) {
          // Redirect logged-in users away from landing/login pages to their feed
          if (this.router.url === '/' || this.router.url.includes('/login')) {
            this.router.navigate(['/feed']);
          }
        } else {
          // Redirect logged-out users trying to access protected feed back to landing
          if (this.router.url === '/feed') {
            this.router.navigate(['/']);
          }
        }
      }
    });

    // Online presence is app-wide: connect once the user is authenticated
    // (any page, not just /chat) and disconnect on sign-out.
    effect(() => {
      const dbUser = this.supabaseService.dbUser();
      const user = this.supabaseService.user();
      const userId = dbUser?.id || user?.id;
      if (userId) {
        void this.presenceService.connect(userId);
      } else if (!this.supabaseService.loading()) {
        void this.presenceService.disconnect();
      }
    });

    // Hỏi backend xem có phải admin không, để rail hiện/ẩn mục Quản trị.
    // Chỉ dùng cho giao diện — chặn thật nằm ở AdminGuard phía server.
    effect(() => {
      const user = this.supabaseService.user();
      if (user) {
        void this.adminService.checkAdmin();
      } else {
        this.adminService.isAdmin.set(false);
      }
    });
  }
}
