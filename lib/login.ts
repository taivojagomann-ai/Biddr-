/** Error codes the login page understands in `?error=`. Shared by the page and /auth/callback. */
export type LoginErrorCode = "link" | "provider";

export const LOGIN_ERROR_MESSAGES: Record<LoginErrorCode, string> = {
  link: "That sign-in link has expired or was already used. Enter your email to get a new one.",
  provider: "Google sign-in was cancelled or failed. Try again, or use your email instead.",
};

export function loginErrorMessage(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "link" || value === "provider") return LOGIN_ERROR_MESSAGES[value];
  return undefined;
}

/** Builds `/login?error=…&next=…` for redirects from route handlers. */
export function loginPath(next: string, error?: LoginErrorCode): string {
  const params = new URLSearchParams();
  if (error) params.set("error", error);
  if (next !== "/") params.set("next", next);
  const qs = params.toString();
  return qs ? `/login?${qs}` : "/login";
}
