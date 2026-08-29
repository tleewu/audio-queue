-- Podcast-or-web-view model: an item either has audioURL (plays) or does not
-- (opens in a web view). Source/playback classification, artwork and the
-- async-resolution bookkeeping are no longer used by the app.
ALTER TABLE "QueueItem" DROP COLUMN "sourceType";
ALTER TABLE "QueueItem" DROP COLUMN "playbackType";
ALTER TABLE "QueueItem" DROP COLUMN "thumbnailURL";
ALTER TABLE "QueueItem" DROP COLUMN "resolveStatus";
ALTER TABLE "QueueItem" DROP COLUMN "resolveError";
