import type { Country } from "@/lib/types";

/** Shared between the profile setup page, its form and its server action. */
export const PROFILE_COUNTRIES: readonly { value: Country; label: string }[] = [
  { value: "EE", label: "Estonia" },
  { value: "LV", label: "Latvia" },
  { value: "LT", label: "Lithuania" },
];

export type ProfileField = "username" | "full_name" | "country" | "phone";

export type ProfileFormState = {
  error?: string;
  fieldErrors?: Partial<Record<ProfileField, string>>;
};

export function isProfileComplete(p: { username: string | null; country: string | null } | null): boolean {
  return Boolean(p?.username && p.country);
}
