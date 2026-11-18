import { COMPANY } from "@/lib/company";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface EmailContent {
  subject: string;
  /** Short line shown before the email is opened. */
  preview: string;
  heading: string;
  paragraphs: string[];
  /** Label: value rows, e.g. the buyer's contact details. */
  details?: { label: string; value: string }[];
  button?: { label: string; href: string };
}

/** The email as HTML (simple tables and inline styles, for every email client) and plain text. */
export function renderEmail(c: EmailContent): { subject: string; html: string; text: string } {
  const details = c.details?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse;width:100%">${c.details
        .map(
          (d) =>
            `<tr><td style="padding:6px 12px 6px 0;color:#5f6168;font-size:14px;vertical-align:top;white-space:nowrap">${esc(d.label)}</td><td style="padding:6px 0;color:#0f0f12;font-size:14px;font-weight:600">${esc(d.value)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const button = c.button
    ? `<p style="margin:24px 0"><a href="${esc(c.button.href)}" style="display:inline-block;background:#FF5A0A;color:#0A0A0B;font-weight:700;font-size:15px;text-decoration:none;padding:12px 20px;border-radius:6px">${esc(c.button.label)}</a></p>`
    : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#f2f2f4;font-family:Arial,Helvetica,sans-serif">
<span style="display:none;max-height:0;overflow:hidden">${esc(c.preview)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f4;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:#0A0A0B;padding:18px 24px;color:#ffffff;font-size:22px;font-weight:800">Biddr<span style="color:#FF5A0A">.</span></td></tr>
<tr><td style="padding:24px;color:#0f0f12;font-size:15px;line-height:1.5">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${esc(c.heading)}</h1>
${c.paragraphs.map((p) => `<p style="margin:0 0 12px">${esc(p)}</p>`).join("")}
${details}${button}
</td></tr>
<tr><td style="padding:16px 24px;background:#f7f7f8;color:#5f6168;font-size:12px;line-height:1.5">
You're getting this email about your purchase or sale on Biddr.<br>
${esc(COMPANY.name)} · Registry code ${esc(COMPANY.registryCode)} · ${esc(COMPANY.addressLines.join(", "))}
</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    c.heading,
    "",
    ...c.paragraphs.flatMap((p) => [p, ""]),
    ...(c.details?.length ? [...c.details.map((d) => `${d.label}: ${d.value}`), ""] : []),
    ...(c.button ? [`${c.button.label}: ${c.button.href}`, ""] : []),
    "--",
    "You're getting this email about your purchase or sale on Biddr.",
    `${COMPANY.name} · Registry code ${COMPANY.registryCode} · ${COMPANY.addressLines.join(", ")}`,
  ].join("\n");
  return { subject: c.subject, html, text };
}
