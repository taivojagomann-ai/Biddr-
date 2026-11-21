import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Extracted } from "./compare";
import { hasLowConfidence } from "./compare";
import { claudeCostUsd } from "./costs";

/**
 * Reads values from the challenge photos and the documents with Claude (vision), in a
 * strict JSON schema. The model only reads what is there, with a confidence for each
 * value; it is never told the expected code, VIN or name, and never decides anything
 * (lib/listing-checks/compare.ts does). Only what the checks need is sent; the raw
 * response isn't stored, only the parsed values.
 *
 * Model: ANTHROPIC_MODEL (default claude-sonnet-5-5). If any value comes back with
 * low confidence, the same request runs once more with claude-opus-5-5.
 */

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const RETRY_MODEL = "claude-opus-5-5";
/** Models that take server-side refusal fallbacks ("default" routing). */
const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5"]);

export function extractionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export interface InputFile {
  kind: "vin_photo" | "odometer_photo" | "registration" | "authorisation";
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  base64: string;
}

export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

const conf = z.enum(["high", "medium", "low"]);
const read = z.object({ value: z.string().nullable(), confidence: conf });
const extractedSchema = z.object({
  challenge_code: read,
  plate_vin: read,
  odometer: z.object({ value: z.number().nonnegative().nullable(), unit: z.enum(["km", "mi"]).nullable(), confidence: conf }),
  vehicle_colour: read,
  body_type: read,
  certificate_vins: z.object({ values: z.array(z.string()), confidence: conf }),
  certificate_owners: z.object({ values: z.array(z.string()), confidence: conf }),
  authorisation: z
    .object({ owner_name: z.string().nullable(), authorised_name: z.string().nullable(), signed: z.boolean().nullable(), confidence: conf })
    .nullable(),
});

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const nullableString = nullable({ type: "string" });
const confidenceSchema = { type: "string", enum: ["high", "medium", "low"] };
const readSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value", "confidence"],
  properties: { value: nullableString, confidence: confidenceSchema },
};
/** The JSON schema the response must follow (structured outputs). */
export const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["challenge_code", "plate_vin", "odometer", "vehicle_colour", "body_type", "certificate_vins", "certificate_owners", "authorisation"],
  properties: {
    challenge_code: readSchema,
    plate_vin: readSchema,
    odometer: {
      type: "object",
      additionalProperties: false,
      required: ["value", "unit", "confidence"],
      properties: { value: nullable({ type: "number" }), unit: nullable({ type: "string", enum: ["km", "mi"] }), confidence: confidenceSchema },
    },
    vehicle_colour: readSchema,
    body_type: readSchema,
    certificate_vins: {
      type: "object",
      additionalProperties: false,
      required: ["values", "confidence"],
      properties: { values: { type: "array", items: { type: "string" } }, confidence: confidenceSchema },
    },
    certificate_owners: {
      type: "object",
      additionalProperties: false,
      required: ["values", "confidence"],
      properties: { values: { type: "array", items: { type: "string" } }, confidence: confidenceSchema },
    },
    authorisation: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["owner_name", "authorised_name", "signed", "confidence"],
          properties: { owner_name: nullableString, authorised_name: nullableString, signed: nullable({ type: "boolean" }), confidence: confidenceSchema },
        },
      ],
    },
  },
} as const;

const LABELS: Record<InputFile["kind"], string> = {
  vin_photo: "Photo A: the car's VIN plate, with a paper showing a handwritten code.",
  odometer_photo: "Photo B: the car's dashboard showing the odometer, with the same paper.",
  registration: "The car's registration certificate (one page or several).",
  authorisation: "A signed authorisation from the registered owner allowing someone else to sell the car.",
};

