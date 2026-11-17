import type { Metadata } from "next";
import Link from "next/link";
import { COMPANY_DETAILS, SITE_INTRO, SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description: "Biddr is an online auction site for enthusiast cars across the 27 EU countries.",
};

const link = "text-chalk underline underline-offset-4 hover:text-signal";

// Every statement here follows DECISIONS.md: no promises that cars are verified or
// inspected in general, no fees beyond the buyer's premium, all 27 EU countries.
export default function AboutPage() {
  return (
    <main className="container max-w-2xl py-12 sm:py-16">
      <h1 className="font-wide text-3xl font-extrabold tracking-tight md:text-4xl">About Biddr</h1>
      <p className="mt-3 text-lg text-mute">{SITE_INTRO}</p>

      <div className="mt-8 space-y-5 leading-relaxed">
        <p>
          Biddr is an online auction site for enthusiast cars: the ones people hunt for, including cars that had accident
          damage and were brought back to life. Members in all 27 EU countries can buy and sell.
        </p>
        <p>
          Every listing is reviewed by our team before it goes live. Sellers describe the car&apos;s history honestly,
          including any damage and repairs. They can add a pre-sale inspection report from an authorised dealer of the
          car&apos;s brand, or their own carVertical vehicle history report; both are optional, and we check them before a
          listing shows them.
        </p>
        <p>
          Auctions run for up to 7 days and happen in the open: every bid, the clock and the questions sellers answer are
          visible to everyone. When you win, you pay the winning bid to the seller and a buyer&apos;s premium to Biddr.
        </p>
        <p>
          Read{" "}
          <Link href="/how-it-works" className={link}>
            How it works
          </Link>{" "}
          for the details of bidding, the card hold, the buyer&apos;s premium and selling.
        </p>
      </div>

      <section aria-labelledby="contact-heading" className="mt-10 rounded-lg border border-line bg-panel p-4 sm:p-5">
        <h2 id="contact-heading" className="font-bold">
          Contact
        </h2>
        <p className="mt-2 text-sm">
          Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className={link}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        <p className="mt-1 text-sm text-mute">{COMPANY_DETAILS}</p>
      </section>
    </main>
  );
}
