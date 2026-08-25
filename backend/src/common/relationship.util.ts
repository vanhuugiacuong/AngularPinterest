import { Prisma, PrismaClient } from '@prisma/client';

type FollowAndRequestClient = Pick<PrismaClient, 'follow' | 'messageRequest'>;

/** Stable, order-independent key for a 1-1 conversation between two users. */
export function buildParticipantKey(userAId: string, userBId: string): string {
  return [userAId, userBId].sort().join(':');
}

export function sortParticipants(userAId: string, userBId: string): [string, string] {
  const [a, b] = [userAId, userBId].sort();
  return [a, b];
}

export async function isMutualFollow(
  prisma: FollowAndRequestClient,
  userAId: string,
  userBId: string,
): Promise<boolean> {
  const [aFollowsB, bFollowsA] = await Promise.all([
    prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: userAId, followingId: userBId }, status: 'ACCEPTED' },
      select: { followerId: true },
    }),
    prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: userBId, followingId: userAId }, status: 'ACCEPTED' },
      select: { followerId: true },
    }),
  ]);
  return Boolean(aFollowsB) && Boolean(bFollowsA);
}

export async function hasAcceptedMessageRequest(
  prisma: FollowAndRequestClient,
  userAId: string,
  userBId: string,
): Promise<boolean> {
  const row = await prisma.messageRequest.findFirst({
    where: {
      status: 'ACCEPTED',
      OR: [
        { senderId: userAId, receiverId: userBId },
        { senderId: userBId, receiverId: userAId },
      ],
    },
    select: { id: true },
  });
  return Boolean(row);
}

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Finds the existing direct conversation between two users, or creates it.
 * Relies on the unique `participantKey` constraint to stay race-safe when
 * two creation attempts land concurrently (e.g. both users open the thread
 * at once) — the loser of the race just re-reads what the winner created.
 */
export async function findOrCreateConversation(
  tx: Prisma.TransactionClient,
  userAId: string,
  userBId: string,
) {
  const participantKey = buildParticipantKey(userAId, userBId);
  const existing = await tx.conversation.findUnique({ where: { participantKey } });
  if (existing) return existing;

  const [userOneId, userTwoId] = sortParticipants(userAId, userBId);
  try {
    return await tx.conversation.create({ data: { participantKey, userOneId, userTwoId } });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const created = await tx.conversation.findUnique({ where: { participantKey } });
      if (created) return created;
    }
    throw error;
  }
}

export const PUBLIC_USER_SELECT = {
  id: true,
  username: true,
  avatarUrl: true,
  bio: true,
  plan: true,
} as const;
