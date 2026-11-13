-- Additive foundation for explicit Google account linking.
-- No existing User rows or login requirements are changed by this migration.
-- Google email is never used as an account-linking key.

CREATE TABLE "GoogleIdentity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'google',
  "providerSub" TEXT NOT NULL,
  "email" TEXT,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleIdentity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoogleIdentity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GoogleIdentity_provider_providerSub_key"
  ON "GoogleIdentity"("provider", "providerSub");
CREATE UNIQUE INDEX "GoogleIdentity_userId_provider_key"
  ON "GoogleIdentity"("userId", "provider");
CREATE INDEX "GoogleIdentity_userId_createdAt_idx"
  ON "GoogleIdentity"("userId", "createdAt");

CREATE TABLE "GoogleOAuthState" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoogleOAuthState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoogleOAuthState_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GoogleOAuthState_stateHash_key"
  ON "GoogleOAuthState"("stateHash");
CREATE INDEX "GoogleOAuthState_userId_expiresAt_idx"
  ON "GoogleOAuthState"("userId", "expiresAt");
CREATE INDEX "GoogleOAuthState_expiresAt_idx"
  ON "GoogleOAuthState"("expiresAt");

-- Deny direct Supabase Data API access. The Worker runtime role receives
-- table access; application authorization remains enforced in server routes.
ALTER TABLE public."GoogleIdentity" ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_direct_api_clients ON public."GoogleIdentity"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."GoogleIdentity" TO mudaala_runtime;
CREATE POLICY mudaala_runtime_access ON public."GoogleIdentity"
  FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);

ALTER TABLE public."GoogleOAuthState" ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_direct_api_clients ON public."GoogleOAuthState"
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."GoogleOAuthState" TO mudaala_runtime;
CREATE POLICY mudaala_runtime_access ON public."GoogleOAuthState"
  FOR ALL TO mudaala_runtime USING (true) WITH CHECK (true);
