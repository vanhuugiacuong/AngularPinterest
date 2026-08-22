import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

// TEMP: local preview only — lets us view pages behind authGuard without a real login. Remove before shipping.
const PREVIEW_USER = {
  id: 'preview-user',
  email: 'preview@local.dev',
  user_metadata: { full_name: 'Preview User', avatar_url: '' }
} as unknown as User;

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private supabase: SupabaseClient;
  public user = signal<User | null>(null);
  public loading = signal<boolean>(true);
  public dbUser = signal<any | null>(null);

  constructor() {
    const supabaseUrl = 'https://ccepvvaicgjvuaxutrxd.supabase.co';
    const supabaseKey = 'sb_publishable_yFcSjEovLQeHYL0rwSe1Uw_BHrvOftU';

    this.supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    // Check current session on initialization
    this.initSession();

    // Listen to authentication state changes
    this.supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event, session);
      const currentUser = session?.user || PREVIEW_USER;
      this.user.set(currentUser);
      this.loading.set(false);

      if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && session) {
        await this.syncUserWithBackend(session.access_token, session.user);
      }
    });
  }

  private async initSession() {
    try {
      const { data: { session } } = await this.supabase.auth.getSession();
      if (session) {
        this.user.set(session.user);
        await this.syncUserWithBackend(session.access_token, session.user);
      } else {
        this.user.set(PREVIEW_USER);
      }
    } catch (error) {
      console.error('Error fetching initial session:', error);
    } finally {
      this.loading.set(false);
    }
  }

  async signInWithGoogle() {
    const { error } = await this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });

    if (error) {
      console.error('Google Sign In Error:', error.message);
      throw error;
    }
  }

  async signOut() {
    const { error } = await this.supabase.auth.signOut();
    if (error) {
      console.error('Sign Out Error:', error.message);
      throw error;
    }
    this.user.set(null);
    this.dbUser.set(null);
  }

  async getSessionToken(): Promise<string | null> {
    const { data: { session } } = await this.supabase.auth.getSession();
    return session?.access_token || null;
  }

  // Ensures dbUser() is populated before code that needs the real DB username
  // (e.g. navigating to "my profile") runs — covers the case where a click
  // happens before the initial sync from initSession()/onAuthStateChange finishes.
  async ensureDbUser(): Promise<any | null> {
    const existing = this.dbUser();
    if (existing) return existing;

    const token = await this.getSessionToken();
    const user = this.user();
    if (!token || !user) return null;

    await this.syncUserWithBackend(token, user);
    return this.dbUser();
  }

  private async syncUserWithBackend(token: string, user: User) {
    try {
      const email = user.email || '';
      const username = user.user_metadata?.['full_name'] || user.user_metadata?.['name'] || email.split('@')[0];
      const avatarUrl = user.user_metadata?.['avatar_url'] || user.user_metadata?.['picture'] || '';

      console.log('Syncing user with backend...', { email, username, avatarUrl });
      const response = await fetch('http://localhost:3000/api/users/sync', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, avatarUrl })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to sync user: ${errorText}`);
      }

      const dbUser = await response.json();
      console.log('User synced successfully with backend database:', dbUser);
      this.dbUser.set(dbUser);
    } catch (error) {
      console.error('Error syncing user with backend:', error);
    }
  }
}
