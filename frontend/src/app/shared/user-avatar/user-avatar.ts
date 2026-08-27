import { Component, computed, effect, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { MembershipPlan } from '../../core/models/membership-plan';

type AvatarStatus = 'loading' | 'loaded' | 'error';

/**
 * Renders a user's avatar with a real load/error lifecycle instead of a bare
 * <img>: skeleton while pending, the real photo once it decodes, and a
 * branded initials mark (never a broken-image glyph) if the URL is missing,
 * empty, or fails to load.
 *
 * Also renders the NovaFrame membership frame (Plus/Pro) around the avatar
 * when `plan` is 'PLUS' or 'PRO'. `plan` must always be the *displayed
 * user's own* active plan (`User.plan`, not the viewer's) — this component
 * never looks up membership itself, so callers own that responsibility.
 *
 * `isAdmin` renders a distinct gold platform-admin frame instead, and takes
 * priority over the Plus/Pro frame when both would apply (an admin's own
 * plan tier is not the interesting fact about their avatar).
 */
@Component({
  selector: 'app-user-avatar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './user-avatar.html',
  styleUrl: './user-avatar.css',
})
export class UserAvatar {
  src = input<string | null | undefined>(null);
  name = input<string>('');
  size = input<number>(36);
  ring = input<boolean>(true);

  /** The avatar owner's currently active plan. FREE, null, and undefined
   * are all treated identically (no frame) — only 'PLUS'/'PRO' render one. */
  plan = input<MembershipPlan | null | undefined>('FREE');
  isAdmin = input<boolean | null | undefined>(false);
  showMembershipFrame = input<boolean>(true);
  showPlanBadge = input<boolean>(true);

  status = signal<AvatarStatus>('loading');
  initials = computed(() => this.computeInitials(this.name()));

  effectivePlan = computed<MembershipPlan | null>(() => {
    const value = this.plan();
    return value === 'PLUS' || value === 'PRO' ? value : null;
  });

  /** Admin outranks Plus/Pro — an admin never shows the membership frame. */
  isAdminFrame = computed(() => this.showMembershipFrame() && !!this.isAdmin());
  hasFrame = computed(
    () => this.isAdminFrame() || (this.showMembershipFrame() && this.effectivePlan() !== null),
  );
  /** Below 24px only the ring shape itself is legible — icon/badge become noise. */
  showIcon = computed(() => this.hasFrame() && this.size() >= 24);
  showBadge = computed(() => this.hasFrame() && this.showPlanBadge() && this.size() >= 40);
  /** Gates the Pro/admin shimmer to large, singular avatars (profile hero,
   * navbar dropdown) — never at feed/list sizes, so a page with many such
   * avatars never runs many concurrent animations at once. */
  isLargeAvatar = computed(() => this.size() >= 40);

  planLabel = computed(() => {
    if (this.isAdminFrame()) return 'Quản trị viên NovaFrame';
    const value = this.effectivePlan();
    return value === 'PRO' ? 'Thành viên Pro' : value === 'PLUS' ? 'Thành viên Plus' : null;
  });

  constructor() {
    effect(() => {
      const value = (this.src() || '').trim();
      this.status.set(value ? 'loading' : 'error');
    });
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
