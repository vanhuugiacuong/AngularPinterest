import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const prisma = {
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationsService(prisma as never);
  });

  describe('createNotification', () => {
    it("selects and returns the sender's membership plan, never their email", async () => {
      prisma.notification.create.mockResolvedValue({
        id: 'notif-1',
        type: 'LIKE',
        sender: { id: 'sender-1', username: 'fan', avatarUrl: null, plan: 'PRO' },
        pin: { id: 'pin-1', title: 'Frame', imageUrl: 'https://cdn.example.com/pin-1.jpg' },
      });

      const result = await service.createNotification('owner-1', 'LIKE', 'Ai đó đã thích ảnh của bạn', 'sender-1', 'pin-1');

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            sender: { select: expect.objectContaining({ plan: true }) },
          }),
        }),
      );
      expect(result.sender.plan).toBe('PRO');
      expect(result.sender).not.toHaveProperty('email');
    });
  });

  describe('getNotifications', () => {
    it("selects and returns each notification's sender membership plan", async () => {
      prisma.notification.findMany.mockResolvedValue([
        {
          id: 'notif-1',
          type: 'COMMENT',
          sender: { id: 'sender-1', username: 'fan', avatarUrl: null, plan: 'PLUS' },
          pin: { id: 'pin-1', title: 'Frame', imageUrl: 'https://cdn.example.com/pin-1.jpg' },
        },
      ]);
      prisma.notification.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      const result = await service.getNotifications('owner-1');

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            sender: { select: expect.objectContaining({ plan: true }) },
          }),
        }),
      );
      expect(result.notifications[0].sender.plan).toBe('PLUS');
    });
  });
});
