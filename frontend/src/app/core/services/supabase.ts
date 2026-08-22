import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { API_BASE_URL } from '../api-base';
import type { MembershipPlan } from '../models/membership-plan';

/** Shape of the backend's own `User` row, as returned verbatim by
 * `POST /api/users/sync` (the signed-in caller's own record — includes
 * `plan` directly, so the navbar/account-popup avatar never needs a
 * separate membership fetch just to know its own frame). */
export interface DbUser {
  id: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: string;
  plan: MembershipPlan;
  ownedPlans: MembershipPlan[];
  planStartedAt: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class SupabaseService {
  private supabase: SupabaseClient;
  public user = signal<User | null>(null);
  public loading = signal<boolean>(true);
  public dbUser = signal<DbUser | null>(null);

  constructor() {
    const supabaseUrl = 'https://ccepvvaicgjvuaxutrxd.supabase.co';
    const supabaseKey = 'sb_publishable_yFcSjEovLQeHYL0rwSe1Uw_BHrvOftU';

    this.supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    // Check current session on initialization
    this.initSession();

    // Listen to authentication state changes
    this.supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event, session);
      const currentUser = session?.user || null;
      this.user.set(currentUser);
      this.loading.set(false);

      if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && session) {
        await this.syncUserWithBackend(session.access_token, session.user);
      }
    });
  }

  private async initSession() {
    try {
      const {
        data: { session },
      } = await this.supabase.auth.getSession();
      if (session) {
        this.user.set(session.user);
        await this.syncUserWithBackend(session.access_token, session.user);
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
        redirectTo: window.location.origin,
      },
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
    const {
      data: { session },
    } = await this.supabase.auth.getSession();
    return session?.access_token || null;
  }

  /** Shared authenticated client for Realtime Presence/Broadcast channels. */
  getRealtimeClient(): SupabaseClient {
    return this.supabase;
  }

  private async syncUserWithBackend(token: string, user: User) {
    try {
      const email = user.email || '';
      const username =
        user.user_metadata?.['full_name'] || user.user_metadata?.['name'] || email.split('@')[0];
      const avatarUrl = user.user_metadata?.['avatar_url'] || user.user_metadata?.['picture'] || '';

      console.log('Syncing user with backend...', { email, username, avatarUrl });
      const response = await fetch(`${API_BASE_URL}/api/users/sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, avatarUrl }),
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