const INSTRUCTIONS = `You read values from photos and documents for a car marketplace's fraud checks. Another system compares them; you never judge whether anything matches or is genuine.

Read exactly what is visible:
- challenge_code: the 6-character code handwritten on the paper in photo A and B (letters A-Z and digits 2-9). If the papers differ or it is unreadable, give your best reading with low confidence, or null.
- plate_vin: the 17-character VIN on the plate in photo A.
- odometer: the total distance on the dashboard in photo B (not a trip meter), as a number, and its unit (km or mi).
- vehicle_colour and body_type: what the car in the photos looks like (e.g. "dark blue", "estate"), or null if no body is visible.
- certificate_vins: every VIN printed on the registration certificate.
- certificate_owners: the registered owner's or keeper's names on the certificate, as written (people or companies).
- authorisation: from the owner's authorisation, if one is included: the owner's name, the name of the person authorised to sell, and whether it is signed. null if no authorisation is included.

For each value give a confidence: high (clearly legible), medium (legible with some doubt), low (guessing, blurred, partly hidden or cropped). Use null and low confidence for anything you cannot see. Never invent a value.`;

function client(): Anthropic {
  // ANTHROPIC_BASE_URL is read by the SDK too (the tests point it at a local mock).
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
}

function blocks(files: InputFile[]): Anthropic.Beta.Messages.BetaContentBlockParam[] {
  const out: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
  for (const f of files) {
    out.push({ type: "text", text: LABELS[f.kind] });
    out.push(
      f.mediaType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.base64 } }
        : { type: "image", source: { type: "base64", media_type: f.mediaType, data: f.base64 } },
    );
  }
  out.push({ type: "text", text: "Read the values now, following the JSON schema." });
  return out;
}

export class ExtractionError extends Error {}

async function readOnce(model: string, files: InputFile[], listingRef: string): Promise<{ extracted: Omit<Extracted, "images">; usage: Usage }> {
  const response = await client().beta.messages.create({
    model,
    max_tokens: 4000,
    system: INSTRUCTIONS,
    // The listing's id, as an opaque reference (no personal data).
    metadata: { user_id: listingRef },
    ...(FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content: blocks(files) }],
  });
  const served = response.model || model;
  const usage: Usage = {
    model: served,
    inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
    outputTokens: response.usage.output_tokens,
    costUsd: 0,
  };
  usage.costUsd = claudeCostUsd(served, usage.inputTokens, usage.outputTokens);
  if (response.stop_reason === "refusal") throw Object.assign(new ExtractionError("The model declined to read the images."), { usage });
  if (response.stop_reason === "max_tokens") throw Object.assign(new ExtractionError("The model's answer was cut off."), { usage });
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw Object.assign(new ExtractionError("The model returned no values."), { usage });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.text);
  } catch {
    throw Object.assign(new ExtractionError("The model's values weren't valid JSON."), { usage });
  }
  const checked = extractedSchema.safeParse(parsed);
  if (!checked.success) throw Object.assign(new ExtractionError("The model's values didn't follow the schema."), { usage });
  return { extracted: checked.data, usage };
}

/**
 * Reads the files with the configured model; once more with claude-opus-5-5 if any
 * value has low confidence. Returns the values to use and every call's usage.
 */
export async function extractValues(files: InputFile[], listingRef: string): Promise<{ extracted: Omit<Extracted, "images">; usage: Usage[] }> {
  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  const usage: Usage[] = [];
  const collect = (e: unknown) => {
    const u = (e as { usage?: Usage }).usage;
    if (u) usage.push(u);
  };
  let first: Omit<Extracted, "images"> | null = null;
  try {
    const r = await readOnce(model, files, listingRef);
    usage.push(r.usage);
    first = r.extracted;
    if (!hasLowConfidence({ ...first, images: null }) || model === RETRY_MODEL) return { extracted: first, usage };
  } catch (e) {
    collect(e);
    if (model === RETRY_MODEL) throw Object.assign(e as Error, { usage });
  }
  try {
    const r = await readOnce(RETRY_MODEL, files, listingRef);
    usage.push(r.usage);
    return { extracted: r.extracted, usage };
  } catch (e) {
    collect(e);
    if (first) return { extracted: first, usage };
    throw Object.assign(e as Error, { usage });
  }
}
