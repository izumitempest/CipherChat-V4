-- The baseline schema.
--
-- The tables as they were before the join proof. Every statement is
-- written with IF NOT EXISTS on purpose: a database created by the
-- old `prisma db push` flow already has these tables, and this
-- migration has to be able to run against it without wiping it. The
-- next migration adds the column that flow had not yet pushed.
--
-- The creator token column holds a hash now; the column itself did
-- not change shape, so there is nothing to migrate here.

-- CreateTable
CREATE TABLE IF NOT EXISTS "Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "verifier" TEXT,
    "creatorToken" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL DEFAULT 1,
    "burned" BOOLEAN NOT NULL DEFAULT false,
    "burnedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Member" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "ecdhPub" TEXT,
    "alias" TEXT NOT NULL,
    "colorIdx" INTEGER NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Member_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Member_roomId_idx" ON "Member"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Member_roomId_pubkey_key" ON "Member"("roomId", "pubkey");
