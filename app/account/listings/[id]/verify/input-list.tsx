"use client";
import { useEffect, useState } from "react";
import { LocalDateTime } from "@/components/local-date-time";
import { StatusIcon } from "@/components/status-icon";
import { Button } from "@/components/ui/button";
import type { InputItem, InputKey } from "@/lib/listing-checks/verification-model";
import { cn } from "@/lib/utils";

type Panel = "registration" | "photos";

const PANEL_OF: Partial<Record<InputKey, Panel>> = {
  registration: "registration",
  authorisation: "registration",
  vin_photo: "photos",
  dashboard_photo: "photos",
};

/** Row ids the result's buttons jump to (#registration, #photos). */
const ROW_ID: Partial<Record<InputKey, string>> = { registration: "registration", vin_photo: "photos", identity: "identity" };

/**
 * "What we need from you": one row per input, only "Not added" or "Added" (neutral, never
 * green: adding isn't passing). Add / Replace / Retake open the matching form under the
 * group; Start begins the identity check. Read-only unless `editable`.
 */
export function InputList({
  items,
  editable,
  panels,
  identityAction,
}: {
  items: InputItem[];
  editable: boolean;
  panels: Record<Panel, React.ReactNode>;
  /** The identity check's Start button (it leaves for Stripe's page). */
  identityAction: React.ReactNode;
}) {
  const [open, setOpen] = useState<Panel | null>(null);

  // A result's "Retake photos" / "Replace document" link opens the right form.
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      if (h === "photos" || h === "registration") setOpen(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const lastOf = (panel: Panel) => [...items].reverse().find((i) => PANEL_OF[i.key] === panel)?.key;

  return (
    <ul className="divide-y divide-line rounded-lg border border-line">
      {items.map((item) => {
        const panel = PANEL_OF[item.key];
        const label = actionLabel(item);
        const showAction = editable && (item.key === "identity" ? !item.added : Boolean(panel));
        return (
          <li key={item.key} id={ROW_ID[item.key]} data-input={item.key} data-state={item.added ? "added" : "not-added"} className="scroll-mt-20">
            <div className="flex min-h-14 flex-col gap-3 p-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 gap-3">
                <StatusIcon kind={item.added ? "added" : "not-added"} className="mt-0.5 size-5" />
                <div className="min-w-0">
                  <p className="font-semibold">
                    {item.label}
                    {item.required ? null : <span className="ml-2 rounded-sm border border-line px-1.5 py-0.5 text-xs font-normal text-mute">Optional</span>}
                  </p>
                  <p className="text-sm text-mute">
                    {item.added ? (
                      item.addedAt ? (
                        <>
                          Added <LocalDateTime iso={item.addedAt} dateOnly />
                        </>
                      ) : (
                        "Added"
                      )
                    ) : (
                      "Not added"
                    )}
                  </p>
                  {item.note ? <p className="text-sm text-mute">{item.note}</p> : null}
                  {!item.required && !item.added ? <p className="text-sm text-mute">Can be added when you list a car.</p> : null}
                </div>
              </div>
              {showAction ? (
                item.key === "identity" ? (
                  <div className="w-full sm:w-auto [&_button]:w-full sm:[&_button]:w-auto">{identityAction}</div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 w-full sm:w-auto"
                    aria-expanded={open === panel}
                    aria-controls={`panel-${panel}`}
                    aria-label={`${label}: ${item.label}`}
                    onClick={() => setOpen((o) => (o === panel ? null : panel!))}
                  >
                    {label}
                  </Button>
                )
              ) : null}
            </div>
            {panel && editable && item.key === lastOf(panel) ? (
              <div id={`panel-${panel}`} className={cn("border-t border-line p-3", open === panel ? "block" : "hidden")}>
                {panels[panel]}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function actionLabel(item: InputItem): string {
  if (item.key === "vin_photo" || item.key === "dashboard_photo") return item.added ? "Retake" : "Start";
  if (item.key === "identity") return "Start";
  return item.added ? "Replace" : "Add";
}
