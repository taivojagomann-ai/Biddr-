// END-TO-END TESTS ONLY: stand-ins for the Anthropic Messages API and Google Cloud
// Vision, so the fake-listing checks run without real keys, network or cost. The app
// build points at it with ANTHROPIC_BASE_URL and GOOGLE_VISION_BASE_URL.
//
// Claude's answer depends on the listing (the request's metadata.user_id is the
// listing's id): it reads the listing, the issued code and the seller from the local
// database and "reads" the matching values, changed by keywords in the car's MODEL:
//   redvin        the VIN plate shows another VIN            -> red
//   redcode       the paper shows another code              -> red
//   rednamex      someone else owns the car                 -> red (once the seller is verified)
//   yellowmileage the odometer is 5,000 km higher           -> yellow
//   lowconf       the odometer is read with low confidence by every model -> yellow
//   retryopus     low confidence from the first model only; claude-opus-5-5 reads it clearly
// Vision: photos whose URL contains "stolen" are found on mobile.de (a strong match).
// GET /__calls?listing=<id> lists the models that were called for a listing.

import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_APIS_PORT ?? 54330);
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY =
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const calls = new Map();

async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` } });
  if (!res.ok) throw new Error(`supabase ${res.status} ${path}`);
  return res.json();
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function claude(body) {
  const listingId = body.metadata?.user_id;
  const model = body.model;
  if (listingId) calls.set(listingId, [...(calls.get(listingId) ?? []), model]);
  const [auction] = await rest(`auctions?id=eq.${listingId}&select=vin,mileage_km,model,exterior_color,body_style,seller_id,seller_type,dealer_name`);
  const [v] = await rest(`listing_verifications?auction_id=eq.${listingId}&select=challenge_code,seller_is_owner`);
  const [seller] = auction ? await rest(`profiles?id=eq.${auction.seller_id}&select=full_name`) : [];
  const scenario = String(auction?.model ?? "").toLowerCase();
  const opus = model === "claude-opus-5-5";
  const read = {
    challenge_code: { value: scenario.includes("redcode") ? "ZZZZZZ" : (v?.challenge_code ?? null), confidence: "high" },
    plate_vin: { value: scenario.includes("redvin") ? "WBA00000000000000" : (auction?.vin ?? null), confidence: "high" },
    odometer: {
      value: (auction?.mileage_km ?? 0) + (scenario.includes("yellowmileage") ? 5000 : 120),
      unit: "km",
      confidence: scenario.includes("lowconf") || (scenario.includes("retryopus") && !opus) ? "low" : "high",
    },
    vehicle_colour: { value: auction?.exterior_color ?? null, confidence: "high" },
    body_type: { value: auction?.body_style ?? null, confidence: "medium" },
    certificate_vins: { values: auction ? [auction.vin] : [], confidence: "high" },
    certificate_owners: {
      values: [scenario.includes("rednamex") ? "Someone Else Entirely" : auction?.seller_type === "dealer" ? (auction.dealer_name ?? "") : (seller?.full_name ?? "")],
      confidence: "high",
    },
    authorisation: v && v.seller_is_owner === false ? { owner_name: "Owner Person", authorised_name: seller?.full_name ?? null, signed: true, confidence: "high" } : null,
  };
  return {
    id: `msg_e2e_${Date.now().toString(36)}`,
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: JSON.stringify(read) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 2400, output_tokens: 180, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

function vision(body) {
  return {
    responses: (body.requests ?? []).map((r) => {
      const uri = String(r.image?.source?.imageUri ?? "");
      if (!uri.includes("stolen")) return { webDetection: {} };
      return {
        webDetection: {
          fullMatchingImages: [{ url: "https://img.classistatic.de/api/v1/mo-prod/images/aa/stolen.jpg" }],
          pagesWithMatchingImages: [{ url: "https://suchen.mobile.de/fahrzeuge/details.html?id=123456", fullMatchingImages: [{ url: uri }] }],
        },
      };
    }),
  };
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });
    if (req.method === "GET" && url.pathname === "/__calls") return send(res, 200, calls.get(url.searchParams.get("listing")) ?? []);
    if (req.method === "POST" && url.pathname === "/v1/messages") {
      // The SDK sends the key as x-api-key or as a bearer token: accept only the test key.
      const key = String(req.headers["x-api-key"] ?? String(req.headers.authorization ?? "").replace(/^Bearer /, ""));
      if (!key.startsWith("sk-ant-e2e")) return send(res, 401, { type: "error", error: { type: "authentication_error", message: "test key only" } });
      return send(res, 200, await claude(JSON.parse(await readBody(req))));
    }
    if (req.method === "POST" && url.pathname === "/v1/images:annotate") {
      if (url.searchParams.get("key") !== "e2e-vision-key") return send(res, 403, { error: { message: "test key only" } });
      return send(res, 200, vision(JSON.parse(await readBody(req))));
    }
    send(res, 404, { error: "not mocked" });
  } catch (e) {
    send(res, 500, { type: "error", error: { type: "api_error", message: String(e) } });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`mock APIs on ${PORT}`));
