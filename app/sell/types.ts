import type { PhotoSection, SellErrors, SellInput } from "@/lib/sell";

export type UploadStatus = "queued" | "processing" | "uploading" | "done" | "error";

export interface UploadItem {
  id: string;
  status: UploadStatus;
  progress: number; // 0..1, upload only
  preview: string; // object URL while local, public URL once restored from storage
  url?: string; // public URL once uploaded
  path?: string; // storage path once uploaded
  file?: File; // kept in memory for retry
  error?: string;
}

export type Uploads = Record<PhotoSection, UploadItem[]>;
export type SellValues = Omit<SellInput, "photos" | "draftId">;

export interface StepProps {
  values: SellValues;
  errors: SellErrors;
  set: <K extends keyof SellValues>(key: K, value: SellValues[K]) => void;
}
