import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    userReport: { create: jest.fn() },
  };
  let service: ReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReportsService(prisma as never);
  });

  it('rejects reporting yourself', async () => {
    await expect(service.reportUser('user-1', 'user-1', 'SPAM')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404s when the reported user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.reportUser('user-1', 'ghost', 'SPAM')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects an invalid reason', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
    await expect(
      service.reportUser('user-1', 'user-2', 'NOT_A_REAL_REASON'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a report with a normalized reason and trimmed details', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
    prisma.userReport.create.mockResolvedValue({ id: 'report-1' });

    await service.reportUser('user-1', 'user-2', 'spam', '  looks like spam  ');

    expect(prisma.userReport.create).toHaveBeenCalledWith({
      data: {
        reporterId: 'user-1',
        reportedId: 'user-2',
        reason: 'SPAM',
        details: 'looks like spam',
      },
    });
  });
});
