import { Component, Input, OnChanges, SimpleChanges, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

type AvatarStatus = 'loading' | 'loaded' | 'error';

/**
 * Renders a user's avatar with a real load/error lifecycle instead of a bare
 * <img>: skeleton while pending, the real photo once it decodes, and a
 * branded initials mark (never a broken-image glyph) if the URL is missing,
 * empty, or fails to load.
 */
@Component({
  selector: 'app-user-avatar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './user-avatar.html',
  styleUrl: './user-avatar.css',
})
export class UserAvatar implements OnChanges {
  @Input() src: string | null | undefined = null;
  @Input() name = '';
  @Input() size = 36;
  @Input() ring = true;

  public status = signal<AvatarStatus>('loading');
  public initials = computed(() => this.computeInitials(this.name));

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['src']) {
      const value = (this.src || '').trim();
      this.status.set(value ? 'loading' : 'error');
    }
  }

  onImageLoad(): void {
    this.status.set('loaded');
  }

  onImageError(): void {
    this.status.set('error');
  }

  private computeInitials(name: string): string {
    const trimmed = (name || '').trim();
    if (!trimmed) return '?';
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
}
