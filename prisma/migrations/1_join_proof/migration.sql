-- The join verifier column.
--
-- The server keeps an HMAC over the key derivation output, bound to
-- the room, so it can tell a password holder from somebody holding
-- only the link. It is never published. The column is nullable: a
-- room sealed before this change has no verifier, and the server
-- cannot invent one.

-- AlterTable
ALTER TABLE "Room" ADD COLUMN "joinProof" TEXT;
