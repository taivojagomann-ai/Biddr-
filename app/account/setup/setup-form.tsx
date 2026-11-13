"use client";
import { useEffect } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PROFILE_COUNTRIES, type ProfileField, type ProfileFormState } from "@/lib/profile";
import type { Country } from "@/lib/types";
import { saveProfile } from "./actions";

type Defaults = Record<Exclude<ProfileField, "country">, string> & { country: Country | "" };

const initialState: ProfileFormState = {};

function SubmitButton({ isNew }: { isNew: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Saving…" : isNew ? "Save and continue" : "Save changes"}
    </Button>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: ProfileField;
  label: string;
  hint: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-signal">
          {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className="text-xs text-mute">
          {hint}
        </p>
      )}
    </div>
  );
}

const FIELD_ORDER: ProfileField[] = ["username", "full_name", "country", "phone"];

export function SetupForm({ isNew, next, defaults }: { isNew: boolean; next: string; defaults: Defaults }) {
  const [state, formAction] = useFormState(saveProfile, initialState);

  // After a failed save, put focus on the first field to fix; its error is read via aria-describedby.
  useEffect(() => {
    const first = FIELD_ORDER.find((f) => state.fieldErrors?.[f]);
    if (first) document.getElementById(first)?.focus();
  }, [state]);
  const fe = state.fieldErrors ?? {};
  const describedBy = (id: ProfileField) => (fe[id] ? `${id}-error` : `${id}-hint`);

  return (
    <form action={formAction} className="mt-8 space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />

      <Field
        id="username"
        label="Username"
        hint="Shown next to your bids and comments. Lowercase letters, numbers and _."
        error={fe.username}
      >
        <Input
          id="username"
          name="username"
          defaultValue={defaults.username}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          minLength={3}
          maxLength={24}
          required
          aria-invalid={Boolean(fe.username)}
          aria-describedby={describedBy("username")}
        />
      </Field>

      <Field id="full_name" label="Full name" hint="Private. Used on sale documents." error={fe.full_name}>
        <Input
          id="full_name"
          name="full_name"
          defaultValue={defaults.full_name}
          autoComplete="name"
          maxLength={120}
          required
          aria-invalid={Boolean(fe.full_name)}
          aria-describedby={describedBy("full_name")}
        />
      </Field>

      <Field id="country" label="Country" hint="Shown next to your username." error={fe.country}>
        <NativeSelect
          id="country"
          name="country"
          defaultValue={defaults.country}
          autoComplete="country"
          required
          aria-invalid={Boolean(fe.country)}
          aria-describedby={describedBy("country")}
        >
          <option value="" disabled>
            Choose a country
          </option>
          {PROFILE_COUNTRIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field id="phone" label="Phone" hint="Private. Used only to arrange handover." error={fe.phone}>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+372 5123 4567"
          defaultValue={defaults.phone}
          maxLength={32}
          required
          aria-invalid={Boolean(fe.phone)}
          aria-describedby={describedBy("phone")}
        />
      </Field>

      {state.error ? (
        <p role="alert" className="rounded-md border border-signal/40 bg-signal/10 px-3 py-2 text-sm text-chalk">
          {state.error}
        </p>
      ) : null}

      <SubmitButton isNew={isNew} />
    </form>
  );
}
