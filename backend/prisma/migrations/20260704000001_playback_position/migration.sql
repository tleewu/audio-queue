-- Resume point in seconds, synced across devices
ALTER TABLE "QueueItem" ADD COLUMN "playbackPositionSeconds" INTEGER NOT NULL DEFAULT 0;
