ALTER TABLE "User" ADD COLUMN "planExpiresAt" TIMESTAMP(3), ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED');

CREATE TABLE "MembershipPayment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "plan" "MembershipPlan" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "paymentReference" TEXT NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "provider" TEXT NOT NULL,
  "providerTransactionId" TEXT,
  "rawPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt" TIMESTAMP(3),
  "verifiedBy" TEXT,
  CONSTRAINT "MembershipPayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MembershipPayment_paymentReference_key" ON "MembershipPayment"("paymentReference");
CREATE UNIQUE INDEX "MembershipPayment_providerTransactionId_key" ON "MembershipPayment"("providerTransactionId");
CREATE INDEX "MembershipPayment_userId_status_idx" ON "MembershipPayment"("userId", "status");
ALTER TABLE "MembershipPayment" ADD CONSTRAINT "MembershipPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MembershipSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "plan" "MembershipPlan" NOT NULL,
  "paymentId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MembershipSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MembershipSubscription_paymentId_key" ON "MembershipSubscription"("paymentId");
CREATE INDEX "MembershipSubscription_userId_expiresAt_idx" ON "MembershipSubscription"("userId", "expiresAt");
ALTER TABLE "MembershipSubscription" ADD CONSTRAINT "MembershipSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipSubscription" ADD CONSTRAINT "MembershipSubscription_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "MembershipPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
