import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppNotification, NotificationType } from '../../core/services/notification';

const ICON_BY_TYPE: Record<NotificationType, string> = {
  like: 'favorite',
  comment: 'chat_bubble',
  follow: 'person_add',
  save: 'bookmark',
  new_pin: 'push_pin',
  message_request: 'mail',
  message: 'chat'
};

const ICON_COLOR_BY_TYPE: Record<NotificationType, string> = {
  like: 'bg-[#F94083]',
  comment: 'bg-[#3B82F6]',
  follow: 'bg-[#A855F7]',
  save: 'bg-[#F59E0B]',
  new_pin: 'bg-[#10B981]',
  message_request: 'bg-[#F97316]',
  message: 'bg-[#F94083]'
};

// Custom artwork overrides for specific types — takes priority over the icon-font badge above.
const ICON_IMAGE_BY_TYPE: Partial<Record<NotificationType, string>> = {
  like: 'icons/notif-like.png',
  comment: 'icons/notif-comment.png',
  follow: 'icons/notif-follow.png',
  save: 'icons/notif-save.png',
  new_pin: 'icons/notif-new-pin.png'
};

const DEFAULT_ICON_IMAGE_SIZE = 'w-6 h-6 -bottom-1.5 -right-1.5';
const ICON_IMAGE_SIZE_BY_TYPE: Partial<Record<NotificationType, string>> = {
  comment: 'w-5 h-5 -bottom-1 -right-1',
  follow: 'w-5 h-5 -bottom-1 -right-1'
};

@Component({
  selector: 'app-notification-item',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notification-item.html',
  styleUrl: './notification-item.css'
})
export class NotificationItem {
  @Input({ required: true }) notification!: AppNotification;
  // Popup list uses the dot to distinguish read/unread among many rows; a toast is
  // inherently "new", so the dot next to its own close button is redundant there.
  @Input() showUnreadDot = true;
  // Popup list tints the row pink while unread; a toast is always "unread" by
  // definition, so that tint would just bleed pink/purple across its whole
  // background instead of the flat --pinhub-surface used elsewhere in the app.
  @Input() unreadHighlight = true;
  @Output() itemClick = new EventEmitter<AppNotification>();

  get typeIcon(): string {
    return ICON_BY_TYPE[this.notification.type] ?? 'notifications';
  }

  get typeIconColor(): string {
    return ICON_COLOR_BY_TYPE[this.notification.type] ?? 'bg-[#62625b]';
  }

  get typeIconImage(): string | null {
    return ICON_IMAGE_BY_TYPE[this.notification.type] ?? null;
  }

  get typeIconImageSize(): string {
    return ICON_IMAGE_SIZE_BY_TYPE[this.notification.type] ?? DEFAULT_ICON_IMAGE_SIZE;
  }

  get senderAvatar(): string {
    return this.notification.sender?.avatarUrl || 'https://api.dicebear.com/7.x/bottts/svg';
  }

  get senderName(): string {
    return this.notification.sender?.username || 'PinHub';
  }

  get extraCount(): number {
    return (this.notification.groupCount ?? 1) - 1;
  }

  get timeAgo(): string {
    const seconds = Math.floor((Date.now() - new Date(this.notification.createdAt).getTime()) / 1000);
    if (seconds < 60) return 'Vừa xong';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} phút`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} giờ`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} ngày`;
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks} tuần`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} tháng`;
    return `${Math.floor(days / 365)} năm`;
  }

  onClick() {
    this.itemClick.emit(this.notification);
  }
}
