"use client";
import { useState } from "react";
import { ListEditor } from "@/components/listing/list-editor";
import { ServiceHistoryEditor } from "@/components/listing/service-history-editor";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AdminDetailsInput } from "@/lib/admin-schemas";
import {
  HIGHLIGHTS_MAX,
  NO_FLAWS_LABEL,
  NO_MODIFICATIONS_LABEL,
  SELLER_NOTES_MAX,
} from "@/lib/listing-details";
import { updateDetails } from "../../actions";
import { ActionMessage, FieldNote, useAdminAction } from "./action-feedback";
import { Label } from "./section";

type Values = Omit<AdminDetailsInput, "auctionId">;

export function DetailsForm({ auctionId, initial }: { auctionId: string; initial: Values }) {
  const [v, setV] = useState<Values>(initial);
  const { run, pending, result, fieldErrors: fe } = useAdminAction();
  const set = <K extends keyof Values>(k: K, value: Values[K]) => setV((p) => ({ ...p, [k]: value }));

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        void run(updateDetails, { auctionId, ...v });
      }}
    >
      <ListEditor
        id="details-highlights"
        label="Highlights"
        itemNoun="highlight"
        hint={`Up to ${HIGHLIGHTS_MAX}. Sellers must give at least 3.`}
        items={v.highlights}
        onChange={(x) => set("highlights", x)}
        error={fe.highlights}
        max={HIGHLIGHTS_MAX}
      />
      <ListEditor
        id="details-equipment"
        label="Equipment"
        itemNoun="equipment item"
        addLabel="Add equipment"
        optional
        items={v.equipment}
        onChange={(x) => set("equipment", x)}
        error={fe.equipment}
      />
      <div>
        <ListEditor
          id="details-modifications"
          label="Modifications"
          itemNoun="modification"
          items={v.noModifications ? [""] : v.modifications}
          onChange={(x) => set("modifications", x)}
          error={fe.modifications}
          disabled={v.noModifications}
        />
        <label className="mt-2 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={v.noModifications} onChange={(e) => set("noModifications", e.target.checked)} className="size-4 accent-[#FF5500]" />
          {NO_MODIFICATIONS_LABEL}
        </label>
      </div>
      <div>
        <ListEditor
          id="details-knownFlaws"
          label="Known flaws"
          itemNoun="flaw"
          items={v.noKnownFlaws ? [""] : v.knownFlaws}
          onChange={(x) => set("knownFlaws", x)}
          error={fe.knownFlaws}
          disabled={v.noKnownFlaws}
        />
        <label className="mt-2 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={v.noKnownFlaws} onChange={(e) => set("noKnownFlaws", e.target.checked)} className="size-4 accent-[#FF5500]" />
          {NO_FLAWS_LABEL}
        </label>
      </div>
      <ServiceHistoryEditor
        id="details-serviceHistory"
        rows={v.serviceHistory}
        onChange={(x) => set("serviceHistory", x)}
        error={fe.serviceHistory}
      />
      <ListEditor
        id="details-itemsIncluded"
        label="Items included"
        itemNoun="item"
        optional
        items={v.itemsIncluded}
        onChange={(x) => set("itemsIncluded", x)}
        error={fe.itemsIncluded}
      />
      <div>
        <Label htmlFor="details-sellerNotes" optional>
          Seller notes
        </Label>
        <Textarea
          id="details-sellerNotes"
          value={v.sellerNotes}
          onChange={(e) => set("sellerNotes", e.target.value)}
          rows={4}
          maxLength={SELLER_NOTES_MAX}
        />
        <FieldNote error={fe.sellerNotes} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save details"}
        </Button>
        <ActionMessage result={result} />
      </div>
    </form>
  );
}
