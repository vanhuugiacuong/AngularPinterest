CREATE TABLE "DemoWithdrawal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(18,0) NOT NULL,
    "bankCode" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DEMO_COMPLETED',
    "note" TEXT NOT NULL DEFAULT 'Mô phỏng thử nghiệm - không chuyển tiền thật',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DemoWithdrawal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DemoWithdrawal_userId_createdAt_idx" ON "DemoWithdrawal"("userId", "createdAt");

ALTER TABLE "DemoWithdrawal" ADD CONSTRAINT "DemoWithdrawal_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
