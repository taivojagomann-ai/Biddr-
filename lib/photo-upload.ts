// Browser-only helpers for /sell photo uploads. Imported by client components only;
// nothing here runs at module load, so it is safe to keep outside a "use client" file.
import { isHeicFile, isPhotoFile, PHOTO_FORMATS_TEXT } from "@/lib/file-types";
import { MAX_SOURCE_FILE_BYTES, PHOTO_BUCKET, PHOTO_MAX_EDGE, PHOTO_QUALITY } from "@/lib/sell";

export class PhotoError extends Error {}

export interface ResizedPhoto {
  blob: Blob;
  ext: "webp" | "jpg";
  contentType: "image/webp" | "image/jpeg";
}

/** Rejects files we can't use before doing any work. Returns an error message or null. */
export function precheckFile(file: File): string | null {
  if (!isPhotoFile(file)) return `${file.name} isn't a photo. Add ${PHOTO_FORMATS_TEXT} images.`;
  if (file.size > MAX_SOURCE_FILE_BYTES) return `${file.name} is larger than 25 MB. Export a smaller copy and try again.`;
  return null;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

const UNREADABLE = "We couldn't read this photo. Save it as a JPEG and try again.";

/** Is this an HEIC photo (by its type, its name, or its first bytes)? The converter loads only when needed. */
async function looksLikeHeic(file: File): Promise<boolean> {
  if (isHeicFile(file)) return true;
  try {
    const head = new Uint8Array(await file.slice(4, 12).arrayBuffer());
    const brand = String.fromCharCode(...head);
    return /^ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand);
  } catch {
    return false;
  }
}

/**
 * Reads a photo. Browsers read JPEG, PNG and WebP; Safari also reads HEIC. Elsewhere
 * (Chrome, Edge, Firefox, Android) HEIC goes through heic-to (libheif), loaded on demand.
 */
export async function decodePhoto(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    if (!(await looksLikeHeic(file))) throw new PhotoError(UNREADABLE);
  }
  try {
    const { heicTo } = await import("heic-to");
    return await heicTo({ blob: file, type: "bitmap", options: { imageOrientation: "from-image" } });
  } catch {
    throw new PhotoError(UNREADABLE);
  }
}

/**
 * A file ready for an upload that keeps the original (reports): PDF, JPEG, PNG and WebP
 * as they are; HEIC (or a photo of another type) as a JPEG.
 */
export async function uploadableFile(file: File): Promise<{ blob: Blob; contentType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp" }> {
  if (file.type === "application/pdf" || (!file.type && /\.pdf$/i.test(file.name))) return { blob: file, contentType: "application/pdf" };
  if (file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp") return { blob: file, contentType: file.type };
  const bitmap = await decodePhoto(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PhotoError("Your browser couldn't process this photo. Try another browser.");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const jpeg = await toBlob(canvas, "image/jpeg", PHOTO_QUALITY);
  if (!jpeg) throw new PhotoError("Your browser couldn't process this photo. Try another browser.");
  return { blob: jpeg, contentType: "image/jpeg" };
}

/** Scales the longest edge down to 2560 px and encodes WebP (JPEG where the browser can't encode WebP). */
export async function resizePhoto(file: File): Promise<ResizedPhoto> {
  const bitmap = await decodePhoto(file);
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
  return uploadBlob({
    bucket: PHOTO_BUCKET,
    path: opts.path,
    blob: opts.photo.blob,
    contentType: opts.photo.contentType,
    accessToken: opts.accessToken,
    onProgress: opts.onProgress,
    signal: opts.signal,
    tooLarge: "This photo is still too large after resizing.",
  });
}

/** Same as uploadToStorage, for any file and bucket (e.g. dealer inspection reports). */
export function uploadBlob(opts: {
  bucket: string;
  path: string;
  blob: Blob;
  contentType: string;
  accessToken: string;
  onProgress: (fraction: number) => void;
  signal?: AbortSignal;
  /** Message when Storage refuses the size. */
  tooLarge?: string;
}): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/+$/, "");
  const url = `${base}/storage/v1/object/${opts.bucket}/${opts.path.split("/").map(encodeURIComponent).join("/")}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${opts.accessToken}`);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    xhr.setRequestHeader("Content-Type", opts.contentType);
    xhr.setRequestHeader("cache-control", "max-age=31536000");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else if (xhr.status === 413) reject(new PhotoError(opts.tooLarge ?? "This file is too large."));
      else if (xhr.status === 401 || xhr.status === 403) reject(new PhotoError("Your session has expired. Reload the page."));
      else reject(new PhotoError("Upload failed. Check your connection and retry."));
    };
    xhr.onerror = () => reject(new PhotoError("Upload failed. Check your connection and retry."));
    xhr.onabort = () => reject(new PhotoError("Upload cancelled."));
    opts.signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(opts.blob);
  });
}

export function randomId(): string {
  return crypto.randomUUID();
}
