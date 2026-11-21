import type { Metadata } from "next";
import { SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy" };

// Placeholder until the legal text is ready. Do not add legal wording here without review.
export default function PrivacyPage() {
  return (
    <main className="container max-w-2xl py-12 sm:py-16">
      <h1 className="font-wide text-3xl font-extrabold tracking-tight">Privacy</h1>
      <p role="note" className="mt-4 rounded-md border border-signal/50 bg-signal/10 px-3 py-2 text-sm font-semibold">
        Draft. Final text will be provided before launch.
      </p>
      <p className="mt-6 text-mute">[Privacy policy to be written with a lawyer]</p>
      <section aria-labelledby="fraud-prevention" className="mt-6 rounded-md border border-line p-3 text-sm">
        <h2 id="fraud-prevention" className="font-semibold">
          [Placeholder: fraud prevention]
        </h2>
        <p className="mt-1 text-mute">
          [To be reviewed by a lawyer.] To prevent fake listings, Biddr uses: Stripe Identity to verify sellers&apos; identity
          (Biddr keeps only the verified name, the document&apos;s country and the date); Anthropic&apos;s Claude to read the
          VIN, mileage, code and owner&apos;s name from the seller&apos;s photos and registration certificate; and Google Cloud
          Vision to search the web for copies of listing photos. Only what each check needs is sent. Challenge photos and
          registration documents are deleted 30 days after the auction ends.
        </p>
      </section>
      <p className="mt-2 text-mute">
        Questions in the meantime? Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-chalk underline underline-offset-4 hover:text-signal">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </main>
  );
}
