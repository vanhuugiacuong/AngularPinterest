import { Injectable, inject } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { SupabaseService } from './supabase';
import { AppNotification } from './notification';

@Injectable({
  providedIn: 'root'
})
export class NotificationSocketService {
  private supabaseService = inject(SupabaseService);
  private socket: Socket | null = null;
  private listeners = new Set<(notification: AppNotification) => void>();

  async connect() {
    if (this.socket?.connected) return;

    const token = await this.supabaseService.getSessionToken();
    if (!token) return;

    this.socket = io('http://localhost:3000', {
      auth: { token },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    this.socket.on('notification', (notification: AppNotification) => {
      this.listeners.forEach((fn) => fn(notification));
    });
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }

  onNotification(callback: (notification: AppNotification) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
}
