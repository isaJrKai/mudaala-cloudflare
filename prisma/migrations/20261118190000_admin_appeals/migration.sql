ALTER TABLE "Feedback"
  ADD COLUMN "appealTargetType" TEXT,
  ADD COLUMN "appealTargetRef" TEXT,
  ADD COLUMN "appealTargetId" TEXT,
  ADD COLUMN "appealDecision" TEXT,
  ADD COLUMN "appealDecisionReason" TEXT;

CREATE INDEX "Feedback_appealTargetType_appealTargetId_createdAt_idx"
  ON "Feedback"("appealTargetType", "appealTargetId", "createdAt");
