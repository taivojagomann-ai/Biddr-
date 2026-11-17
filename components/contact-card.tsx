import { CONTACT_NOTE, type PartyContact } from "@/lib/contacts";

/** The other party's contact details after the buyer's premium is paid. */
export function ContactCard({ heading, contact, idBase }: { heading: string; contact: PartyContact; idBase: string }) {
  const tel = contact.phone?.replace(/[^\d+]/g, "");
  return (
    <section aria-labelledby={`${idBase}-contact`} className="rounded-md border border-line bg-asphalt/40 p-3 text-sm">
      <h3 id={`${idBase}-contact`} className="font-semibold">
        {heading}
      </h3>
      <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1">
        <dt className="text-mute">Name</dt>
        <dd>{contact.fullName ?? "Not given"}</dd>
        <dt className="text-mute">Phone</dt>
        <dd>
          {contact.phone ? (
            <a href={`tel:${tel}`} className="inline-flex min-h-6 items-center underline underline-offset-4 hover:text-signal">
              {contact.phone}
            </a>
          ) : (
            "Not given"
          )}
        </dd>
        <dt className="text-mute">Email</dt>
        <dd className="break-all">
          {contact.email ? (
            <a href={`mailto:${contact.email}`} className="inline-flex min-h-6 items-center underline underline-offset-4 hover:text-signal">
              {contact.email}
            </a>
          ) : (
            "Not given"
          )}
        </dd>
      </dl>
      <p className="mt-2 text-mute">{CONTACT_NOTE}</p>
    </section>
  );
}
