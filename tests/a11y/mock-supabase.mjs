// A tiny stand-in for the Supabase REST, Auth and Storage APIs, so the
// accessibility test can render every page with realistic data and no secrets.
// Only what the pages read is implemented; writes return empty success.
//
//   node tests/a11y/mock-supabase.mjs        (listens on MOCK_SUPABASE_PORT, default 54329)
import http from "node:http";
import zlib from "node:zlib";

const PORT = Number(process.env.MOCK_SUPABASE_PORT ?? 54329);
const BASE = `http://127.0.0.1:${PORT}`;
export const ACCESS_TOKEN = "a11y-test-access-token";

const ME = "00000000-0000-4000-8000-0000000000aa";
const SELLER = "00000000-0000-4000-8000-0000000000bb";
const BIDDER = "00000000-0000-4000-8000-0000000000cc";
const now = Date.now();
const iso = (ms) => new Date(now + ms).toISOString();
const H = 3_600_000;
const photo = (name) => `${BASE}/storage/v1/object/public/auction-photos/${SELLER}/d/${name}.webp`;
const gallery = (p) => ({
  exterior: [1, 2, 3, 4, 5, 6].map((i) => photo(`${p}-ext-${i}`)),
  interior: [1, 2, 3, 4].map((i) => photo(`${p}-int-${i}`)),
  mechanical: [1, 2].map((i) => photo(`${p}-mech-${i}`)),
});

const base = {
  variant: null, engine: "3.0 inline-6 twin-turbo, 510 hp", transmission: "8-speed automatic", drivetrain: "AWD",
  exterior_color: "Isle of Man Green", location_country: "EE", damage_history_summary: null,
  inspection_partner_name: null, inspection_report_url: null, inspection_date: null, inspection_highlights: [],
  before_photos_urls: [], video_url: null, has_reserve: false, reserve_met: false, current_bid: null,
  leading_bidder_id: null, bid_count: 0, min_bid_increment: 250, created_at: iso(-72 * H), updated_at: iso(-H),
  seller: { username: "baltic_m", country: "EE" },
};

