CREATE TABLE "AppealCase" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "targetReference" TEXT,
  "title" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  "assignedAdminId" TEXT,
  "decision" TEXT,
  "decisionReason" TEXT,
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppealCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppealCase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AppealCase_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

ALTER TABLE "AppealCase" ADD COLUMN "accessTokenHash" TEXT;
CREATE UNIQUE INDEX "AppealCase_accessTokenHash_key" ON "AppealCase"("accessTokenHash");

CREATE TABLE "AppealCaseMessage" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "senderRole" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "evidenceUrls" TEXT NOT NULL DEFAULT '[]',
  "internal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppealCaseMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppealCaseMessage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AppealCase"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AppealCaseMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AppealCaseEvent" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "actorId" TEXT,
  "eventType" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppealCaseEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppealCaseEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AppealCase"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AppealCaseEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "AppealCase_ownerId_createdAt_idx" ON "AppealCase"("ownerId", "createdAt");
CREATE INDEX "AppealCase_status_priority_updatedAt_idx" ON "AppealCase"("status", "priority", "updatedAt");
CREATE INDEX "AppealCase_assignedAdminId_status_updatedAt_idx" ON "AppealCase"("assignedAdminId", "status", "updatedAt");
CREATE INDEX "AppealCase_targetType_targetId_createdAt_idx" ON "AppealCase"("targetType", "targetId", "createdAt");
CREATE INDEX "AppealCaseMessage_caseId_createdAt_idx" ON "AppealCaseMessage"("caseId", "createdAt");
CREATE INDEX "AppealCaseMessage_senderId_createdAt_idx" ON "AppealCaseMessage"("senderId", "createdAt");
CREATE INDEX "AppealCaseEvent_caseId_createdAt_idx" ON "AppealCaseEvent"("caseId", "createdAt");
CREATE INDEX "AppealCaseEvent_actorId_createdAt_idx" ON "AppealCaseEvent"("actorId", "createdAt");

-- New public-schema tables must follow Mudaala's restricted runtime model.
-- Browser Data API roles are denied; only the trusted Worker role can access them.
ALTER TABLE "AppealCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppealCaseMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppealCaseEvent" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "AppealCase" TO mudaala_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "AppealCaseMessage" TO mudaala_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "AppealCaseEvent" TO mudaala_runtime;

CREATE POLICY mudaala_runtime_access ON "AppealCase" FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);
CREATE POLICY mudaala_runtime_access ON "AppealCaseMessage" FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);
CREATE POLICY mudaala_runtime_access ON "AppealCaseEvent" FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);

CREATE POLICY deny_direct_api_clients ON "AppealCase" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_direct_api_clients ON "AppealCaseMessage" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_direct_api_clients ON "AppealCaseEvent" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- Migrate valid legacy appeals without losing their original submission or decision.
INSERT INTO "AppealCase" (
  "id", "ownerId", "targetType", "targetId", "targetReference", "title", "statement",
  "status", "priority", "decision", "decisionReason", "decidedAt", "createdAt", "updatedAt"
)
SELECT
  'ac_' || f."id",
  COALESCE(
    f."reporterId",
    CASE f."appealTargetType"
      WHEN 'USER' THEN f."appealTargetId"
      WHEN 'SHOP' THEN (SELECT bp."userId" FROM "BusinessProfile" bp WHERE bp."id" = f."appealTargetId")
      WHEN 'LISTING' THEN (SELECT l."userId" FROM "Listing" l WHERE l."id" = f."appealTargetId")
    END
  ),
  f."appealTargetType",
  f."appealTargetId",
  f."appealTargetRef",
  f."title",
  f."description",
  CASE WHEN f."appealDecision" IS NOT NULL THEN 'DECIDED'
       WHEN f."status" = 'CLOSED' THEN 'CLOSED'
       WHEN f."status" = 'IN_PROGRESS' THEN 'IN_REVIEW'
       ELSE 'OPEN' END,
  f."priority",
  f."appealDecision",
  f."appealDecisionReason",
  CASE WHEN f."appealDecision" IS NOT NULL THEN f."updatedAt" ELSE NULL END,
  f."createdAt",
  f."updatedAt"
FROM "Feedback" f
WHERE f."category" = 'APPEAL'
  AND f."appealTargetType" IN ('USER', 'SHOP', 'LISTING')
  AND f."appealTargetId" IS NOT NULL
  AND COALESCE(
    f."reporterId",
    CASE f."appealTargetType"
      WHEN 'USER' THEN f."appealTargetId"
      WHEN 'SHOP' THEN (SELECT bp."userId" FROM "BusinessProfile" bp WHERE bp."id" = f."appealTargetId")
      WHEN 'LISTING' THEN (SELECT l."userId" FROM "Listing" l WHERE l."id" = f."appealTargetId")
    END
  ) IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "AppealCaseEvent" ("id", "caseId", "actorId", "eventType", "details", "createdAt")
SELECT
  'ace_' || "id",
  "id",
  NULL,
  'CREATED',
  jsonb_build_object('source', 'legacy_feedback_migration'),
  "createdAt"
FROM "AppealCase"
WHERE "id" LIKE 'ac_%'
ON CONFLICT ("id") DO NOTHING;

-- Keep at most one active appeal per owner and moderation target, including
-- concurrent submissions. Preserve older duplicate case histories as closed.
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "ownerId", "targetType", "targetId" ORDER BY "createdAt" ASC, "id" ASC) AS position
  FROM "AppealCase"
  WHERE "status" IN ('OPEN', 'IN_REVIEW', 'WAITING_ON_OWNER')
),
closed AS (
  UPDATE "AppealCase" AS c
  SET "status" = 'CLOSED', "updatedAt" = CURRENT_TIMESTAMP
  FROM ranked r
  WHERE c."id" = r."id" AND r.position > 1
  RETURNING c."id", c."createdAt"
)
INSERT INTO "AppealCaseEvent" ("id", "caseId", "actorId", "eventType", "details", "createdAt")
SELECT 'ace_dedup_' || "id", "id", NULL, 'STATUS_CHANGED',
       jsonb_build_object('status', 'CLOSED', 'reason', 'duplicate_legacy_case'),
       CURRENT_TIMESTAMP
FROM closed
ON CONFLICT ("id") DO NOTHING;

CREATE UNIQUE INDEX "AppealCase_one_active_target_key"
  ON "AppealCase"("ownerId", "targetType", "targetId")
  WHERE "status" IN ('OPEN', 'IN_REVIEW', 'WAITING_ON_OWNER');

-- Successfully migrated feedback rows remain as immutable legacy records and
-- are hidden from the general inbox. Unmatched appeals stay visible for review.
UPDATE "Feedback" f SET "category" = 'LEGACY_APPEAL' WHERE f."category" = 'APPEAL' AND EXISTS (SELECT 1 FROM "AppealCase" c WHERE c."id" = 'ac_' || f."id");
