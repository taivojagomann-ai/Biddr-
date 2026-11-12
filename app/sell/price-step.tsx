import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { INSPECTION_CITIES, MIN_STARTING_BID } from "@/lib/sell";
import type { InspectionCity } from "@/lib/types";
import { Field, StepHeading, fieldProps } from "./field";
import type { StepProps } from "./types";

function EuroInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-mute">
        €
      </span>
      <Input {...props} inputMode="numeric" className="pl-7" />
    </div>
  );
}

const digits = (v: string) => v.replace(/[^\d\s]/g, "");

export function PriceStep({ values, errors, set }: StepProps) {
  return (
    <section>
      <StepHeading title="Price and inspection" />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          field="startingBid"
          label="Starting bid"
          error={errors.startingBid}
          hint={`Whole euros, at least €${MIN_STARTING_BID.toLocaleString("en-IE")}.`}
        >
          <EuroInput
            {...fieldProps("startingBid", errors.startingBid, true)}
            value={values.startingBid}
            onChange={(e) => set("startingBid", digits(e.target.value))}
            placeholder="e.g. 25 000"
          />
        </Field>

        <Field field="reserve" label="Reserve price" optional error={errors.reserve}>
          <EuroInput
            {...fieldProps("reserve", errors.reserve)}
            value={values.reserve}
            onChange={(e) => set("reserve", digits(e.target.value))}
            placeholder="No reserve"
          />
        </Field>
      </div>

      <div className="mt-4 rounded-lg border border-line bg-panel p-4 text-sm text-mute">
        <p>
          <span className="font-semibold text-chalk">How the reserve works.</span> The reserve is the lowest price
          you&apos;ll accept. Bidders never see it, only whether it has been met. If bidding doesn&apos;t reach it, the
          car doesn&apos;t sell.
        </p>
        <p className="mt-2">Cars with no reserve usually attract more bidders.</p>
      </div>

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <Field
          field="inspectionCity"
          label="Inspection location"
          error={errors.inspectionCity}
          hint="Our partner inspects the car before it goes live."
        >
          <NativeSelect
            {...fieldProps("inspectionCity", errors.inspectionCity, true)}
            value={values.inspectionCity}
            onChange={(e) => set("inspectionCity", e.target.value as InspectionCity | "")}
          >
            <option value="" disabled>
              Choose a city
            </option>
            {INSPECTION_CITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field
          field="inspectionDates"
          label="Preferred dates and times"
          optional
          error={errors.inspectionDates}
          className="sm:col-span-2"
        >
          <Textarea
            {...fieldProps("inspectionDates", errors.inspectionDates)}
            value={values.inspectionDates}
            onChange={(e) => set("inspectionDates", e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="e.g. Weekday mornings, or any time on 18–20 November"
            className="min-h-20"
          />
        </Field>
      </div>

      <p className="mt-8 rounded-lg border border-line px-4 py-3 text-sm">Seller fee: [to be confirmed]</p>
    </section>
  );
}
