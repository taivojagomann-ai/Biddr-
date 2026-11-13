"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ListingInput } from "@/lib/admin-schemas";
import { COUNTRY_NAMES } from "@/lib/format";
import { COUNTRIES, DRIVETRAINS } from "@/lib/sell";
import { updateListing } from "../../actions";
import { ActionMessage, FieldNote, useAdminAction } from "./action-feedback";
import { Label } from "./section";

type Values = Omit<ListingInput, "auctionId">;

export function ListingForm({
  auctionId,
  vin,
  restored,
  initial,
}: {
  auctionId: string;
  vin: string;
  restored: boolean;
  initial: Values;
}) {
  const [v, setV] = useState<Values>(initial);
  const { run, pending, result, fieldErrors: fe } = useAdminAction();
  const set = <K extends keyof Values>(k: K, value: Values[K]) => setV((p) => ({ ...p, [k]: value }));

  const text = (key: "title" | "variant" | "engine" | "transmission" | "exteriorColor" | "city" | "mileageKm" | "videoUrl", label: string, opts: { optional?: boolean; wide?: boolean; inputMode?: "numeric" | "url" } = {}) => (
    <div className={opts.wide ? "sm:col-span-2" : undefined}>
      <Label htmlFor={`listing-${key}`} optional={opts.optional}>
        {label}
      </Label>
      <Input
        id={`listing-${key}`}
        value={v[key]}
        onChange={(e) => set(key, e.target.value)}
        inputMode={opts.inputMode}
        aria-invalid={fe[key] ? true : undefined}
      />
      <FieldNote error={fe[key]} />
    </div>
  );

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(updateListing, { auctionId, ...v });
      }}
    >
      {text("title", "Title", { wide: true })}
      <div>
        <p className="mb-1.5 text-sm font-semibold">VIN</p>
        <p className="flex h-10 items-center rounded-md border border-line bg-asphalt/50 px-3 font-mono text-sm tracking-wider text-mute">{vin}</p>
      </div>
      {text("variant", "Variant", { optional: true })}
      {text("engine", "Engine", { wide: true })}
      {text("transmission", "Transmission")}
      <div>
        <Label htmlFor="listing-drivetrain">Drivetrain</Label>
        <NativeSelect id="listing-drivetrain" value={v.drivetrain} onChange={(e) => set("drivetrain", e.target.value as Values["drivetrain"])}>
          {DRIVETRAINS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </NativeSelect>
        <FieldNote error={fe.drivetrain} />
      </div>
      {text("exteriorColor", "Exterior colour")}
      {text("mileageKm", "Mileage (km)", { inputMode: "numeric" })}
      {text("city", "City")}
      <div>
        <Label htmlFor="listing-country">Country</Label>
        <NativeSelect id="listing-country" value={v.country} onChange={(e) => set("country", e.target.value as Values["country"])}>
          {COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {COUNTRY_NAMES[c]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="listing-damageSummary" optional={!restored}>
          Damage and repair summary
        </Label>
        <Textarea
          id="listing-damageSummary"
          value={v.damageSummary}
          onChange={(e) => set("damageSummary", e.target.value)}
          rows={5}
          aria-invalid={fe.damageSummary ? true : undefined}
        />
        <FieldNote error={fe.damageSummary} hint={restored ? "Shown to bidders. Restored cars must have one." : undefined} />
      </div>
      {text("videoUrl", "Video link (YouTube or Vimeo)", { optional: true, wide: true, inputMode: "url" })}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save listing details"}
        </Button>
        <ActionMessage result={result} />
      </div>
    </form>
  );
}
