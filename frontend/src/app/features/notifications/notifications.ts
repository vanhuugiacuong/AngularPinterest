import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Navbar } from '../../components/navbar/navbar';
import { NotificationItem } from '../../components/notification-item/notification-item';
import { NotificationService, AppNotification } from '../../core/services/notification';
import { SupabaseService } from '../../core/services/supabase';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule, Navbar, NotificationItem],
  templateUrl: './notifications.html',
  styleUrl: './notifications.css'
})
export class Notifications implements OnInit {
  private notificationService = inject(NotificationService);
  private supabaseService = inject(SupabaseService);
  private router = inject(Router);

  public notifications = signal<AppNotification[]>([]);
  public loading = signal(true);

  async ngOnInit() {
    const token = await this.supabaseService.getSessionToken();
    if (!token) {
      this.loading.set(false);
      return;
    }
    try {
      this.notifications.set(await this.notificationService.getNotifications(token, 1, 50));
      await this.notificationService.markAllRead(token);
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      this.loading.set(false);
    }
  }

  onNotificationClick(notification: AppNotification) {
    if (notification.pin) {
      this.router.navigate(['/pin', notification.pin.id]);
    } else if (notification.sender) {
      this.router.navigate(['/profile', notification.sender.username]);
    }
  }
}
