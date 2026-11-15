import type { Metadata } from "next";
import { SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = { title: "Terms" };

// Placeholder until the legal text is ready. Do not add legal wording here without review.
export default function TermsPage() {
  return (
    <main className="container max-w-2xl py-12 sm:py-16">
      <h1 className="font-wide text-3xl font-extrabold tracking-tight">Terms</h1>
      <p role="note" className="mt-4 rounded-md border border-signal/50 bg-signal/10 px-3 py-2 text-sm font-semibold">
        Draft. Final text will be provided before launch.
      </p>
      <p className="mt-6 text-mute">[Terms of use to be written with a lawyer]</p>
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
