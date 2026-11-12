import { ShieldCheck } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Field, FieldError, StepHeading, fieldId, fieldProps } from "./field";
import type { StepProps } from "./types";

const OPTIONS = [
  { value: "no", label: "No", detail: "The car has never had accident damage." },
  { value: "yes", label: "Yes", detail: "The car was damaged and has been repaired." },
] as const;

export function HistoryStep({ values, errors, set }: StepProps) {
  const errId = `${fieldId("hadDamage")}-error`;
  return (
    <section>
      <StepHeading title="History" />

      <fieldset aria-describedby={errors.hadDamage ? errId : undefined}>
        <legend className="text-sm font-semibold">Has this car had accident damage?</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {OPTIONS.map((o, i) => (
            <label
              key={o.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border bg-panel p-4 transition-colors",
                values.hadDamage === o.value ? "border-signal" : "border-line hover:border-mute",
              )}
            >
              <input
                type="radio"
                name="hadDamage"
                id={i === 0 ? fieldId("hadDamage") : undefined}
                value={o.value}
                checked={values.hadDamage === o.value}
                onChange={() => set("hadDamage", o.value)}
                className="mt-0.5 size-4 accent-[#FF5500]"
              />
              <span>
                <span className="block font-semibold">{o.label}</span>
                <span className="block text-sm text-mute">{o.detail}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-1.5">
          <FieldError id={errId} error={errors.hadDamage} />
        </div>
      </fieldset>

      <div className="mt-6 flex gap-3 rounded-lg border border-line bg-panel p-4 text-sm">
        <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-verified" />
        <p className="text-mute">
          <span className="font-semibold text-chalk">Restored cars are welcome.</span> Every restored car gets an
          independent inspection before we list it, and bidders see the report. An honest description of the repair
          helps you get a better price.
        </p>
      </div>

      {values.hadDamage === "yes" ? (
        <Field
          field="damageSummary"
          label="Damage and repair summary"
          error={errors.damageSummary}
          hint="What was damaged, who repaired it, which parts were replaced, and whether any airbags deployed."
          className="mt-6"
        >
          <Textarea
            {...fieldProps("damageSummary", errors.damageSummary, true)}
            value={values.damageSummary}
            onChange={(e) => set("damageSummary", e.target.value)}
            rows={6}
            maxLength={4000}
            placeholder="e.g. Front-left impact in 2022. Repaired at a main-dealer body shop in Tallinn: new bonnet, wing, headlight and radiator. Airbags did not deploy."
          />
        </Field>
      ) : null}
    </section>
  );
}
