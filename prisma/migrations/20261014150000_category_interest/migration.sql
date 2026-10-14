CREATE TABLE "CategoryInterest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "score" INTEGER NOT NULL DEFAULT 0,
  "lastSelectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CategoryInterest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CategoryInterest_userId_category_key" ON "CategoryInterest"("userId", "category");
CREATE INDEX "CategoryInterest_userId_score_idx" ON "CategoryInterest"("userId", "score");
ALTER TABLE "CategoryInterest" ADD CONSTRAINT "CategoryInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
