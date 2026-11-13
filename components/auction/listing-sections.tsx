import { Check } from "lucide-react";
import { asServiceHistory, asTextList } from "@/lib/listing-details";
import type { Auction } from "@/lib/types";
import { ExpandableList, ServiceHistoryTable } from "./expandable";

type Props = { auction: Auction };

function SectionShell({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-3 text-lg font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The team's editorial note. Only shown when an admin has written one. */
export function EditorTake({ auction }: Props) {
  if (!auction.editor_take?.trim()) return null;
  return (
    <section aria-labelledby="take-heading" className="rounded-lg border-l-4 border-signal bg-panel px-4 py-4 sm:px-5">
      <h2 id="take-heading" className="text-xs font-bold uppercase tracking-wider text-signal">
        Biddr&apos;s take
      </h2>
      <p className="mt-2 whitespace-pre-line leading-relaxed">{auction.editor_take}</p>
    </section>
  );
}

export function Highlights({ auction }: Props) {
  const items = asTextList(auction.highlights);
  if (!items.length) return null;
  return (
    <section aria-labelledby="highlights-heading">
      <h2 id="highlights-heading" className="mb-3 text-lg font-bold">
        Highlights
      </h2>
      <ul className="grid gap-2 text-sm sm:grid-cols-2">
        {items.map((h, i) => (
          <li key={i} className="flex gap-2.5">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-signal" />
            <span className="min-w-0 break-words">{h}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Equipment({ auction }: Props) {
  const items = asTextList(auction.equipment);
  if (!items.length) return null;
  return (
    <SectionShell id="equipment-heading" title="Equipment">
      <ExpandableList items={items} noun="items" />
    </SectionShell>
  );
}

export function Modifications({ auction }: Props) {
  const items = asTextList(auction.modifications);
  if (!items.length && !auction.no_modifications) return null;
  return (
    <SectionShell id="modifications-heading" title="Modifications">
      {items.length ? <ExpandableList items={items} noun="modifications" /> : <p className="text-sm text-mute">Factory specification.</p>}
    </SectionShell>
  );
}

export function KnownFlaws({ auction }: Props) {
  const items = asTextList(auction.known_flaws);
  if (!items.length && !auction.no_known_flaws) return null;
  return (
    <SectionShell id="flaws-heading" title="Known flaws">
      {items.length ? (
        <ExpandableList items={items} noun="flaws" />
      ) : (
        <p className="text-sm text-mute">Seller is not aware of any flaws.</p>
      )}
    </SectionShell>
  );
}

export function ServiceHistory({ auction }: Props) {
  const records = asServiceHistory(auction.service_history);
  if (!records.length) return null;
  return (
    <SectionShell id="service-heading" title="Service history">
      <ServiceHistoryTable records={records} captionId="service-heading" />
    </SectionShell>
  );
}

export function ItemsIncluded({ auction }: Props) {
  const items = asTextList(auction.items_included);
  if (!items.length) return null;
  return (
    <SectionShell id="included-heading" title="Items included">
      <ExpandableList items={items} noun="items" />
    </SectionShell>
  );
}

export function SellerNotes({ auction }: Props) {
  if (!auction.seller_notes?.trim()) return null;
  return (
    <SectionShell id="notes-heading" title="Seller notes">
      <p className="whitespace-pre-line text-sm leading-relaxed text-mute">{auction.seller_notes}</p>
    </SectionShell>
  );
}
