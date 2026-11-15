import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { EU_COUNTRIES, MIN_STARTING_BID, REPORT_MAX_AGE_DAYS, type EuCountry } from "@/lib/sell";
import { cn } from "@/lib/utils";
import { Field, FieldError, StepHeading, fieldId, fieldProps } from "./field";
import { DealerReportUpload } from "./dealer-report-upload";
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

const INSPECTION_OPTIONS = [
  { value: "yes", label: "Yes, I'll upload it" },
  { value: "no", label: "No, list without an inspection" },
] as const;

export function PriceStep({
  values,
  errors,
  set,
  userId,
  draftId,
  onReportBusy,
}: StepProps & { userId: string; draftId: string; onReportBusy: (busy: boolean) => void }) {
  const questionErrId = `${fieldId("dealerInspection")}-error`;
  const restored = values.hadDamage === "yes";
  const make = (values.make === "Other" ? values.makeOther : values.make).trim();
  const today = new Date().toISOString().slice(0, 10);
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

      <p id="inspection-explainer" className="mt-8 text-sm text-mute">
        We only accept inspections done by an official dealer of your car&apos;s brand, in any EU country. Reports from
        independent garages aren&apos;t accepted. Inspected listings get a Dealer inspected badge, which gives buyers more
        confidence.
      </p>
      <fieldset
        className="mt-3 min-w-0"
        aria-describedby={["inspection-explainer", errors.dealerInspection ? questionErrId : ""].filter(Boolean).join(" ")}
      >
        <legend className="text-sm font-semibold">
          Do you have a pre-sale inspection report from an authorised {make || "brand"} dealer?
        </legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {INSPECTION_OPTIONS.map((o, i) => (
            <label
              key={o.value}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border bg-panel p-4 transition-colors",
                values.dealerInspection === o.value ? "border-signal" : "border-field hover:border-chalk",
              )}
            >
              <input
                type="radio"
                name="dealerInspection"
                id={i === 0 ? fieldId("dealerInspection") : undefined}
                value={o.value}
                checked={values.dealerInspection === o.value}
                onChange={() => set("dealerInspection", o.value)}
                className="size-4 shrink-0 accent-[#FF5500]"
              />
              <span className="font-semibold">{o.label}</span>
            </label>
          ))}
        </div>
        <div className="mt-1.5">
          <FieldError id={questionErrId} error={errors.dealerInspection} />
        </div>
      </fieldset>

      {values.dealerInspection === "yes" ? (
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field field="reportDealerName" label="Dealer's name" error={errors.reportDealerName} hint={`The official ${make || "brand"} dealer that did the inspection.`}>
            <Input
              {...fieldProps("reportDealerName", errors.reportDealerName, true)}
              value={values.reportDealerName}
              onChange={(e) => set("reportDealerName", e.target.value)}
              maxLength={120}
              autoComplete="off"
            />
          </Field>
          <Field field="reportDealerCity" label="Dealer's city" error={errors.reportDealerCity}>
            <Input
              {...fieldProps("reportDealerCity", errors.reportDealerCity)}
              value={values.reportDealerCity}
              onChange={(e) => set("reportDealerCity", e.target.value)}
              maxLength={80}
              autoComplete="off"
            />
          </Field>
          <Field field="reportDealerCountry" label="Dealer's country" error={errors.reportDealerCountry} hint="EU countries only.">
            <NativeSelect
              {...fieldProps("reportDealerCountry", errors.reportDealerCountry, true)}
              value={values.reportDealerCountry}
              onChange={(e) => set("reportDealerCountry", e.target.value as EuCountry | "")}
            >
              <option value="" disabled>
                Choose a country
              </option>
              {EU_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            field="reportDate"
            label="Inspection date"
            error={errors.reportDate}
            hint={`Within the last ${REPORT_MAX_AGE_DAYS} days.`}
          >
            <Input
              {...fieldProps("reportDate", errors.reportDate, true)}
              type="date"
              value={values.reportDate}
              onChange={(e) => set("reportDate", e.target.value)}
              max={today}
            />
          </Field>
          <Field
            field="reportMileage"
            label="Mileage on the report"
            error={errors.reportMileage}
            hint="In kilometres, as written on the report."
          >
            <div className="relative">
              <Input
                {...fieldProps("reportMileage", errors.reportMileage, true)}
                inputMode="numeric"
                value={values.reportMileage}
                onChange={(e) => set("reportMileage", digits(e.target.value))}
                className="pr-10"
              />
              <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-mute">
                km
              </span>
            </div>
          </Field>
          <div className="sm:col-span-2">
            <DealerReportUpload
              userId={userId}
              draftId={draftId}
              files={values.reportFiles}
              onChange={(next) => set("reportFiles", next)}
              onBusyChange={onReportBusy}
              error={errors.reportFiles}
            />
          </div>
        </div>
      ) : null}

      {values.dealerInspection === "no" && restored ? (
        <p className="mt-6 flex gap-3 rounded-lg border border-field bg-panel p-4 text-sm">
          <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-mute" />
          <span>
            Your listing will show that the car hasn&apos;t been inspected by a dealer. Buyers will see your damage and repair
            description.
          </span>
        </p>
      ) : null}

    </section>
  );
}
