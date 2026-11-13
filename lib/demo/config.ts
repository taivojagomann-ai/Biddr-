import "server-only";

/** Demo tools exist only when ENABLE_DEMO_DATA=true. Set it to false (or remove it) before launch. */
export function isDemoDataEnabled(): boolean {
  return process.env.ENABLE_DEMO_DATA === "true";
}
