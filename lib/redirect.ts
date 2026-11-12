/**
 * Returns `raw` only when it is a same-site relative path that is safe to
 * redirect to after sign-in. Everything else falls back to `fallback`.
 */
export function safeNext(raw: string | string[] | null | undefined, fallback = "/"): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.length === 0) return fallback;
  if (!value.startsWith("/")) return fallback;
  // "//host" and "/\host" are treated as protocol-relative URLs by browsers.
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Control characters (tabs, newlines) are stripped by URL parsers and can hide "//".
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return fallback;
  }

  const path = value.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  if (path === "/login" || path.startsWith("/login/")) return fallback;
  if (path === "/auth" || path.startsWith("/auth/")) return fallback;
  return value;
}
