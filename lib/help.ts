// Copy for the contextual "i" tips. Amounts come from the same constants the app
// charges with, so the help can't drift from the rules.
import { formatEur } from "@/lib/format";
import { PREMIUM_MAX, PREMIUM_MIN, PREMIUM_RATE } from "@/lib/pricing";
import { HISTORY_TEXT } from "@/lib/history-report";

export interface HelpTopic {
  /** Accessible name of the "i" button, phrased as the question it answers. */
  label: string;
  text: string;
  /** Section of /how-it-works with the full explanation. */
  href: string;
}

export const HELP = {
  reserve: {
    label: "What is a reserve?",
    text: "Reserve: the seller's secret minimum price. The car only sells if bidding reaches it.",
    href: "/how-it-works#reserve",
  },
  noReserve: {
    label: "What does no reserve mean?",
    text: "No reserve: the car sells to the highest bidder, whatever the price.",
    href: "/how-it-works#reserve",
  },
  premium: {
    label: "What is the buyer's premium?",
    text: `The winner pays a ${Math.round(PREMIUM_RATE * 100)}% buyer's premium on top of the winning bid, at least ${formatEur(PREMIUM_MIN)} and at most ${formatEur(PREMIUM_MAX)}.`,
    href: "/how-it-works#buyers-premium",
  },
  extension: {
    label: "Why can the end time change?",
    text: "Bids in the last 2 minutes add 2 minutes to the clock, so nobody can win by bidding at the last second.",
    href: "/how-it-works#extensions",
  },
  dealerInspected: {
    label: "What does Dealer inspected mean?",
    text: "An authorised dealer of the car's brand inspected it before the auction. We checked the report comes from an official dealer, matches the VIN and mileage, and is no older than 90 days.",
    href: "/how-it-works#badges",
  },
  /** Dealer inspected, where the selling dealer inspected its own car (0017). */
  dealerInspectedBySeller: {
    label: "What does Dealer inspected mean?",
    text: "Inspected by the selling dealer: the seller is an authorised dealer of the car's brand and inspected the car itself, so this isn't an independent check. We checked the report matches the VIN and mileage and is no older than 90 days.",
    href: "/how-it-works#badges",
  },
  historyReport: {
    label: "What does History report mean?",
    text: HISTORY_TEXT.tip,
    href: "/how-it-works#history-report",
  },
  accidentRepaired: {
    label: "What does Accident repaired mean?",
    text: "The car had accident damage and has been repaired. The seller describes the repair; Biddr doesn't check the repair itself.",
    href: "/how-it-works#badges",
  },
} satisfies Record<string, HelpTopic>;

/** The card hold amount comes from the environment (BID_HOLD_AMOUNT_EUR), like the hold itself. */
export function holdHelp(holdEur: number): HelpTopic {
  return {
    label: "What is the card hold?",
    text: `Before your first bid on a car we place a refundable ${formatEur(holdEur)} hold on your card. It isn't a charge. It's released when the auction ends unless you win.`,
    href: "/how-it-works#card-hold",
  };
}
