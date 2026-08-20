ALTER TABLE "User" ADD COLUMN "ownedPlans" "MembershipPlan"[] NOT NULL DEFAULT ARRAY['FREE']::"MembershipPlan"[];
UPDATE "User" SET "ownedPlans" = ARRAY['FREE'::"MembershipPlan", "plan"] WHERE "plan" IN ('PLUS', 'PRO');
