import { EU_COUNTRIES } from "@/lib/countries";
import type { Country } from "@/lib/types";

/** Shared between the profile setup page, its form and its server action. */
/** Any EU country, alphabetically (DECISIONS.md, point 2). */
export const PROFILE_COUNTRIES: readonly { value: Country; label: string }[] = [...EU_COUNTRIES]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((c) => ({ value: c.code, label: c.name }));

export type ProfileField = "username" | "full_name" | "country" | "phone";

export type ProfileFormState = {
  error?: string;
  fieldErrors?: Partial<Record<ProfileField, string>>;
};

export function isProfileComplete(p: { username: string | null; country: string | null } | null): boolean {
  return Boolean(p?.username && p.country);
}
