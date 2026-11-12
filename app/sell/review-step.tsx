import { Button } from "@/components/ui/button";
import { COUNTRY_NAMES, formatEur, formatKm } from "@/lib/format";
import { photoSectionsFor, type SellErrors, type SellPhotos, type StepId } from "@/lib/sell";
import { cn } from "@/lib/utils";
import { FieldError, StepHeading, fieldId } from "./field";
import type { SellValues } from "./types";

function num(v: string): number | null {
  const n = Number(v.replace(/[\s.,]/g, ""));
  return v.trim() && Number.isFinite(n) ? n : null;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-2 text-sm sm:grid-cols-[11rem_1fr]">
      <dt className="text-mute">{label}</dt>
      <dd className="min-w-0 break-words">{value || <span className="text-mute">Not given</span>}</dd>
    </div>
  );
}

function Block({
  title,
  step,
  onEdit,
  hasErrors,
  children,
}: {
  title: string;
  step: StepId;
  onEdit: (step: StepId) => void;
  hasErrors: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-lg border bg-panel p-4", hasErrors ? "border-signal" : "border-line")}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{title}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(step)} aria-label={`Edit ${title.toLowerCase()}`}>
          Edit
        </Button>
      </div>
      {hasErrors ? <p className="mt-1 text-xs text-signal">Something here needs fixing. Select Edit to see what.</p> : null}
      <dl className="mt-2 divide-y divide-line">{children}</dl>
    </section>
  );
}

export function ReviewStep({
  values,
  photos,
  errors,
  stepsWithErrors,
  onEdit,
  onConfirm,
}: {
  values: SellValues;
  photos: SellPhotos;
  errors: SellErrors;
  stepsWithErrors: ReadonlySet<StepId>;
  onEdit: (step: StepId) => void;
  onConfirm: (v: boolean) => void;
}) {
  const restored = values.hadDamage === "yes";
  const make = values.make === "Other" ? values.makeOther : values.make;
  const year = num(values.year);
  const mileage = num(values.mileageKm);
  const start = num(values.startingBid);
  const reserve = num(values.reserve);
  const cover = photos.exterior[0];
  const confirmId = fieldId("confirmed");

  return (
    <section>
      <StepHeading title="Review" intro="Check everything once more. You can't edit the listing after you submit it." />

      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <div className="aspect-[16/9] bg-asphalt">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- user upload preview
            <img src={cover} alt="Cover photo" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-mute">No cover photo yet</div>
          )}
        </div>
        <div className="p-4">
          <p className="text-xs uppercase tracking-wider text-mute">Cover photo</p>
          <p className="font-wide text-lg font-bold">
            {[year, make, values.model, values.variant].filter(Boolean).join(" ") || "Your car"}
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        <Block title="Car" step={1} onEdit={onEdit} hasErrors={stepsWithErrors.has(1)}>
          <Row label="Make and model" value={[make, values.model, values.variant].filter(Boolean).join(" ")} />
          <Row label="Year" value={values.year} />
          <Row label="VIN" value={<span className="font-mono">{values.vin}</span>} />
          <Row label="Mileage" value={mileage !== null ? formatKm(mileage) : ""} />
          <Row label="Engine" value={values.engine} />
          <Row label="Transmission" value={values.transmission} />
          <Row label="Drivetrain" value={values.drivetrain} />
          <Row label="Exterior colour" value={values.exteriorColor} />
          <Row
            label="Location"
            value={[values.city, values.country ? COUNTRY_NAMES[values.country] : ""].filter(Boolean).join(", ")}
          />
        </Block>

        <Block title="History" step={2} onEdit={onEdit} hasErrors={stepsWithErrors.has(2)}>
          <Row
            label="Accident damage"
            value={values.hadDamage === "yes" ? "Yes, repaired" : values.hadDamage === "no" ? "No" : ""}
          />
          {restored ? (
            <Row label="Damage and repair" value={<span className="whitespace-pre-line">{values.damageSummary}</span>} />
          ) : null}
        </Block>

        <Block title="Photos" step={3} onEdit={onEdit} hasErrors={stepsWithErrors.has(3)}>
          {photoSectionsFor(restored).map((s) => (
            <Row key={s.key} label={s.label} value={`${photos[s.key].length} photos`} />
          ))}
          <Row label="Video" value={values.videoUrl} />
        </Block>

        <Block title="Price and inspection" step={4} onEdit={onEdit} hasErrors={stepsWithErrors.has(4)}>
          <Row label="Starting bid" value={start !== null ? formatEur(start) : ""} />
          <Row label="Reserve price" value={reserve !== null ? `${formatEur(reserve)} (private)` : "No reserve"} />
          <Row label="Inspection" value={values.inspectionCity} />
          <Row label="Preferred dates" value={values.inspectionDates} />
          <Row label="Seller fee" value="[to be confirmed]" />
        </Block>
      </div>

      <div className="mt-6">
        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border bg-panel p-4 text-sm",
            errors.confirmed ? "border-signal" : "border-line",
          )}
        >
          <input
            id={confirmId}
            type="checkbox"
            checked={values.confirmed}
            onChange={(e) => onConfirm(e.target.checked)}
            aria-invalid={errors.confirmed ? true : undefined}
            aria-describedby={errors.confirmed ? `${confirmId}-error` : undefined}
            className="mt-0.5 size-4 shrink-0 accent-[#FF5500]"
          />
          <span>I confirm the information is accurate and I have the right to sell this car.</span>
        </label>
        <div className="mt-1.5">
          <FieldError id={`${confirmId}-error`} error={errors.confirmed} />
        </div>
      </div>
    </section>
  );
}
