import { Component, inject, effect } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
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

  constructor() {
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
  }
}
