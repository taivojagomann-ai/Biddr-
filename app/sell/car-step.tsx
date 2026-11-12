import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { COUNTRY_NAMES } from "@/lib/format";
import { COUNTRIES, DRIVETRAINS, MAKES, type Drivetrain, type MakeOption } from "@/lib/sell";
import type { Country } from "@/lib/types";
import { Field, StepHeading, fieldProps } from "./field";
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
    </section>
  );
}
