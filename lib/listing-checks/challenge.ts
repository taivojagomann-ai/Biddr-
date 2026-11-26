// The live challenge (DECISIONS.md point 16): a 6-character code the seller writes on a
// paper and photographs with the VIN plate and the odometer, using the in-app camera.

/** No 0/O, 1/I/L or other look-alikes. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
export const CHALLENGE_MINUTES = 15;
/** New codes per listing per day (a code is free; this only stops abuse). */
export const CODES_PER_DAY = 10;

export type ChallengeShot = "vin" | "odometer";

export const SHOTS: Record<ChallengeShot, { title: string; hint: string; guide: string }> = {
  vin: {
    title: "Photo 1: VIN plate with the code",
    hint: "The VIN plate (usually at the bottom of the windscreen or in the driver's door frame), with the paper showing the code next to it. Both must be sharp and readable.",
    guide: "Fit the VIN plate and the paper inside the frame",
  },
  odometer: {
    title: "Photo 2: dashboard with the code",
    hint: "The dashboard with the ignition on, showing the total mileage, and the same paper next to it.",
    guide: "Fit the dashboard mileage and the paper inside the frame",
  },
};

/** Why the two photos can't be uploaded from the gallery. */
export const NO_UPLOAD_NOTE =
  "These two photos must be taken now, with the camera, at the car. Uploading photos from your gallery isn't possible here: the code proves the photos are new and that you have the car.";

/** Where challenge photos and documents live in the private bucket. */
export function verificationFolder(sellerId: string, auctionId: string): string {
  return `${sellerId}/${auctionId}`;
}

export const CHALLENGE_PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/challenge-(vin|odometer)-[0-9a-f-]{36}\.jpg$/;
export const DOCUMENT_PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(registration|authorisation)-[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/;
