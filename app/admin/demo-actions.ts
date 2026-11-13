"use server";
import { revalidatePath } from "next/cache";
import { logAdminAction, requireAdmin } from "@/lib/admin";
import type { AdminResult } from "@/lib/admin-schemas";
import { isDemoDataEnabled } from "@/lib/demo/config";
import { loadDemoData, removeDemoData } from "@/lib/demo/seed";

const DISABLED: AdminResult = { ok: false, error: "Demo data is turned off. Set ENABLE_DEMO_DATA=true to use it." };
const NOT_ALLOWED: AdminResult = { ok: false, error: "You don't have access to do this. Sign in as an admin." };

function refresh() {
  revalidatePath("/", "layout");
}

/** Creates (or recreates) all demo data. Admins only, and only when ENABLE_DEMO_DATA=true. */
export async function loadDemoDataAction(): Promise<AdminResult> {
  if (!isDemoDataEnabled()) return DISABLED;
  const ctx = await requireAdmin();
  if (!ctx) return NOT_ALLOWED;

  try {
    const s = await loadDemoData(ctx.db);
    await logAdminAction(ctx, null, "demo.load", { ...s });
    refresh();
    return {
      ok: true,
      message: `Demo data loaded: ${s.auctions} auctions, ${s.bids} bids, ${s.comments} comments and ${s.users} demo users.`,
    };
  } catch (e) {
    console.error("demo load failed", e);
    await logAdminAction(ctx, null, "demo.load_failed", { error: e instanceof Error ? e.message : String(e) });
    refresh();
    return {
      ok: false,
      error: `Demo data couldn't be loaded, and anything half-made was removed. ${
        e instanceof Error ? e.message : ""
      } Check that 0006_demo_data.sql has been run, then try again.`,
    };
  }
}

/** Removes demo auctions, their files and the demo users. Never touches real data. */
export async function removeDemoDataAction(): Promise<AdminResult> {
  if (!isDemoDataEnabled()) return DISABLED;
  const ctx = await requireAdmin();
  if (!ctx) return NOT_ALLOWED;

  try {
    const s = await removeDemoData(ctx.db);
    await logAdminAction(ctx, null, "demo.remove", { ...s });
    refresh();
    return {
      ok: true,
      message:
        s.auctions || s.users || s.files
          ? `Demo data removed: ${s.auctions} auctions, ${s.users} demo users and ${s.files} files.`
          : "There was no demo data to remove.",
    };
  } catch (e) {
    console.error("demo remove failed", e);
    return { ok: false, error: `Demo data couldn't be fully removed. ${e instanceof Error ? e.message : ""} Try again.` };
  }
}
