import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { COUNTRY_NAMES } from "@/lib/format";
import { BODY_STYLES, REGISTRATION_OPTIONS, SELLER_TYPES } from "@/lib/listing-details";
import { COUNTRIES, DRIVETRAINS, MAKES, type Drivetrain, type MakeOption } from "@/lib/sell";
import type { BodyStyle, Country, RegistrationCountry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Field, FieldError, StepHeading, fieldId, fieldProps } from "./field";
import type { StepProps } from "./types";

const DRIVETRAIN_LABELS: Record<Drivetrain, string> = {
  RWD: "Rear-wheel drive (RWD)",
  AWD: "All-wheel drive (AWD)",
  FWD: "Front-wheel drive (FWD)",
};

export function CarStep({ values, errors, set }: StepProps) {
  const maxYear = new Date().getFullYear() + 1;
  return (
    <section>
      <StepHeading title="The car" intro="Copy the details from the registration document where you can." />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field field="make" label="Make" error={errors.make}>
          <NativeSelect
            {...fieldProps("make", errors.make)}
            value={values.make}
            onChange={(e) => set("make", e.target.value as MakeOption | "")}
          >
            <option value="" disabled>
              Choose a make
            </option>
            {MAKES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {values.make === "Other" ? (
          <Field field="makeOther" label="Which make?" error={errors.makeOther}>
            <Input
              {...fieldProps("makeOther", errors.makeOther)}
              value={values.makeOther}
              onChange={(e) => set("makeOther", e.target.value)}
              placeholder="e.g. Lotus"
              maxLength={40}
            />
          </Field>
        ) : null}

        <Field field="model" label="Model" error={errors.model}>
          <Input
            {...fieldProps("model", errors.model)}
            value={values.model}
            onChange={(e) => set("model", e.target.value)}
            placeholder="e.g. M3"
            maxLength={60}
          />
        </Field>

        <Field field="variant" label="Variant" optional error={errors.variant} hint="e.g. Competition, Touring, GTS">
          <Input
            {...fieldProps("variant", errors.variant, true)}
            value={values.variant}
            onChange={(e) => set("variant", e.target.value)}
            maxLength={40}
          />
        </Field>

        <Field field="year" label="Year" error={errors.year}>
          <Input
            {...fieldProps("year", errors.year)}
            value={values.year}
            onChange={(e) => set("year", e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            placeholder={String(maxYear - 1)}
            maxLength={4}
          />
        </Field>

        <Field
          field="vin"
          label="VIN"
          error={errors.vin}
          hint="17 characters, on the registration document and at the base of the windscreen. Only the admin team sees it."
          className="sm:col-span-2"
        >
          <Input
            {...fieldProps("vin", errors.vin, true)}
            value={values.vin}
            onChange={(e) => set("vin", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 17))}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={17}
            className="font-mono tracking-wider"
          />
        </Field>

        <Field field="mileageKm" label="Mileage (km)" error={errors.mileageKm}>
          <Input
            {...fieldProps("mileageKm", errors.mileageKm)}
            value={values.mileageKm}
            onChange={(e) => set("mileageKm", e.target.value.replace(/[^\d\s]/g, ""))}
            inputMode="numeric"
            placeholder="e.g. 48 500"
          />
        </Field>

        <Field field="transmission" label="Transmission" error={errors.transmission} hint="e.g. 6-speed manual, 8-speed automatic">
          <Input
            {...fieldProps("transmission", errors.transmission, true)}
            value={values.transmission}
            onChange={(e) => set("transmission", e.target.value)}
            maxLength={60}
          />
        </Field>

        <Field
          field="engine"
          label="Engine"
          error={errors.engine}
          hint="e.g. 3.0 inline-6 twin-turbo, 450 hp"
          className="sm:col-span-2"
        >
          <Input
            {...fieldProps("engine", errors.engine, true)}
            value={values.engine}
            onChange={(e) => set("engine", e.target.value)}
            maxLength={120}
          />
        </Field>

        <Field field="drivetrain" label="Drivetrain" error={errors.drivetrain}>
          <NativeSelect
            {...fieldProps("drivetrain", errors.drivetrain)}
            value={values.drivetrain}
            onChange={(e) => set("drivetrain", e.target.value as Drivetrain | "")}
          >
            <option value="" disabled>
              Choose a drivetrain
            </option>
            {DRIVETRAINS.map((d) => (
              <option key={d} value={d}>
                {DRIVETRAIN_LABELS[d]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field field="exteriorColor" label="Exterior colour" error={errors.exteriorColor}>
          <Input
            {...fieldProps("exteriorColor", errors.exteriorColor)}
            value={values.exteriorColor}
            onChange={(e) => set("exteriorColor", e.target.value)}
            placeholder="e.g. Isle of Man Green"
            maxLength={40}
          />
        </Field>

        <Field field="bodyStyle" label="Body style" error={errors.bodyStyle}>
          <NativeSelect
            {...fieldProps("bodyStyle", errors.bodyStyle)}
            value={values.bodyStyle}
            onChange={(e) => set("bodyStyle", e.target.value as BodyStyle | "")}
          >
            <option value="" disabled>
              Choose a body style
            </option>
            {BODY_STYLES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field field="interiorColor" label="Interior colour" error={errors.interiorColor} hint="Colour and material, e.g. Black Merino leather">
          <Input
            {...fieldProps("interiorColor", errors.interiorColor, true)}
            value={values.interiorColor}
            onChange={(e) => set("interiorColor", e.target.value)}
            maxLength={60}
          />
        </Field>

        <Field field="ownerCount" label="Number of owners" error={errors.ownerCount} hint="Including you.">
          <Input
            {...fieldProps("ownerCount", errors.ownerCount, true)}
            value={values.ownerCount}
            onChange={(e) => set("ownerCount", e.target.value.replace(/\D/g, "").slice(0, 2))}
            inputMode="numeric"
            maxLength={2}
            className="sm:max-w-[8rem]"
          />
        </Field>

        <Field field="city" label="City where the car is" error={errors.city}>
          <Input
            {...fieldProps("city", errors.city)}
            value={values.city}
            onChange={(e) => set("city", e.target.value)}
            autoComplete="address-level2"
            maxLength={60}
          />
        </Field>

        <Field field="country" label="Country" error={errors.country}>
          <NativeSelect
            {...fieldProps("country", errors.country)}
            value={values.country}
            onChange={(e) => set("country", e.target.value as Country | "")}
          >
            <option value="" disabled>
              Choose a country
            </option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {COUNTRY_NAMES[c]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <fieldset className="mt-8 min-w-0">
        <legend className="text-sm font-semibold">Who is selling?</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {SELLER_TYPES.map((t, i) => (
            <label
              key={t.value}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-panel px-4 py-3",
                values.sellerType === t.value ? "border-signal" : "border-field hover:border-chalk",
              )}
            >
              <input
                type="radio"
                name="sellerType"
                id={i === 0 ? fieldId("sellerType") : undefined}
                value={t.value}
                checked={values.sellerType === t.value}
                onChange={() => set("sellerType", t.value)}
                className="size-4 accent-[#FF5500]"
              />
              <span className="font-semibold">{t.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {values.sellerType === "dealer" ? (
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field field="dealerName" label="Company name" error={errors.dealerName}>
            <Input
              {...fieldProps("dealerName", errors.dealerName)}
              value={values.dealerName}
              onChange={(e) => set("dealerName", e.target.value)}
              autoComplete="organization"
              maxLength={120}
            />
          </Field>
          <Field field="dealerRegistryCode" label="Registry code" error={errors.dealerRegistryCode} hint="From the business register.">
            <Input
              {...fieldProps("dealerRegistryCode", errors.dealerRegistryCode, true)}
              value={values.dealerRegistryCode}
              onChange={(e) => set("dealerRegistryCode", e.target.value)}
              maxLength={40}
            />
          </Field>
        </div>
      ) : null}

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <Field field="registrationCountry" label="Where is the car registered?" error={errors.registrationCountry}>
          <NativeSelect
            {...fieldProps("registrationCountry", errors.registrationCountry)}
            value={values.registrationCountry}
            onChange={(e) => set("registrationCountry", e.target.value as RegistrationCountry | "")}
          >
            <option value="" disabled>
              Choose a country
            </option>
            {REGISTRATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <fieldset className="min-w-0" aria-describedby={errors.isRegistered ? `${fieldId("isRegistered")}-error` : undefined}>
          <legend className="mb-1.5 text-sm font-semibold">Is it registered right now?</legend>
          <div className="flex flex-col gap-3 min-[420px]:flex-row">
            {(["yes", "no"] as const).map((v, i) => (
              <label
                key={v}
                className={cn(
                  "flex min-h-11 flex-1 cursor-pointer items-center gap-2 rounded-md border bg-panel px-3",
                  values.isRegistered === v ? "border-signal" : "border-field hover:border-chalk",
                )}
              >
                <input
                  type="radio"
                  name="isRegistered"
                  id={i === 0 ? fieldId("isRegistered") : undefined}
                  value={v}
                  checked={values.isRegistered === v}
                  onChange={() => set("isRegistered", v)}
                  className="size-4 accent-[#FF5500]"
                />
                {v === "yes" ? "Yes" : "No, deregistered or not yet registered"}
              </label>
            ))}
          </div>
          <FieldError id={`${fieldId("isRegistered")}-error`} error={errors.isRegistered} />
        </fieldset>
      </div>
    </section>
  );
}
