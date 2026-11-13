// Pure bid-history generator for demo auctions (no I/O), so it is easy to check.

export interface DemoBid {
  bidderIndex: number;
  amount: number;
  at: Date;
}

const STEPS = [250, 500, 1000] as const;

/**
 * `count` bids that follow the auction rules:
 * - the first bid is the starting bid; each next one is at least `minIncrement` more
 *   (a mix of +250, +500 and +1000 where allowed);
 * - the same bidder never bids twice in a row;
 * - times are strictly increasing, strictly between `from` and `to`, and denser near `to`.
 */
export function generateBids(opts: {
  count: number;
  startingBid: number;
  minIncrement: number;
  from: Date;
  to: Date;
  bidderCount: number;
  random?: () => number;
}): DemoBid[] {
  const rnd = opts.random ?? Math.random;
  const steps = STEPS.filter((s) => s >= opts.minIncrement);
  const choices = steps.length ? steps : [opts.minIncrement];
  const start = opts.from.getTime();
  const span = opts.to.getTime() - start;
  if (opts.count <= 0) return [];
  if (span <= opts.count * 2000) throw new Error("Not enough time for the requested number of bids.");

  const bids: DemoBid[] = [];
  let amount = opts.startingBid;
  let previousBidder = -1;
  let previousAt = start;

  for (let i = 0; i < opts.count; i++) {
    if (i > 0) {
      // Small steps are most common, like real bidding.
      const r = rnd();
      amount += r < 0.55 ? choices[0]! : r < 0.85 ? (choices[1] ?? choices[0]!) : (choices[2] ?? choices[choices.length - 1]!);
    }

    let bidder = Math.floor(rnd() * opts.bidderCount);
    if (bidder === previousBidder) bidder = (bidder + 1 + Math.floor(rnd() * (opts.bidderCount - 1))) % opts.bidderCount;

    // u is spread evenly with jitter; 1 - (1 - u)^2.2 crowds the bids towards the end.
    const u = (i + 0.25 + rnd() * 0.5) / opts.count;
    const x = 1 - Math.pow(1 - u, 2.2);
    let at = start + Math.round(x * span);
    at = Math.max(at, previousAt + 1000);
    at = Math.min(at, start + span - (opts.count - i)); // keep strictly before `to`
    if (at <= previousAt || at <= start) at = previousAt + 1;

    bids.push({ bidderIndex: bidder, amount, at: new Date(at) });
    previousBidder = bidder;
    previousAt = at;
  }
  return bids;
}
