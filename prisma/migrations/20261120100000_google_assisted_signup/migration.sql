-- Persist only the hash of the short-lived browser-bound signup capability.
-- Google identity claims are retained temporarily until the user completes the
-- existing phone/password/terms registration requirements.
ALTER TABLE "GoogleOAuthState"
  ADD COLUMN "signupTokenHash" TEXT,
  ADD COLUMN "providerSub" TEXT,
  ADD COLUMN "googleEmail" TEXT,
  ADD COLUMN "googleEmailVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "signupCompletedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "GoogleOAuthState_signupTokenHash_key"
  ON "GoogleOAuthState"("signupTokenHash");