const AUCTIONS = [
  {
    ...base, id: "10000000-0000-4000-8000-000000000001", seller_id: SELLER, title: "2022 BMW M3 Competition xDrive",
    make: "BMW", model: "M3", variant: "Competition xDrive", year: 2022, vin: "WBS43AY0X0FN12345", mileage_km: 18400,
    location_city: "Tallinn", condition_type: "clean", inspection_partner_name: "Autotest Tallinn",
    inspection_report_url: `${BASE}/storage/v1/object/public/inspection-reports/r1.pdf`, inspection_date: "2026-11-02",
    inspection_highlights: ["Paint thickness measured on all panels", "Brakes at 80%", "No fault codes stored"],
    gallery_urls: gallery("m3"), video_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    starting_bid: 45000, current_bid: 52500, bid_count: 6, leading_bidder_id: BIDDER, has_reserve: true, reserve_met: true,
    starts_at: iso(-5 * 24 * H), ends_at: iso(2 * H), status: "live",
  },
  {
    ...base, id: "10000000-0000-4000-8000-000000000002", seller_id: SELLER, title: "2019 Audi RS 4 Avant",
    make: "Audi", model: "RS 4", variant: "Avant", year: 2019, vin: "WUAZZZF41KA912345", mileage_km: 61200,
    location_city: "Riga", location_country: "LV", condition_type: "restored_accident",
    damage_history_summary: "Front-left impact in 2023. Bonnet, wing and headlight replaced at a main-dealer body shop. Airbags did not deploy.",
    inspection_partner_name: "Riga Motor Lab", inspection_report_url: `${BASE}/storage/v1/object/public/inspection-reports/r2.pdf`,
    inspection_highlights: ["Chassis measured within factory tolerance"], gallery_urls: gallery("rs4"),
    before_photos_urls: [photo("rs4-before-1"), photo("rs4-before-2")], starting_bid: 30000, has_reserve: false,
    starts_at: iso(-2 * 24 * H), ends_at: iso(30 * H), status: "live",
  },
  {
    ...base, id: "10000000-0000-4000-8000-000000000003", seller_id: SELLER, title: "2021 Porsche 911 Carrera S",
    make: "Porsche", model: "911", year: 2021, vin: "WP0ZZZ99ZMS212345", mileage_km: 22100, location_city: "Vilnius",
    location_country: "LT", condition_type: "clean", gallery_urls: gallery("911"), starting_bid: 95000,
    starts_at: iso(20 * H), ends_at: iso(7 * 24 * H), status: "upcoming",
  },
  {
    ...base, id: "10000000-0000-4000-8000-000000000004", seller_id: SELLER, title: "2018 Mercedes-AMG C 63 S",
    make: "Mercedes-AMG", model: "C 63 S", year: 2018, vin: "WDD2050871F512345", mileage_km: 74000,
    location_city: "Tallinn", condition_type: "clean", gallery_urls: gallery("c63"), starting_bid: 38000,
    current_bid: 44750, bid_count: 11, reserve_met: true, has_reserve: true,
    starts_at: iso(-9 * 24 * H), ends_at: iso(-2 * 24 * H), status: "sold",
  },
  // The signed-in test user's own listings.
  {
    ...base, id: "10000000-0000-4000-8000-000000000005", seller_id: ME, title: "2020 BMW M2 Competition",
    make: "BMW", model: "M2", variant: "Competition", year: 2020, vin: "WBS2U710X07E12345", mileage_km: 35500,
    location_city: "Tartu", condition_type: "restored_accident",
    damage_history_summary: "Rear bumper and boot lid replaced after a low-speed impact. Airbags did not deploy.",
    gallery_urls: gallery("m2"), before_photos_urls: [photo("m2-before-1"), photo("m2-before-2")], starting_bid: 40000,
    starts_at: null, ends_at: null, status: "draft", seller: { username: "test_admin", country: "EE" },
  },
  {
    ...base, id: "10000000-0000-4000-8000-000000000006", seller_id: ME, title: "2016 Audi RS 3 Sportback",
    make: "Audi", model: "RS 3", year: 2016, vin: "WUAZZZ8V7GA912345", mileage_km: 98000, location_city: "Tartu",
    condition_type: "clean", gallery_urls: gallery("rs3"), starting_bid: 25000, starts_at: null, ends_at: null,
    status: "rejected", seller: { username: "test_admin", country: "EE" },
  },
];

const PROFILES = [
  { id: ME, username: "test_admin", country: "EE", role: "admin", is_verified_bidder: true, full_name: "Test Admin", phone: "+37251234567", created_at: iso(-400 * H) },
  { id: SELLER, username: "baltic_m", country: "EE", role: "user", is_verified_bidder: false, full_name: "Mari Maasikas", phone: "+37255555555", created_at: iso(-900 * H) },
  { id: BIDDER, username: "rs_fan", country: "LV", role: "user", is_verified_bidder: true, full_name: "Jānis Bērziņš", phone: null, created_at: iso(-300 * H) },
];

const COMMENTS = [
  { id: "20000000-0000-4000-8000-000000000001", auction_id: AUCTIONS[0].id, user_id: BIDDER, parent_id: null,
    content: "Has the gearbox been serviced?", is_seller_reply: false, created_at: iso(-30 * H), author: { username: "rs_fan", role: "user" } },
  { id: "20000000-0000-4000-8000-000000000002", auction_id: AUCTIONS[0].id, user_id: SELLER, parent_id: "20000000-0000-4000-8000-000000000001",
    content: "Yes, at 15,000 km at the dealer. The invoice is in the photos.", is_seller_reply: true, created_at: iso(-29 * H), author: { username: "baltic_m", role: "user" } },
];

const BIDS = [52500, 51000, 50000, 48000, 46500, 45000].map((amount, i) => ({
  id: `30000000-0000-4000-8000-00000000000${i + 1}`, auction_id: AUCTIONS[0].id, amount, created_at: iso(-(i * 5 + 1) * H),
  bidder_id: i % 2 ? ME : BIDDER, username: i % 2 ? "test_admin" : "rs_fan", country: i % 2 ? "EE" : "LV",
  bidder: { username: i % 2 ? "test_admin" : "rs_fan" },
}));

