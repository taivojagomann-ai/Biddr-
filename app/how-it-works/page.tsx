import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatEur } from "@/lib/format";
import { buyersPremium, PREMIUM_MAX, PREMIUM_MIN, PREMIUM_RATE } from "@/lib/pricing";
import { SITE_INTRO } from "@/lib/site";

export const metadata: Metadata = {
  title: "How it works",
  description: "How bidding, the refundable card hold, the buyer's premium, reserves and selling work on Biddr.",
};

const HOLD_EUR = Number(process.env.BID_HOLD_AMOUNT_EUR ?? 500);
const EXAMPLE_BID = 40_000;

const SECTIONS = [
  ["bidding", "How bidding works"],
  ["card-hold", "The refundable card hold"],
  ["buyers-premium", "The buyer's premium"],
  ["reserve", "Reserve or no reserve"],
  ["extensions", "Late bids add 2 minutes"],
  ["badges", "Dealer inspected and Accident repaired"],
  ["history-report", "Vehicle history reports"],
  ["after-you-win", "After you win"],
  ["selling", "How selling works"],
] as const;

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20 font-wide text-xl font-bold sm:text-2xl">
      {children}
    </h2>
  );
}

export default function HowItWorksPage() {
  const premium = buyersPremium(EXAMPLE_BID);
  const pct = `${Math.round(PREMIUM_RATE * 100)}%`;

  return (
    <main className="container max-w-3xl py-10 sm:py-14">
      <h1 className="font-wide text-3xl font-extrabold tracking-tight md:text-4xl">How it works</h1>
      <p className="mt-3 text-mute">
        {SITE_INTRO} Biddr runs online auctions of up to 7 days. Here is what happens when you bid, and when you sell.
      </p>

      <nav aria-labelledby="toc-heading" className="mt-8 rounded-lg border border-line bg-panel p-4">
        <h2 id="toc-heading" className="text-sm font-semibold">
          On this page
        </h2>
        <ul className="mt-2 grid gap-x-6 sm:grid-cols-2">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 hover:text-signal sm:min-h-9">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-10 space-y-12 leading-relaxed [&_p]:mt-3 [&_p]:text-mute [&_strong]:text-chalk">
        <section aria-labelledby="bidding">
          <H2 id="bidding">How bidding works</H2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-mute marker:text-chalk">
            <li>
              <strong>Sign in.</strong> One account lets you bid, ask sellers questions and list a car.
            </li>
            <li>
              <strong>Confirm your card.</strong> Before your first bid on a car we place a refundable{" "}
              {formatEur(HOLD_EUR)} hold on it (see below).
            </li>
            <li>
              <strong>Bid at least the minimum.</strong> The first bid must be at least the starting bid. After that, each
              bid must beat the current bid by the increment shown, usually {formatEur(250)}.
            </li>
            <li>
              <strong>Watch the page.</strong> Bids, the clock and the high bidder update live. If someone outbids you, the
              auction page tells you.
            </li>
          </ol>
          <p>
            Bids are binding: if you have the highest bid when the clock runs out and the reserve is met, you buy the car.
            You can&apos;t bid on your own car, and you can&apos;t outbid yourself.
          </p>
        </section>

        <section aria-labelledby="card-hold">
          <H2 id="card-hold">The refundable {formatEur(HOLD_EUR)} card hold</H2>
          <p>
            Before your first bid on each car, we ask your bank to hold <strong>{formatEur(HOLD_EUR)}</strong> on your card.
            It is not a charge: the money stays in your account, but your bank reserves it. This keeps bidding serious.
          </p>
          <p>
            If you don&apos;t win, the hold is released when the auction ends. If you win, it goes toward the buyer&apos;s
            premium. Card holds expire after about 7 days, which is why auctions run for 7 days at most.
          </p>
        </section>

        <section aria-labelledby="buyers-premium">
          <H2 id="buyers-premium">The buyer&apos;s premium</H2>
          <p>
            The winner pays the winning bid to the seller, plus a <strong>{pct} buyer&apos;s premium</strong> to Biddr. The
            premium is at least <strong>{formatEur(PREMIUM_MIN)}</strong> and at most{" "}
            <strong>{formatEur(PREMIUM_MAX)}</strong>. Every bid box shows the total before you bid.
          </p>
          <div className="mt-4 rounded-lg border border-line bg-panel p-4">
            <h3 className="text-sm font-semibold">Example</h3>
            <dl className="mt-2 grid gap-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-mute">Winning bid</dt>
                <dd className="tabular">{formatEur(EXAMPLE_BID)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-mute">
                  Buyer&apos;s premium ({pct} of {formatEur(EXAMPLE_BID)})
                </dt>
                <dd className="tabular">{formatEur(premium)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-line pt-1.5 font-bold">
                <dt>You pay in total</dt>
                <dd className="tabular">{formatEur(EXAMPLE_BID + premium)}</dd>
              </div>
            </dl>
          </div>
          <p>
            On a {formatEur(5_000)} car, {pct} would be {formatEur(250)}, so the minimum of {formatEur(PREMIUM_MIN)} applies.
            Above {formatEur(PREMIUM_MAX / PREMIUM_RATE)}, the premium stays at {formatEur(PREMIUM_MAX)}.
          </p>
        </section>

        <section aria-labelledby="reserve">
          <H2 id="reserve">Reserve or no reserve</H2>
          <p>
            A <strong>reserve</strong> is the lowest price the seller will accept. Bidders never see the amount. The auction
            shows <strong>Reserve</strong> until bidding reaches it, then <strong>Reserve met</strong>. If bidding ends below
            the reserve, the car doesn&apos;t sell and every hold is released.
          </p>
          <p>
            A car marked <strong>No reserve</strong> sells to the highest bidder, whatever the price.
          </p>
        </section>

        <section aria-labelledby="extensions">
          <H2 id="extensions">Late bids add 2 minutes</H2>
          <p>
            If a bid arrives in the <strong>last 2 minutes</strong>, the end time moves <strong>2 minutes later</strong>. This
            can happen again and again. It means nobody wins by bidding in the final second: everyone always gets a fair
            chance to reply, just like in a room auction.
          </p>
        </section>

        <section aria-labelledby="badges">
          <H2 id="badges">Dealer inspected and Accident repaired</H2>
          <dl className="mt-4 space-y-4">
            <div>
              <dt className="font-semibold">Dealer inspected</dt>
              <dd className="mt-1 text-mute">
                An authorised dealer of the car&apos;s brand inspected it before the auction. The seller arranged the inspection
                and sent us the report. We checked that it comes from an official dealer, matches the car&apos;s VIN and
                mileage, and is no older than 90 days. You can read the highlights on the auction page, and download the
                report when the seller has agreed to share it. If the seller is a dealer and inspected the car themselves,
                the auction page says so. Inspections are optional, so cars without this badge haven&apos;t been inspected by
                a dealer; the specifications say &quot;Not inspected&quot;.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Accident repaired</dt>
              <dd className="mt-1 text-mute">
                The car had accident damage and has been repaired. The seller describes what was damaged and how it was
                fixed. Biddr doesn&apos;t check the repair itself. If the car was also dealer inspected, it carries the Dealer
                inspected badge and you can read the findings before you bid. If not, the auction page says so clearly: ask
                the seller for repair documents and photos.
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="history-report">
          <H2 id="history-report">Vehicle history reports</H2>
          <p>
            Sellers can add their own <strong>carVertical</strong> vehicle history report. Our team checks that it matches
            the car: the VIN, mileage records that are no higher than the listing and consistent, and damage records that
            match the seller&apos;s description. Cars with an accepted report carry the <strong>History report</strong>{" "}
            badge and a short summary written by us. You can open the full report only when the seller has agreed to share
            it.
          </p>
          <p>
            Reports are optional. When a car has none, the auction page says so and links to carVertical, where you can
            check the car&apos;s history yourself using its VIN. For older cars, history databases often have little data,
            so restoration records and photos matter more.
          </p>
        </section>

        <section aria-labelledby="after-you-win">
          <H2 id="after-you-win">After you win</H2>
          <p>
            When the clock runs out with your bid on top and the reserve met, the auction shows <strong>Sold</strong>. We put
            you in touch with the seller: you pay for the car directly to the seller and arrange the handover with them.
            Biddr only charges the buyer&apos;s premium, and your {formatEur(HOLD_EUR)} hold goes toward it.
          </p>
          <p>If the reserve isn&apos;t met, the car doesn&apos;t sell and your hold is released.</p>
        </section>

        <section aria-labelledby="selling">
          <H2 id="selling">How selling works</H2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-mute marker:text-chalk">
            <li>
              <strong>Submit your car.</strong> Add the details, its history, photos and your starting price. It takes one
              form, and your answers are saved as you go.
            </li>
            <li>
              <strong>Dealer inspection, if you have one.</strong> If an authorised dealer of your car&apos;s brand, in any
              EU country, has done a pre-sale inspection, upload the report. Reports from independent garages aren&apos;t
              accepted. Inspected cars get the Dealer inspected badge and give buyers more confidence. Accident-repaired
              cars are welcome either way.
            </li>
            <li>
              <strong>We review the listing</strong> (and check the dealer&apos;s report, if there is one) and agree the
              auction dates with you.
            </li>
            <li>
              <strong>Your auction runs</strong> for up to 7 days. If you set a reserve, the car only sells if bidding reaches
              it.
            </li>
          </ol>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/sell">Sell your car</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">See live auctions</Link>
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
