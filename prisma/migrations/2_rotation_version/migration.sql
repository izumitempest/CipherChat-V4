-- The rotation version column.
--
-- The server hands out sequential rotation versions so clients no
-- longer self-assign (epoch * SPAN + random offset). This eliminates
-- the 1-in-4-billion collision risk when two members rotate at once.
-- The column is nullable: rooms created before this change have no
-- rotation version, and clients keep self-assigning until they fetch
-- one from the server.

-- AlterTable
ALTER TABLE "Room" ADD COLUMN "rotationVersion" INTEGER NOT NULL DEFAULT 0;
