import { Component, inject, effect } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { SupabaseService } from './core/services/supabase';
import { ThemeService } from './core/services/theme';
import { PresenceService } from './core/services/presence';
import { ToastContainer } from './components/toast-container/toast-container';
import { ConfirmDialog } from './components/confirm-dialog/confirm-dialog';
import { VisualSearchModal } from './components/visual-search-modal/visual-search-modal';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastContainer, ConfirmDialog, VisualSearchModal],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private supabaseService = inject(SupabaseService);
  private router = inject(Router);
  private themeService = inject(ThemeService);
  private presenceService = inject(PresenceService);

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
  }
}
