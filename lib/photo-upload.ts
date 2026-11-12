// Browser-only helpers for /sell photo uploads. Imported by client components only;
// nothing here runs at module load, so it is safe to keep outside a "use client" file.
import { MAX_SOURCE_FILE_BYTES, PHOTO_BUCKET, PHOTO_MAX_EDGE, PHOTO_QUALITY } from "@/lib/sell";

export class PhotoError extends Error {}

export interface ResizedPhoto {
  blob: Blob;
  ext: "webp" | "jpg";
  contentType: "image/webp" | "image/jpeg";
}

/** Rejects files we can't use before doing any work. Returns an error message or null. */
export function precheckFile(file: File): string | null {
  if (!file.type.startsWith("image/")) return `${file.name} isn't a photo. Add JPEG, PNG, WebP or HEIC images.`;
  if (file.size > MAX_SOURCE_FILE_BYTES) return `${file.name} is larger than 25 MB. Export a smaller copy and try again.`;
  return null;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Scales the longest edge down to 2560 px and encodes WebP (JPEG where the browser can't encode WebP). */
export async function resizePhoto(file: File): Promise<ResizedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoError("We couldn't read this photo. Save it as a JPEG and try again.");
  }
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PhotoError("Your browser couldn't process this photo. Try another browser.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const webp = await toBlob(canvas, "image/webp", PHOTO_QUALITY);
  if (webp && webp.type === "image/webp") return { blob: webp, ext: "webp", contentType: "image/webp" };
  // Some Safari versions silently return PNG for WebP; fall back to JPEG.
  const jpeg = await toBlob(canvas, "image/jpeg", PHOTO_QUALITY);
  if (jpeg) return { blob: jpeg, ext: "jpg", contentType: "image/jpeg" };
  throw new PhotoError("Your browser couldn't process this photo. Try another browser.");
}

/**
 * Uploads to Supabase Storage with XMLHttpRequest so we can report progress
 * (supabase-js upload() has no progress events). Uses the user's own access token.
 */
export function uploadToStorage(opts: {
  path: string;
  photo: ResizedPhoto;
  accessToken: string;
  onProgress: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/+$/, "");
  const url = `${base}/storage/v1/object/${PHOTO_BUCKET}/${opts.path.split("/").map(encodeURIComponent).join("/")}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${opts.accessToken}`);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    xhr.setRequestHeader("Content-Type", opts.photo.contentType);
    xhr.setRequestHeader("cache-control", "max-age=31536000");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else if (xhr.status === 413) reject(new PhotoError("This photo is still too large after resizing."));
      else if (xhr.status === 401 || xhr.status === 403) reject(new PhotoError("Your session has expired. Reload the page."));
      else reject(new PhotoError("Upload failed. Check your connection and retry."));
    };
    xhr.onerror = () => reject(new PhotoError("Upload failed. Check your connection and retry."));
    xhr.onabort = () => reject(new PhotoError("Upload cancelled."));
    opts.signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(opts.photo.blob);
  });
}

export function randomId(): string {
  return crypto.randomUUID();
}
