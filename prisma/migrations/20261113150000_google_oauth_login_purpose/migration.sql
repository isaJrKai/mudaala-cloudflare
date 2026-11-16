-- Extend the one-use Google OAuth state table to distinguish explicit
-- account linking from sign-in to an already-linked Mudaala account.
-- LOGIN state is anonymous; LINK state remains bound to an authenticated user.
ALTER TABLE "GoogleOAuthState"
  ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "GoogleOAuthState"
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'LINK';

CREATE INDEX "GoogleOAuthState_purpose_expiresAt_idx"
  ON "GoogleOAuthState"("purpose", "expiresAt");
