"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logAdminAction, requireAdmin } from "@/lib/admin";
import type { AdminResult } from "@/lib/admin-schemas";

const liftSchema = z.object({
  userId: z.string().uuid(),
  kind: z.enum(["bidding", "selling", "messaging"]).default("bidding"),
  reason: z.string().trim().min(10, "Give a reason (at least 10 characters).").max(500, "Keep the reason under 500 characters."),
});

/** Lets a member bid (or sell) again. Only admins; logged with the reason. */
export async function liftBiddingBlock(input: unknown): Promise<AdminResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, error: "You don't have access to do this. Sign in as an admin." };
  const parsed = liftSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Check the form.", fieldErrors: issue ? { [String(issue.path[0])]: issue.message } : {} };
  }
  const kind = parsed.data.kind;
  const column = kind === "selling" ? "selling" : kind === "messaging" ? "messaging" : "bidding";
  const { data } = await ctx.db
    .from("profiles")
    .update({ [`${column}_blocked_at`]: null, [`${column}_block_reason`]: null })
    .eq("id", parsed.data.userId)
    .not(`${column}_blocked_at`, "is", null)
    .select("id");
  if (!data?.length) return { ok: false, error: "This member isn't blocked any more. Reload the page." };
  const type = kind === "selling" ? "selling_unblocked" : kind === "messaging" ? "messaging_unblocked" : "bidding_unblocked";
  await ctx.db.from("notifications").insert({ user_id: parsed.data.userId, type, data: {} });
  await logAdminAction(ctx, null, kind === "selling" ? "user.unblock_selling" : kind === "messaging" ? "user.unblock_messaging" : "user.unblock", {
    user_id: parsed.data.userId,
    reason: parsed.data.reason,
  });
  revalidatePath("/admin/users");
  return {
    ok: true,
    message:
      kind === "selling"
        ? "Unblocked. They can list cars again and have been told."
        : kind === "messaging"
          ? "Unblocked. They can send messages again and have been told."
          : "Unblocked. They can bid again and have been told.",
  };
}
