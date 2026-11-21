ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE TABLE "EmailAuthChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "targetEmail" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailAuthChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailAuthChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EmailAuthChallenge_userId_purpose_consumedAt_expiresAt_idx"
  ON "EmailAuthChallenge"("userId", "purpose", "consumedAt", "expiresAt");
CREATE INDEX "EmailAuthChallenge_expiresAt_idx" ON "EmailAuthChallenge"("expiresAt");
