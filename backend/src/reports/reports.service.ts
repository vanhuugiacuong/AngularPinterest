import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReportReason } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

const VALID_REASONS: ReportReason[] = [
  'SPAM',
  'HARASSMENT',
  'HATE_SPEECH',
  'IMPERSONATION',
  'INAPPROPRIATE_CONTENT',
  'OTHER',
];

const MAX_DETAILS_LENGTH = 500;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async reportUser(reporterId: string, reportedId: string, reason: string, details?: string) {
    if (reporterId === reportedId) {
      throw new BadRequestException('Bạn không thể tự báo cáo chính mình');
    }
    const target = await this.prisma.user.findUnique({
      where: { id: reportedId },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException('Người dùng cần báo cáo không tồn tại');
    }

    return this.prisma.userReport.create({
      data: {
        reporterId,
        reportedId,
        reason: this.validateReason(reason),
        details: this.normalizeDetails(details),
      },
    });
  }

  /** Used inside MessageRequestsService's accept/reject/report transaction. */
  async createMessageRequestReport(
    tx: Prisma.TransactionClient,
    params: {
      reporterId: string;
      reportedId: string;
      reason: string;
      details?: string;
      messageRequestId: string;
    },
  ) {
    return tx.userReport.create({
      data: {
        reporterId: params.reporterId,
        reportedId: params.reportedId,
        reason: this.validateReason(params.reason),
        details: this.normalizeDetails(params.details),
        messageRequestId: params.messageRequestId,
      },
    });
  }

  validateReason(reason: string): ReportReason {
    const normalized = (reason || '').trim().toUpperCase() as ReportReason;
    if (!VALID_REASONS.includes(normalized)) {
      throw new BadRequestException('Lý do báo cáo không hợp lệ');
    }
    return normalized;
  }

  private normalizeDetails(details?: string): string | null {
    const trimmed = (details || '').trim();
    if (!trimmed) return null;
    return trimmed.slice(0, MAX_DETAILS_LENGTH);
  }
}
