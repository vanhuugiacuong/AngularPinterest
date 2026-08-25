-- Thanh toán trực tiếp cho người bán: lưu tài khoản nhận tiền của người bán
-- (bắt buộc trước khi được bán ảnh/tạo đấu giá, kiểm tra ở tầng service).

ALTER TABLE "User" ADD COLUMN "payoutBankCode" TEXT, ADD COLUMN "payoutAccountNumber" TEXT, ADD COLUMN "payoutAccountName" TEXT;
