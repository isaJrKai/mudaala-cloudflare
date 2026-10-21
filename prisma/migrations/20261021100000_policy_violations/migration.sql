-- Only moderator-confirmed policy violations count toward repeat-offender warnings.
CREATE TABLE "PolicyViolation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "activeKey" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "policyCategory" TEXT NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedBy" TEXT,
    "warningSentAt" TIMESTAMP(3),
    CONSTRAINT "PolicyViolation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PolicyViolation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PolicyViolation_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PolicyViolation_reportId_key" ON "PolicyViolation"("reportId");
CREATE UNIQUE INDEX "PolicyViolation_activeKey_key" ON "PolicyViolation"("activeKey");
CREATE INDEX "PolicyViolation_userId_reversedAt_createdAt_idx" ON "PolicyViolation"("userId", "reversedAt", "createdAt");
CREATE INDEX "PolicyViolation_targetType_targetId_idx" ON "PolicyViolation"("targetType", "targetId");

-- These new tables are private. Direct Supabase Data API roles are denied,
-- while the Worker uses the restricted runtime role with API-layer auth.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mudaala_runtime') THEN
    RAISE EXCEPTION 'mudaala_runtime role must exist before private feedback and policy RLS is applied';
  END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."Feedback" TO mudaala_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."PolicyViolation" TO mudaala_runtime;
ALTER TABLE public."Feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PolicyViolation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_direct_api_clients ON public."Feedback" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_direct_api_clients ON public."PolicyViolation" FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY mudaala_runtime_access ON public."Feedback" FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);
CREATE POLICY mudaala_runtime_access ON public."PolicyViolation" FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);
