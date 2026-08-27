-- Preserve the monetary value of existing wallet data while changing the
-- wallet's accounting unit from 1 NovaToken = 1,000 VND to direct VND.
UPDATE "User" SET "novaTokenBalance" = "novaTokenBalance" * 1000;

UPDATE "NovaTokenLedger"
SET "amount" = "amount" * 1000,
    "balanceAfter" = "balanceAfter" * 1000;

UPDATE "AuctionTokenHold" SET "amount" = "amount" * 1000;

UPDATE "NovaTokenTopUp" SET "tokenAmount" = "vndAmount";

UPDATE "ImagePurchase"
SET "amount" = "amount" * 1000,
    "currency" = 'VND'
WHERE "currency" = 'NOVA_TOKEN';
