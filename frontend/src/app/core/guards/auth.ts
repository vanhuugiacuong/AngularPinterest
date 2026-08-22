import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase';

export const authGuard: CanActivateFn = async () => {
  const supabaseService = inject(SupabaseService);
  const router = inject(Router);

  // Wait if the session is still loading
  if (supabaseService.loading()) {
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (!supabaseService.loading()) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });
  }

  if (supabaseService.user()) {
    return true;
  }

  // User is not logged in, redirect to Landing Page
  router.navigate(['/']);
  return false;
};
