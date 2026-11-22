"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MakeCombobox } from "@/components/ui/make-combobox";
import { useModelSuggestions } from "@/hooks/use-model-suggestions";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { AdminResult, ListingInput } from "@/lib/admin-schemas";
import { COUNTRY_NAMES } from "@/lib/format";
import { BODY_STYLES, REGISTRATION_OPTIONS, SELLER_TYPES } from "@/lib/listing-details";
import { COUNTRIES, DRIVETRAINS } from "@/lib/sell";
import { updateListing } from "../../actions";
import { ActionMessage, FieldNote, useAdminAction } from "./action-feedback";
import { Label } from "./section";

type Values = Omit<ListingInput, "auctionId"> & { year?: string; vin?: string };

/**
 * The listing's car and text. Admins edit it here (the VIN and year stay as submitted);
 * sellers correct it on "Edit listing" (`seller`), where the VIN and year can be fixed
 * and the title follows the year, make, model and variant.
 */
export function ListingForm({
  auctionId,
  vin,
  restored,
  initial,
  seller = false,
  action = updateListing,
}: {
  auctionId: string;
  vin: string;
  restored: boolean;
  initial: Values;
  seller?: boolean;
  action?: (input: unknown) => Promise<AdminResult>;
}) {
  const [v, setV] = useState<Values>(initial);
  const { run, pending, result, fieldErrors: fe } = useAdminAction();
  const set = <K extends keyof Values>(k: K, value: Values[K]) => setV((p) => ({ ...p, [k]: value }));
  const models = useModelSuggestions(v.makeOther ? "" : v.make);

  const text = (key: "title" | "year" | "vin" | "variant" | "engine" | "transmission" | "exteriorColor" | "city" | "mileageKm" | "videoUrl" | "interiorColor" | "ownerCount" | "dealerName" | "dealerRegistryCode", label: string, opts: { optional?: boolean; wide?: boolean; inputMode?: "numeric" | "url" } = {}) => (
    <div className={opts.wide ? "sm:col-span-2" : undefined}>
      <Label htmlFor={`listing-${key}`} optional={opts.optional}>
        {label}
      </Label>
      <Input
        id={`listing-${key}`}
        value={v[key] ?? ""}
        onChange={(e) => set(key, e.target.value)}
        inputMode={opts.inputMode}
        className={key === "vin" ? "font-mono uppercase tracking-wider" : undefined}
        autoComplete={key === "vin" ? "off" : undefined}
        spellCheck={key === "vin" ? false : undefined}
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
        void run(action, { auctionId, ...v });
      }}
    >
      {seller ? null : text("title", "Title", { wide: true })}
      <div>
        <Label htmlFor="listing-make">Make</Label>
        <MakeCombobox
          id="listing-make"
          invalid={Boolean(fe.make)}
          describedBy="listing-make-note"
          value={{ make: v.make, other: v.makeOther }}
          onChange={(m) => setV((p) => ({ ...p, make: m.make, makeOther: m.other }))}
        />
        <div id="listing-make-note">
          <FieldNote
            error={fe.make}
            hint={
              v.makeOther
                ? seller
                  ? "Not in the make list: Biddr's team will check it."
                  : "Not in the make list: kept as typed. Add it to lib/data/car-makes.ts in a future update."
                : "Type to search the make list."
            }
          />
        </div>
      </div>
      <div>
        <Label htmlFor="listing-model">Model</Label>
        <Input
          id="listing-model"
          value={v.model}
          onChange={(e) => set("model", e.target.value)}
          list={models.length ? "listing-model-suggestions" : undefined}
          autoComplete="off"
          aria-invalid={fe.model ? true : undefined}
        />
        <datalist id="listing-model-suggestions">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <FieldNote error={fe.model} />
      </div>
      {seller ? (
        <>
          {text("year", "Year", { inputMode: "numeric" })}
          {text("vin", "VIN")}
        </>
      ) : (
        <div>
          <p className="mb-1.5 text-sm font-semibold">VIN</p>
          <p className="flex h-10 items-center rounded-md border border-line bg-asphalt/50 px-3 font-mono text-sm tracking-wider text-mute">{vin}</p>
        </div>
      )}
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
      <div>
        <Label htmlFor="listing-bodyStyle">Body style</Label>
        <NativeSelect id="listing-bodyStyle" value={v.bodyStyle} onChange={(e) => set("bodyStyle", e.target.value as Values["bodyStyle"])}>
          <option value="">Not set</option>
          {BODY_STYLES.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </NativeSelect>
        <FieldNote error={fe.bodyStyle} />
      </div>
      {text("interiorColor", "Interior colour", { optional: true })}
      {text("ownerCount", "Number of owners", { optional: true, inputMode: "numeric" })}
      <div>
        <Label htmlFor="listing-sellerType">Seller</Label>
        <NativeSelect id="listing-sellerType" value={v.sellerType} onChange={(e) => set("sellerType", e.target.value as Values["sellerType"])}>
          {SELLER_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      {v.sellerType === "dealer" ? (
        <>
          {text("dealerName", "Dealer company name")}
          {text("dealerRegistryCode", "Dealer registry code")}
        </>
      ) : null}
      <div>
        <Label htmlFor="listing-registrationCountry">Registered in</Label>
        <NativeSelect
          id="listing-registrationCountry"
          value={v.registrationCountry}
          onChange={(e) => set("registrationCountry", e.target.value as Values["registrationCountry"])}
        >
          <option value="">Not set</option>
          {REGISTRATION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div>
        <Label htmlFor="listing-isRegistered">Registered right now</Label>
        <NativeSelect id="listing-isRegistered" value={v.isRegistered} onChange={(e) => set("isRegistered", e.target.value as Values["isRegistered"])}>
          <option value="">Not set</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
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
        <FieldNote error={fe.damageSummary} hint={restored ? "Shown to bidders. Accident-repaired cars must have one." : undefined} />
      </div>
      {text("videoUrl", "Video link (YouTube or Vimeo)", { optional: true, wide: true, inputMode: "url" })}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : seller ? "Save changes" : "Save listing details"}
        </Button>
        <ActionMessage result={result} />
      </div>
    </form>
  );
}
