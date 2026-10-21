-- Only moderator-confirmed policy violations count toward repeat-offender warnings.
CREATE TABLE "PolicyViolation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "activeKey" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "policyCategory" TEXT NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" DATETIME,
    "reversedBy" TEXT,
    "warningSentAt" DATETIME,
    CONSTRAINT "PolicyViolation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PolicyViolation_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PolicyViolation_reportId_key" ON "PolicyViolation"("reportId");
CREATE UNIQUE INDEX "PolicyViolation_activeKey_key" ON "PolicyViolation"("activeKey");
CREATE INDEX "PolicyViolation_userId_reversedAt_createdAt_idx" ON "PolicyViolation"("userId", "reversedAt", "createdAt");
CREATE INDEX "PolicyViolation_targetType_targetId_idx" ON "PolicyViolation"("targetType", "targetId");
