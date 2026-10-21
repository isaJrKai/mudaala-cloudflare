-- Add optional collection schedule windows without rewriting the already-applied foundation migration.
ALTER TABLE "ProductCollection" ADD COLUMN "startsAt" TIMESTAMP(3);
ALTER TABLE "ProductCollection" ADD COLUMN "endsAt" TIMESTAMP(3);
ALTER TABLE "ProductCollection" ADD CONSTRAINT "ProductCollection_schedule_window_check" CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt");
