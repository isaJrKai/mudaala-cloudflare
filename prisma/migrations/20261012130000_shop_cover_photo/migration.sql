-- Separate the public shop avatar from its optional wide cover image.
-- Existing photoUrl values remain untouched and continue to serve as a fallback cover.
ALTER TABLE "BusinessProfile" ADD COLUMN "coverPhotoUrl" TEXT;
