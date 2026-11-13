-- Record how a session was authenticated so a recent Google login cannot
-- satisfy the fresh-password reauthentication required for account linking
-- or unlinking. Existing sessions are treated as password-created sessions.
ALTER TABLE "Session"
  ADD COLUMN "authMethod" TEXT NOT NULL DEFAULT 'PASSWORD';
