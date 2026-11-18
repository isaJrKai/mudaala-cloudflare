CREATE TABLE "AppealPhoneVerificationChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "phoneHash" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppealPhoneVerificationChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppealPhoneVerificationChallenge_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AppealPhoneVerificationChallenge_userId_createdAt_idx"
  ON "AppealPhoneVerificationChallenge"("userId", "createdAt");
CREATE INDEX "AppealPhoneVerificationChallenge_expiresAt_idx"
  ON "AppealPhoneVerificationChallenge"("expiresAt");

ALTER TABLE "AppealPhoneVerificationChallenge" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "AppealPhoneVerificationChallenge" TO mudaala_runtime;
CREATE POLICY mudaala_runtime_access ON "AppealPhoneVerificationChallenge"
  FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);
CREATE POLICY deny_direct_api_clients ON "AppealPhoneVerificationChallenge"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
