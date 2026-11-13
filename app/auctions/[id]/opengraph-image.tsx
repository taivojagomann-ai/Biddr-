import { ImageResponse } from "next/og";
import sharp from "sharp";
import { formatEur, formatKm } from "@/lib/format";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Auction } from "@/lib/types";

export const runtime = "nodejs";
export const alt = "Car auction on Biddr";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Pick<Auction, "title" | "status" | "current_bid" | "mileage_km" | "location_city" | "gallery_urls" | "is_demo">;

/** The cover as a JPEG data URL: the image renderer can't read WebP, which listings use. */
async function coverDataUrl(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(size.width, size.height, { fit: "cover" })
      .jpeg({ quality: 80 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}

function resultLine(a: Row): string {
  if (a.status === "live") return a.current_bid ? `Live · high bid ${formatEur(a.current_bid)}` : "Live auction";
  if (a.status === "upcoming") return "Upcoming auction";
  if (a.status === "sold" && a.current_bid) return `Sold for ${formatEur(a.current_bid)}`;
  if (a.status === "reserve_not_met") return "Ended · reserve not met";
  if (a.status === "withdrawn") return "Withdrawn";
  return "Auction ended";
}

export default async function OpengraphImage({ params }: { params: { id: string } }) {
  let a: Row | null = null;
  if (UUID_RE.test(params.id)) {
    const { data } = await getServerSupabase()
      .from("auctions")
      .select("title,status,current_bid,mileage_km,location_city,gallery_urls,is_demo")
      .eq("id", params.id)
      .maybeSingle<Row>();
    a = data ?? null;
  }
  const cover = await coverDataUrl(a?.gallery_urls?.exterior?.[0]);

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", position: "relative", background: "#0A0A0B", color: "#F4F4F5" }}>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- rendered to PNG by next/og, not the browser
          <img src={cover} alt="" width={size.width} height={size.height} style={{ position: "absolute", inset: 0, objectFit: "cover" }} />
        ) : null}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            background: "linear-gradient(180deg, rgba(10,10,11,0.15) 0%, rgba(10,10,11,0.55) 50%, rgba(10,10,11,0.95) 100%)",
          }}
        />
        <div style={{ position: "absolute", top: 40, left: 56, display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 800, letterSpacing: -1 }}>
            Biddr<span style={{ color: "#FF5500" }}>.</span>
          </div>
          {a?.is_demo ? (
            <div style={{ display: "flex", fontSize: 26, fontWeight: 700, padding: "6px 14px", borderRadius: 8, border: "2px solid #A1A1AA", background: "rgba(10,10,11,0.85)" }}>
              Demo listing
            </div>
          ) : null}
        </div>
        <div style={{ position: "absolute", left: 56, right: 56, bottom: 48, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 800, lineHeight: 1.05 }}>{a?.title ?? "Biddr"}</div>
          <div style={{ display: "flex", fontSize: 30, color: "#D4D4D8" }}>
            {a ? `${formatKm(a.mileage_km)} · ${a.location_city} · ${resultLine(a)}` : "Performance car auctions"}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
