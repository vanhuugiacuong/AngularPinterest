/** A user's currently active membership tier — mirrors the backend
 * `MembershipPlan` Prisma enum. Lives in its own module (rather than inside
 * membership.ts) so every user-carrying interface (Pin.user, ProfileUser,
 * PublicUserSummary, Notification.sender, SupabaseService.dbUser, ...) can
 * import it without creating a dependency cycle through MembershipService. */
export type MembershipPlan = 'FREE' | 'PLUS' | 'PRO';
