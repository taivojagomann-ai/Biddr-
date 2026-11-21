// Cost estimates for the admin dashboard (US dollars, list prices). Estimates only:
// the provider's invoice is the record.

/** Per million tokens: [input, output]. */
const CLAUDE_PRICES: Record<string, [number, number]> = {
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5": [2, 10],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-haiku-5-5": [0.1, 0.5],
};

/** Google Cloud Vision: per image, per feature (web detection). */
export const VISION_USD_PER_IMAGE = 0.0035;

export function claudeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = CLAUDE_PRICES[model];
  if (!price) return 0;
  return (inputTokens * price[0] + outputTokens * price[1]) / 1_000_000;
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(n < 1 ? 3 : 2)}`;
}
