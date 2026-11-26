"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert, CircleCheck, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useTimeZone } from "@/hooks/use-time-zone";
import { EU_COUNTRIES, REPORT_MAX_AGE_DAYS, type ReportFile } from "@/lib/sell";
import { formatDate } from "@/lib/zoned-time";
import type { SellerInspectionDecision } from "@/lib/types";
import { DealerReportUpload } from "../../sell/dealer-report-upload";
import { listWithoutInspection, submitNewReport } from "./actions";
import { WithdrawActions } from "./withdraw-actions";

const WITHOUT_INSPECTION_TEXT =
  "Your listing will go live without a Dealer inspected badge. Buyers will see that the car hasn't been inspected by a dealer.";


/**
 * After Biddr rejects a dealer inspection report, the seller chooses: upload a new
 * report, list without an inspection, or withdraw. Used on My listings and on the
 * listing preview. Stays mounted after the choice, to show (and focus) the outcome.
 */
export function DecisionPanel({
  auctionId,
  userId,
  title,
  make,
  required,
  reason,
  deadline,
  choice,
}: {
  auctionId: string;
  userId: string;
  title: string;
  make: string;
  /** True while the seller still has to choose. */
  required: boolean;
  reason: string | null;
  deadline: string | null;
  /** What they chose, once they have. */
  choice: SellerInspectionDecision | null;
}) {
  const id = useId();
  const headingId = `${id}-heading`;
  const formId = `${id}-form`;
  const [formOpen, setFormOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const tz = useTimeZone();

  useEffect(() => {
    if (!done) return;
    // After any dialog has finished closing and returning focus to its (now gone) trigger.
    const t = window.setTimeout(() => doneRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [done]);

  if (done) {
    return (
      <p ref={doneRef} tabIndex={-1} role="status" className="flex items-start gap-2 text-sm font-semibold text-status-success outline-none">
        <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        {done}
      </p>
    );
  }

  if (!required) {
    if (!choice) return null;
    return (
      <p className="text-sm text-mute">
        {choice === "new_report"
          ? "You uploaded a new inspection report. We'll check it during review."
          : "You chose to list without an inspection. We'll review your listing without the Dealer inspected badge."}
      </p>
    );
  }

  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-signal/60 bg-asphalt/60 p-4">
      <h2 id={headingId} className="flex items-center gap-2 font-semibold">
        <TriangleAlert aria-hidden className="size-4 shrink-0 text-status-warning" />
        Waiting for your decision
      </h2>
      <p className="mt-2 text-sm">
        <span className="text-mute">Your inspection report wasn&apos;t accepted: </span>
        {reason ?? "The report couldn't be checked."}
      </p>
      {deadline ? (
        <p className="mt-1 text-sm">
          <span className="font-semibold">Please choose by {formatDate(deadline, tz)}.</span>{" "}
          <span className="text-mute">If you don&apos;t, the listing is withdrawn.</span>
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-start gap-2">
        <Button
          type="button"
          size="sm"
          aria-expanded={formOpen}
          aria-controls={formId}
          onClick={() => setFormOpen((o) => !o)}
        >
          <Upload aria-hidden />
          Upload a new report
        </Button>
        <WithoutInspectionDialog auctionId={auctionId} title={title} onDone={setDone} />
        <WithdrawActions auctionId={auctionId} title={title} option="withdraw" declined={false} />
      </div>

      <div id={formId} hidden={!formOpen} className="mt-4">
        {formOpen ? (
          <NewReportForm auctionId={auctionId} userId={userId} make={make} idBase={id} onDone={setDone} />
        ) : null}
      </div>
    </section>
  );
}

function WithoutInspectionDialog({
  auctionId,
  title,
  onDone,
}: {
  auctionId: string;
  title: string;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await listWithoutInspection({ auctionId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      onDone(res.message);
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && (setOpen(o), setError(null))}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label={`List without an inspection: ${title}`}>
          List without an inspection
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="pr-8">List without an inspection?</DialogTitle>
        <DialogDescription asChild>
          <div className="mt-2 space-y-2 text-sm text-mute">
            <p className="font-semibold text-chalk">{title}</p>
            <p>{WITHOUT_INSPECTION_TEXT}</p>
          </div>
        </DialogDescription>
        {error ? (
          <p role="alert" className="mt-3 text-sm font-medium text-signal">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void confirm()} disabled={busy}>
            {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
            List without an inspection
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Fields = {
  reportDealerName: string;
  reportDealerCity: string;
  reportDealerCountry: string;
  reportDate: string;
  reportMileage: string;
};

const FIELD_ORDER: (keyof Fields | "reportFiles")[] = [
  "reportDealerName",
  "reportDealerCity",
  "reportDealerCountry",
  "reportDate",
  "reportMileage",
  "reportFiles",
];

/** The same dealer report fields and upload as in the sell form. */
function NewReportForm({
  auctionId,
  userId,
  make,
  idBase,
  onDone,
}: {
  auctionId: string;
  userId: string;
  make: string;
  idBase: string;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Fields>({
    reportDealerName: "",
    reportDealerCity: "",
    reportDealerCountry: "",
    reportDate: "",
    reportMileage: "",
  });
  const [files, setFiles] = useState<ReportFile[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uploading = useRef(false);
  const onBusyChange = useCallback((b: boolean) => {
    uploading.current = b;
  }, []);
  const today = new Date().toISOString().slice(0, 10);
  const fid = (k: string) => `${idBase}-${k}`;

  const set = (k: keyof Fields, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (uploading.current) {
      setFormError("Wait for the files to finish uploading.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const res = await submitNewReport({ auctionId, ...values, reportFiles: files });
      if (res.ok) {
        onDone(res.message);
        router.refresh();
        return;
      }
      const fieldErrors = res.fieldErrors ?? {};
      setErrors(fieldErrors);
      setFormError(Object.keys(fieldErrors).length ? null : res.error);
      const first = FIELD_ORDER.find((k) => fieldErrors[k]);
      if (first) window.setTimeout(() => document.getElementById(fid(first))?.focus(), 0);
    } catch {
      setFormError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof Fields, label: string, input: (props: Record<string, unknown>) => React.ReactNode, hint?: string) => {
    const err = errors[k];
    const describedBy = [err ? `${fid(k)}-error` : null, hint ? `${fid(k)}-hint` : null].filter(Boolean).join(" ") || undefined;
    return (
      <div className="space-y-1.5">
        <label htmlFor={fid(k)} className="block text-sm font-semibold">
          {label}
        </label>
        {input({ id: fid(k), "aria-invalid": err ? true : undefined, "aria-describedby": describedBy })}
        {hint ? (
          <p id={`${fid(k)}-hint`} className="text-xs text-mute">
            {hint}
          </p>
        ) : null}
        {err ? (
          <p id={`${fid(k)}-error`} className="text-xs font-medium text-signal">
            {err}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="New inspection report">
      <p className="text-sm text-mute">
        Only a pre-sale inspection by an authorised {make || "brand"} dealer, in any EU country, from the last{" "}
        {REPORT_MAX_AGE_DAYS} days.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("reportDealerName", "Dealer's name", (p) => (
          <Input {...p} value={values.reportDealerName} onChange={(e) => set("reportDealerName", e.target.value)} maxLength={120} autoComplete="off" />
        ))}
        {field("reportDealerCity", "Dealer's city", (p) => (
          <Input {...p} value={values.reportDealerCity} onChange={(e) => set("reportDealerCity", e.target.value)} maxLength={80} autoComplete="off" />
        ))}
        {field(
          "reportDealerCountry",
          "Dealer's country",
          (p) => (
            <NativeSelect {...p} value={values.reportDealerCountry} onChange={(e) => set("reportDealerCountry", e.target.value)}>
              <option value="" disabled>
                Choose a country
              </option>
              {EU_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          ),
          "EU countries only.",
        )}
        {field(
          "reportDate",
          "Inspection date",
          (p) => <Input {...p} type="date" max={today} value={values.reportDate} onChange={(e) => set("reportDate", e.target.value)} />,
          `Within the last ${REPORT_MAX_AGE_DAYS} days.`,
        )}
        {field(
          "reportMileage",
          "Mileage on the report",
          (p) => (
            <Input
              {...p}
              inputMode="numeric"
              value={values.reportMileage}
              onChange={(e) => set("reportMileage", e.target.value.replace(/[^\d\s]/g, ""))}
            />
          ),
          "In kilometres, as written on the report.",
        )}
      </div>
      <DealerReportUpload
        userId={userId}
        draftId={auctionId}
        files={files}
        onChange={setFiles}
        onBusyChange={onBusyChange}
        error={errors.reportFiles}
        idBase={fid("reportFiles")}
      />
      {formError ? (
        <p role="alert" className="text-sm font-medium text-signal">
          {formError}
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
        Send the new report
      </Button>
    </form>
  );
}
