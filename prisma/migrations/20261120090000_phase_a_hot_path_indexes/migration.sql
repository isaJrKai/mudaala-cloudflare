-- Phase A hot-path indexes (Commerce Spine remediation).

-- 1. Opportunistic expired-session cleanup runs on every sign-in
--    (src/lib/auth.ts createSession); without this index the deleteMany
--    is a full-table scan of every session ever created.
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- 2. The publish-time saved-search sweep (notifySavedSearchMatches) serves
--    the stalest-checked searches first within a bounded window; this index
--    lets that ordering stop early instead of sorting the whole table.
CREATE INDEX "SavedSearch_lastCheckedAt_idx" ON "SavedSearch"("lastCheckedAt");
