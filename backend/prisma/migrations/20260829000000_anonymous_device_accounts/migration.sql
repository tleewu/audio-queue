-- Anonymous device accounts: a user is created from a device-generated id and
-- only gains an appleUserId if they sign in to sync.
ALTER TABLE "User" ADD COLUMN "deviceId" TEXT;
ALTER TABLE "User" ALTER COLUMN "appleUserId" DROP NOT NULL;
CREATE UNIQUE INDEX "User_deviceId_key" ON "User"("deviceId");
