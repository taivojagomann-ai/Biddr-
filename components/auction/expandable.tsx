"use client";
import { useId, useState } from "react";
import { PUBLIC_LIST_PREVIEW, formatMonth } from "@/lib/listing-details";
import { formatKm } from "@/lib/format";
import type { ServiceRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

function ShowAll({ total, expanded, onToggle, controls, noun }: { total: number; expanded: boolean; onToggle: () => void; controls: string; noun: string }) {
  if (total <= PUBLIC_LIST_PREVIEW) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={controls}
      className="mt-2 inline-flex min-h-11 items-center rounded-md px-1 text-sm font-semibold text-chalk underline underline-offset-4 hover:text-signal"
    >
      {expanded ? "Show fewer" : `Show all ${total} ${noun}`}
    </button>
  );
}

/** A bulleted list that shows the first 8 items until "Show all" is pressed. */
export function ExpandableList({ items, noun, className }: { items: string[]; noun: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const shown = expanded ? items : items.slice(0, PUBLIC_LIST_PREVIEW);
  return (
    <div>
      <ul id={id} className={cn("grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2", className)}>
        {shown.map((item, i) => (
          <li key={i} className="flex gap-2.5">
            <span aria-hidden className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-mute" />
            <span className="min-w-0 break-words">{item}</span>
          </li>
        ))}
      </ul>
      <ShowAll total={items.length} expanded={expanded} onToggle={() => setExpanded((e) => !e)} controls={id} noun={noun} />
    </div>
  );
}

/** Service history as a real table, newest first. Below sm the workshop moves under the work done. */
export function ServiceHistoryTable({ records, captionId }: { records: ServiceRecord[]; captionId: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const shown = expanded ? records : records.slice(0, PUBLIC_LIST_PREVIEW);
  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-line">
        <table id={id} aria-labelledby={captionId} className="w-full table-fixed border-collapse text-left text-sm">
          <thead className="bg-panel text-xs text-mute">
            <tr>
              <th scope="col" className="w-[5.5rem] px-3 py-2 font-semibold sm:w-28">
                Month
              </th>
              <th scope="col" className="w-[5.75rem] px-3 py-2 text-right font-semibold sm:w-32">
                Mileage
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Work
              </th>
              <th scope="col" className="hidden w-[30%] px-3 py-2 font-semibold sm:table-cell">
                Workshop
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((r, i) => (
              <tr key={`${r.date}-${i}`} className="align-top">
                <td className="whitespace-nowrap px-3 py-2.5 tabular">{formatMonth(r.date)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular">{formatKm(r.mileage_km)}</td>
                <td className="break-words px-3 py-2.5">
                  {r.description}
                  {r.workshop ? (
                    <span className="mt-0.5 block text-xs text-mute sm:hidden">
                      <span className="sr-only">Workshop: </span>
                      {r.workshop}
                    </span>
                  ) : null}
                </td>
                <td className="hidden break-words px-3 py-2.5 text-mute sm:table-cell">{r.workshop || (<><span aria-hidden>–</span><span className="sr-only">Not given</span></>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ShowAll total={records.length} expanded={expanded} onToggle={() => setExpanded((e) => !e)} controls={id} noun="services" />
    </div>
  );
}
