/**
 * The car makes offered in the sell form and the admin editor. A static, curated list
 * (no external import); a seller can still enter a make that isn't here ("Other"),
 * which admins see on the listing as a suggestion to add here in a future update.
 * Shared by the browser and the server, so both validate against the same list.
 */
export const CAR_MAKES = [
  "Abarth", "AC", "Acura", "Aiways", "Alfa Romeo", "Alpina", "Alpine", "Ariel", "Aston Martin", "Audi", "Austin",
  "Austin-Healey", "Autobianchi", "BAIC", "Bentley", "BMW", "Borgward", "Brabus", "Bristol", "Bugatti", "Buick", "BYD",
  "Cadillac", "Caterham", "Chevrolet", "Chrysler", "Citroën", "Cupra", "Dacia", "Daewoo", "Daihatsu", "Datsun",
  "De Tomaso", "DeLorean", "DFSK", "Dodge", "DongFeng", "Donkervoort", "DS", "Ferrari", "Fiat", "Fisker", "Ford",
  "Forthing", "GAZ", "Genesis", "GMC", "Great Wall", "Hennessey", "Hispano Suiza", "Holden", "Honda", "Hongqi",
  "Hummer", "Hyundai", "Ineos", "Infiniti", "Isuzu", "Iveco", "IZh", "Jaguar", "Jeep", "Jensen", "KGM", "Kia",
  "Koenigsegg", "KTM", "Lada", "Lamborghini", "Lancia", "Land Rover", "Leapmotor", "Lexus", "Lincoln", "Lotus", "Lucid",
  "Lynk & Co", "Mahindra", "Maserati", "Maxus", "Maybach", "Mazda", "McLaren", "Mercedes-AMG", "Mercedes-Benz",
  "Mercury", "MG", "Mini", "Mitsubishi", "Morgan", "Moskvich", "NIO", "Nissan", "Noble", "Oldsmobile", "Opel", "Pagani",
  "Peugeot", "Plymouth", "Polestar", "Pontiac", "Porsche", "RAM", "Renault", "Rimac", "Rolls-Royce", "Rover", "RUF",
  "Saab", "Saleen", "SEAT", "Shelby", "Škoda", "Skywell", "smart", "SsangYong", "Subaru", "Suzuki", "Tatra", "Tesla",
  "Toyota", "Trabant", "Triumph", "TVR", "UAZ", "Vauxhall", "Volkswagen", "Volvo", "Voyah", "Wartburg", "Wiesmann",
  "Xpeng", "Zastava", "ZAZ", "Zeekr",
] as const;

export type CarMake = (typeof CAR_MAKES)[number];

/** Shown first: when the field is empty, and ahead of other equally good matches. */
export const POPULAR_MAKES: readonly CarMake[] = [
  "Audi", "BMW", "Ford", "Mercedes-Benz", "Opel", "Porsche", "Škoda", "Toyota", "Volkswagen", "Volvo",
  "Mercedes-AMG", "Ferrari", "Lamborghini", "McLaren", "Aston Martin", "Lotus",
];

/** Other names people search with. */
export const MAKE_ALIASES: Readonly<Record<string, readonly CarMake[]>> = {
  vw: ["Volkswagen"],
  merc: ["Mercedes-Benz"],
  mercedes: ["Mercedes-Benz"],
  benz: ["Mercedes-Benz"],
  amg: ["Mercedes-AMG"],
  beemer: ["BMW"],
  bimmer: ["BMW"],
  chevy: ["Chevrolet"],
  "lada-vaz": ["Lada"],
  vaz: ["Lada"],
  zhiguli: ["Lada"],
  landy: ["Land Rover"],
  alfa: ["Alfa Romeo"],
  rolls: ["Rolls-Royce"],
  "ssang yong": ["SsangYong", "KGM"],
  citroen: ["Citroën"],
  skoda: ["Škoda"],
};

/** Lower case, no accents, words separated by single spaces: "Škoda" → "skoda", "Lynk & Co" → "lynk co". */
export function normalizeMake(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const compact = (s: string) => s.replace(/ /g, "");

type Entry = { make: CarMake; name: string; aliases: string[]; popular: number };

const ENTRIES: Entry[] = CAR_MAKES.map((make) => ({
  make,
  name: normalizeMake(make),
  aliases: Object.entries(MAKE_ALIASES)
    .filter(([, targets]) => targets.includes(make))
    .map(([alias]) => normalizeMake(alias)),
  popular: POPULAR_MAKES.indexOf(make) === -1 ? POPULAR_MAKES.length : POPULAR_MAKES.indexOf(make),
}));

/** The make from the list that this text means (its name or an alias, ignoring case and accents), if any. */
export function findMake(text: string): CarMake | null {
  const q = normalizeMake(text);
  if (!q) return null;
  const byName = ENTRIES.find((e) => e.name === q || compact(e.name) === compact(q));
  if (byName) return byName.make;
  const byAlias = ENTRIES.filter((e) => e.aliases.some((a) => a === q || compact(a) === compact(q)));
  return byAlias.length === 1 ? byAlias[0]!.make : null;
}

export function isCarMake(text: string): text is CarMake {
  return (CAR_MAKES as readonly string[]).includes(text);
}

/** How well an entry matches the query: lower is better; null is no match. */
function rank(e: Entry, q: string): number | null {
  const qc = compact(q);
  if (e.name === q || compact(e.name) === qc) return 0;
  if (e.aliases.some((a) => a === q || compact(a) === qc)) return 1;
  if (e.name.startsWith(q) || compact(e.name).startsWith(qc)) return 2;
  if (e.name.split(" ").some((w) => w.startsWith(q))) return 3;
  if (e.aliases.some((a) => a.startsWith(q) || compact(a).startsWith(qc) || a.split(" ").some((w) => w.startsWith(q)))) return 4;
  if (e.name.includes(q)) return 5;
  return null;
}

/**
 * Makes for the combobox. Empty query: the popular makes. Otherwise up to `limit` matches,
 * ignoring case, accents and punctuation, finding aliases too, with matches at the start
 * of the name or of a word first, then popular makes, then alphabetical order.
 */
export function searchMakes(query: string, limit = 10): CarMake[] {
  const q = normalizeMake(query);
  if (!q) return [...POPULAR_MAKES];
  return ENTRIES.map((e) => ({ e, r: rank(e, q) }))
    .filter((x): x is { e: Entry; r: number } => x.r !== null)
    .sort((a, b) => a.r - b.r || a.e.popular - b.e.popular || a.e.name.localeCompare(b.e.name))
    .slice(0, limit)
    .map((x) => x.e.make);
}
