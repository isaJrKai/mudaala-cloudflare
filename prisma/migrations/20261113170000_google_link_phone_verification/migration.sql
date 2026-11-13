-- Separate, short-lived SMS proof for sensitive Google account linking.
-- Codes are HMAC-hashed by the application and are never stored in plaintext.
CREATE TABLE "PhoneVerificationChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "verifiedAt" TIMESTAMP(3),
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PhoneVerificationChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PhoneVerificationChallenge_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PhoneVerificationChallenge_userId_createdAt_idx"
  ON "PhoneVerificationChallenge"("userId", "createdAt");
CREATE INDEX "PhoneVerificationChallenge_userId_verifiedAt_idx"
  ON "PhoneVerificationChallenge"("userId", "verifiedAt");
CREATE INDEX "PhoneVerificationChallenge_expiresAt_idx"
  ON "PhoneVerificationChallenge"("expiresAt");

ALTER TABLE public."PhoneVerificationChallenge" ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_direct_api_clients ON public."PhoneVerificationChallenge"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."PhoneVerificationChallenge" TO mudaala_runtime;
CREATE POLICY mudaala_runtime_access ON public."PhoneVerificationChallenge"
  FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);
