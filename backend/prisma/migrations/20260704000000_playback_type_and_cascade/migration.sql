-- Add playbackType (direct | proxy | external)
ALTER TABLE "QueueItem" ADD COLUMN "playbackType" TEXT NOT NULL DEFAULT 'direct';

-- Existing rows: youtube/unsupported items without audio open externally
UPDATE "QueueItem" SET "playbackType" = 'external' WHERE "audioURL" IS NULL;

-- Deleting a user now deletes their queue (required for account deletion)
ALTER TABLE "QueueItem" DROP CONSTRAINT "QueueItem_userId_fkey";
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "QueueItem_userId_position_idx" ON "QueueItem"("userId", "position");
