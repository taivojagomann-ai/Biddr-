import "server-only";
import type { ImageSearch } from "./compare";
import { VISION_USD_PER_IMAGE } from "./costs";

/**
 * Reverse image search with Google Cloud Vision (WEB_DETECTION) over the listing's
 * public photos: are they on other websites? Only the photo URLs are sent (they're
 * public already). Exact copies on car classifieds sites are a strong sign of a fake
 * listing; anything else is a soft signal. Only page URLs and counts are kept.
 */

/** Hosts of car classifieds sites (and their subdomains). */
const CLASSIFIEDS = [
  "mobile.de", "autoscout24", "auto24.ee", "auto24.lv", "auto24.lt", "ss.lv", "ss.com", "autoplius.lt", "kleinanzeigen.de",
  "ebay.", "olx.", "leboncoin.fr", "lacentrale.fr", "subito.it", "marktplaats.nl", "2dehands.be", "blocket.se", "finn.no",
  "tori.fi", "nettiauto.com", "bilbasen.dk", "dba.dk", "otomoto.pl", "sauto.cz", "bazos.", "hasznaltauto.hu", "autovit.ro",
  "carvago.com", "car.gr", "standvirtual.com", "coches.net", "milanuncios.com", "wallapop.com", "donedeal.ie", "autotrader.",
  "pistonheads.com", "carandclassic.com", "classic-trader.com", "carsandbids.com", "bringatrailer.com", "collectingcars.com",
  "catawiki.", "willhaben.at", "facebook.com/marketplace",
];

export function visionConfigured(): boolean {
  return Boolean(process.env.GOOGLE_VISION_API_KEY);
}

/** How many of the listing's photos are searched (cost: each is one Vision unit). */
export const PHOTOS_SEARCHED = 4;

function isOwnHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    const own = [process.env.NEXT_PUBLIC_SITE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL]
      .filter(Boolean)
      .map((u) => new URL(u!).hostname);
    return own.includes(host) || host === "localhost" || host === "127.0.0.1" || host.endsWith(".supabase.co");
  } catch {
    return true;
  }
}

function isClassifieds(url: string): boolean {
  const u = url.toLowerCase();
  return CLASSIFIEDS.some((c) => u.includes(c));
}

interface WebEntity {
  url?: string;
}
interface WebDetection {
  fullMatchingImages?: WebEntity[];
  partialMatchingImages?: WebEntity[];
  pagesWithMatchingImages?: { url?: string; fullMatchingImages?: WebEntity[]; partialMatchingImages?: WebEntity[] }[];
}

export async function searchPhotos(photoUrls: string[]): Promise<{ result: ImageSearch; units: number; costUsd: number }> {
  const urls = photoUrls.slice(0, PHOTOS_SEARCHED);
  const base = process.env.GOOGLE_VISION_BASE_URL?.replace(/\/+$/, "") || "https://vision.googleapis.com";
  const res = await fetch(`${base}/v1/images:annotate?key=${encodeURIComponent(process.env.GOOGLE_VISION_API_KEY!)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requests: urls.map((u) => ({ image: { source: { imageUri: u } }, features: [{ type: "WEB_DETECTION", maxResults: 20 }] })),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Google Vision answered ${res.status}`);
  const body = (await res.json()) as { responses?: { webDetection?: WebDetection; error?: { message?: string } }[] };
  const fullOnClassifieds = new Set<string>();
  const fullElsewhere = new Set<string>();
  let partialCount = 0;
  for (const r of body.responses ?? []) {
    const web = r.webDetection;
    if (!web) continue;
    for (const page of web.pagesWithMatchingImages ?? []) {
      if (!page.url || isOwnHost(page.url)) continue;
      if (page.fullMatchingImages?.length) (isClassifieds(page.url) ? fullOnClassifieds : fullElsewhere).add(page.url);
      else if (page.partialMatchingImages?.length) partialCount += 1;
    }
    for (const img of web.fullMatchingImages ?? []) {
      if (img.url && !isOwnHost(img.url) && isClassifieds(img.url)) fullOnClassifieds.add(img.url);
    }
    partialCount += (web.partialMatchingImages ?? []).filter((i) => i.url && !isOwnHost(i.url)).length;
  }
  return {
    result: { fullOnClassifieds: [...fullOnClassifieds], fullElsewhere: [...fullElsewhere], partialCount, checkedPhotos: urls.length },
    units: urls.length,
    costUsd: urls.length * VISION_USD_PER_IMAGE,
  };
}