const TABLES = {
  auctions: AUCTIONS,
  profiles: PROFILES,
  comments: COMMENTS,
  bids: BIDS,
  bid_holds: [],
  auction_private: [{ auction_id: AUCTIONS[4].id, reserve_price: null, requested_reserve: 48000, inspection_city: "Tallinn",
    inspection_preferred_dates: "Weekday mornings", admin_notes: null, contact_notes: null, rejection_reason: null },
    { auction_id: AUCTIONS[5].id, rejection_reason: "The photos don't show the underside. Add them and submit again.", auction: { seller_id: ME } }],
  admin_actions: [],
};

const USER = { id: ME, aud: "authenticated", role: "authenticated", email: "test.admin@example.com",
  app_metadata: { provider: "email" }, user_metadata: {}, created_at: iso(-400 * H) };

// --- tiny PNG for every storage image ---------------------------------------
function png(w, h) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = [0];
    for (let x = 0; x < w; x++) row.push(40 + ((x * 120) / w) | 0, 44 + ((y * 60) / h) | 0, 52);
    rows.push(Buffer.from(row));
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const IMAGE = png(96, 64);

// --- PostgREST-style filtering -------------------------------------------------
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
function applyFilters(rows, params) {
  let out = rows;
  for (const [key, raw] of params) {
    if (RESERVED.has(key) || key.includes(".")) continue; // embedded filters are ignored
    const [op, ...rest] = raw.split(".");
    const value = rest.join(".");
    if (op === "eq") out = out.filter((r) => String(r[key]) === value);
    else if (op === "neq") out = out.filter((r) => String(r[key]) !== value);
    else if (op === "in") {
      const set = new Set(value.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, "")));
      out = out.filter((r) => set.has(String(r[key])));
    }
  }
  const limit = Number(params.get("limit"));
  return limit > 0 ? out.slice(0, limit) : out;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", BASE);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,HEAD,OPTIONS",
      "Access-Control-Allow-Headers": "*",
    });
    return res.end();
  }

  if (path.startsWith("/storage/v1/object/public/")) {
    if (path.endsWith(".pdf")) {
      res.writeHead(200, { "Content-Type": "application/pdf" });
      return res.end("%PDF-1.4\n%%EOF\n");
    }
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" });
    return res.end(IMAGE);
  }
  if (path.startsWith("/storage/v1/")) return send(res, 200, { Key: "ok" });

  if (path === "/auth/v1/user") {
    const auth = req.headers.authorization ?? "";
    return auth === `Bearer ${ACCESS_TOKEN}` ? send(res, 200, USER) : send(res, 401, { code: 401, msg: "Invalid token" });
  }
  if (path.startsWith("/auth/v1/admin/users/")) {
    const id = path.split("/").pop();
    return id === ME ? send(res, 200, USER) : send(res, 200, { ...USER, id, email: "mari.maasikas@example.com" });
  }
  if (path.startsWith("/auth/v1/")) return send(res, 200, {});

  if (path === "/rest/v1/rpc/server_time") return send(res, 200, new Date().toISOString());
  if (path === "/rest/v1/rpc/get_bid_history") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const id = JSON.parse(body || "{}").p_auction_id;
    return send(res, 200, BIDS.filter((b) => b.auction_id === id));
  }
  if (path.startsWith("/rest/v1/rpc/")) return send(res, 200, null);

  const table = path.replace("/rest/v1/", "");
  const rows = TABLES[table];
  if (!rows) return send(res, 404, { message: `mock: unknown table ${table}` });
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 201, []);

  const result = applyFilters(rows, url.searchParams);
  const range = { "Content-Range": `0-${Math.max(0, result.length - 1)}/${result.length}` };
  if (req.method === "HEAD") return send(res, 200, undefined, range);
  if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) {
    return result.length === 1
      ? send(res, 200, result[0], range)
      : send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
  }
  return send(res, 200, result, range);
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock supabase on ${BASE}`));
