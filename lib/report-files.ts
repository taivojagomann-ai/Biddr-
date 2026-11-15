import "server-only";
import { getAdminSupabase } from "@/lib/supabase/server";
import { REPORT_BUCKET, REPORT_PATH_RE } from "@/lib/sell";

/**
 * Dealer report files must sit in the private bucket inside `folder`
 * (<user id>/<draft or auction id>) and actually exist there. Checked with the
 * service role, for that folder only.
 */
export async function checkReportPaths(paths: string[], folder: string): Promise<boolean> {
  if (paths.length === 0 || new Set(paths).size !== paths.length) return false;
  if (!paths.every((p) => REPORT_PATH_RE.test(p) && p.startsWith(`${folder}/`))) return false;
  const { data, error } = await getAdminSupabase().storage.from(REPORT_BUCKET).list(folder, { limit: 100 });
  if (error || !data) return false;
  const names = new Set(data.map((f) => f.name));
  return paths.every((p) => names.has(p.slice(folder.length + 1)));
}
