"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ProfileField, ProfileFormState } from "@/lib/profile";
import { safeNext } from "@/lib/redirect";
import { getServerSupabase } from "@/lib/supabase/server";

const profileSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,24}$/, "Use 3–24 lowercase letters, numbers or _."),
  full_name: z
    .string()
    .trim()
    .min(2, "Enter your full name.")
    .max(120, "Keep your name under 120 characters."),
  country: z.enum(["EE", "LV", "LT"], { errorMap: () => ({ message: "Choose your country." }) }),
  phone: z
    .string()
    .transform((v) => v.replace(/[\s\-()]/g, ""))
    .pipe(z.string().regex(/^\+[1-9]\d{6,14}$/, "Enter the number with its country code, like +372 5123 4567.")),
});

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

export async function saveProfile(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Sign in again to save your profile." };

  const parsed = profileSchema.safeParse({
    username: text(formData, "username"),
    full_name: text(formData, "full_name"),
    country: text(formData, "country"),
    phone: text(formData, "phone"),
  });

  if (!parsed.success) {
    const fieldErrors: Partial<Record<ProfileField, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "username" || key === "full_name" || key === "country" || key === "phone") {
        fieldErrors[key] ??= issue.message;
      }
    }
    return { fieldErrors };
  }

  // Normal server client: RLS and column grants limit this to the user's own row
  // and to full_name, username, country and phone.
  const { error } = await supabase.from("profiles").update(parsed.data).eq("id", user.id);

  if (error) {
    if (error.code === "23505") return { fieldErrors: { username: "That username is taken. Try another." } };
    return { error: "We couldn't save your profile. Check your connection and try again." };
  }

  revalidatePath("/", "layout");
  redirect(safeNext(text(formData, "next")));
}
