-- SQLite equivalent for local/test schema evolution.
ALTER TABLE "ProductCollection" ADD COLUMN "startsAt" DATETIME;
ALTER TABLE "ProductCollection" ADD COLUMN "endsAt" DATETIME;
