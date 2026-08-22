import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase';

const PRESENCE_CHANNEL = 'pinhub-online-users';

/** App-wide "who's online" tracking — one shared channel joined as soon as
 * the user is authenticated and left on sign-out, independent of which page
 * they're on. A page-scoped presence channel (e.g. only while /chat is open)
 * would make a user look "offline" the moment they navigate away, which is
 * not what "online" should mean. */
@Injectable({ providedIn: 'root' })
export class PresenceService {
  private readonly supabaseService = inject(SupabaseService);
  private channel?: RealtimeChannel;
  private currentUserId?: string;

  readonly onlineUserIds = signal<Set<string>>(new Set());

  isOnline(userId: string | undefined | null): boolean {
    if (!userId) return false;
    return this.onlineUserIds().has(userId);
  }

  async connect(userId: string) {
    if (this.currentUserId === userId && this.channel) return;
    await this.disconnect();
    this.currentUserId = userId;

    const client = this.supabaseService.getRealtimeClient();
    const channel = client.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: userId } },
    });
    this.channel = channel;

    channel.on('presence', { event: 'sync' }, () => {
      this.onlineUserIds.set(new Set(Object.keys(channel.presenceState())));
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ onlineAt: new Date().toISOString() });
      }
    });
  }

  async disconnect() {
    const channel = this.channel;
    this.channel = undefined;
    this.currentUserId = undefined;
    this.onlineUserIds.set(new Set());
    if (channel) {
      await this.supabaseService.getRealtimeClient().removeChannel(channel);
    }
  }
}
