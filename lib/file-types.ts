// Which files the uploads take: JPG/JPEG, PNG, WebP, HEIC/HEIF photos and PDF documents.
// Some systems (Windows, older Android) give HEIC and other files no type, so the
// name's extension counts too. HEIC is converted in the browser before upload
// (lib/photo-upload.ts), so storage and the checks only ever see JPEG, PNG, WebP or PDF.

/** For a file input that takes photos. The extensions help pickers that don't know the HEIC type. */
export const ACCEPT_PHOTOS = "image/*,.jpg,.jpeg,.png,.webp,.heic,.heif";
/** For a file input that takes photos or PDF documents. */
export const ACCEPT_PHOTOS_AND_PDF = `application/pdf,.pdf,${ACCEPT_PHOTOS}`;
/** What to tell people the uploads take. */
export const FORMATS_TEXT = "JPG, PNG, WebP, HEIC or PDF";
export const PHOTO_FORMATS_TEXT = "JPG, PNG, WebP or HEIC";

function ext(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m?.[1]?.toLowerCase() ?? "";
}

export function isPdfFile(file: { name: string; type: string }): boolean {
  return file.type === "application/pdf" || (!file.type && ext(file.name) === "pdf");
}

export function isHeicFile(file: { name: string; type: string }): boolean {
  return /^image\/hei[cf](-sequence)?$/.test(file.type) || ["heic", "heif"].includes(ext(file.name));
}

export function isPhotoFile(file: { name: string; type: string }): boolean {
  if (isHeicFile(file)) return true;
  if (file.type) return file.type.startsWith("image/");
  return ["jpg", "jpeg", "png", "webp"].includes(ext(file.name));
}
