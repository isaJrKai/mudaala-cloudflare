-- Private feedback inbox for bug reports, performance issues, complaints and ideas.
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "pagePath" TEXT,
    "userAgent" TEXT,
    "contact" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Feedback_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Feedback_status_createdAt_idx" ON "Feedback"("status", "createdAt");
CREATE INDEX "Feedback_category_createdAt_idx" ON "Feedback"("category", "createdAt");
CREATE INDEX "Feedback_reporterId_createdAt_idx" ON "Feedback"("reporterId", "createdAt");
