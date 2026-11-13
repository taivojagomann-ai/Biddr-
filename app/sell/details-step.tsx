import { ListEditor } from "@/components/listing/list-editor";
import { ServiceHistoryEditor } from "@/components/listing/service-history-editor";
import { Textarea } from "@/components/ui/textarea";
import {
  HIGHLIGHTS_MAX,
  HIGHLIGHTS_MIN,
  NO_FLAWS_LABEL,
  NO_MODIFICATIONS_LABEL,
  SELLER_NOTES_MAX,
} from "@/lib/listing-details";
import { Field, StepHeading, fieldId, fieldProps } from "./field";
import type { StepProps } from "./types";

function NoneCheckbox({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-field bg-panel px-3 text-sm hover:border-chalk">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 shrink-0 accent-[#FF5500]" />
      {label}
    </label>
  );
}

export function DetailsStep({ values, errors, set }: StepProps) {
  return (
    <section>
      <StepHeading
        title="Details"
        intro="Bidders read these first. Short, specific lines work best: one point per line."
      />

      <div className="space-y-10">
        <ListEditor
          id={fieldId("highlights")}
          label="Highlights"
          itemNoun="highlight"
          hint={`What makes this car special? Options, condition, history. Add ${HIGHLIGHTS_MIN} to ${HIGHLIGHTS_MAX}.`}
          items={values.highlights}
          onChange={(v) => set("highlights", v)}
          error={errors.highlights}
          max={HIGHLIGHTS_MAX}
          placeholder="e.g. One owner from new, full BMW service history"
        />

        <ListEditor
          id={fieldId("equipment")}
          label="Equipment"
          itemNoun="equipment item"
          addLabel="Add equipment"
          optional
          hint="Factory options and features, e.g. carbon bucket seats, Harman Kardon sound."
          items={values.equipment}
          onChange={(v) => set("equipment", v)}
          error={errors.equipment}
        />

        <div>
          <ListEditor
            id={fieldId("modifications")}
            label="Modifications"
            itemNoun="modification"
            hint="Anything changed from factory specification: exhaust, wheels, suspension, software."
            items={values.noModifications ? [""] : values.modifications}
            onChange={(v) => set("modifications", v)}
            error={errors.modifications}
            disabled={values.noModifications}
          />
          <NoneCheckbox
            id={fieldId("noModifications")}
            label={NO_MODIFICATIONS_LABEL}
            checked={values.noModifications}
            onChange={(v) => set("noModifications", v)}
          />
        </div>

        <div>
          <ListEditor
            id={fieldId("knownFlaws")}
            label="Known flaws"
            itemNoun="flaw"
            hint="Be specific: stone chips, kerbed wheels, warning lights, worn seat bolster. Listings that show flaws honestly sell better and avoid disputes."
            items={values.noKnownFlaws ? [""] : values.knownFlaws}
            onChange={(v) => set("knownFlaws", v)}
            error={errors.knownFlaws}
            disabled={values.noKnownFlaws}
          />
          <NoneCheckbox
            id={fieldId("noKnownFlaws")}
            label={NO_FLAWS_LABEL}
            checked={values.noKnownFlaws}
            onChange={(v) => set("noKnownFlaws", v)}
          />
        </div>

        <ServiceHistoryEditor
          id={fieldId("serviceHistory")}
          rows={values.serviceHistory}
          onChange={(v) => set("serviceHistory", v)}
          error={errors.serviceHistory}
          hint="Oil services, brakes, clutch, timing chain, anything major. Leave a row empty to skip it."
        />

        <ListEditor
          id={fieldId("itemsIncluded")}
          label="Items included"
          itemNoun="item"
          optional
          hint="What comes with the car, e.g. second key, winter tyres, service book."
          items={values.itemsIncluded}
          onChange={(v) => set("itemsIncluded", v)}
          error={errors.itemsIncluded}
        />

        <Field
          field="sellerNotes"
          label="Seller notes"
          optional
          error={errors.sellerNotes}
          hint={`Anything else bidders should know, in your own words. Up to ${SELLER_NOTES_MAX.toLocaleString("en-IE")} characters.`}
        >
          <Textarea
            {...fieldProps("sellerNotes", errors.sellerNotes, true)}
            value={values.sellerNotes}
            onChange={(e) => set("sellerNotes", e.target.value)}
            rows={5}
            maxLength={SELLER_NOTES_MAX}
          />
        </Field>
      </div>
    </section>
  );
}
