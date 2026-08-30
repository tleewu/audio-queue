-- Episode artwork. The text-only refactor dropped "thumbnailURL"; the queue
-- reads as barren without it, so artwork returns under a clearer name.
ALTER TABLE "QueueItem" ADD COLUMN "imageURL" TEXT;
