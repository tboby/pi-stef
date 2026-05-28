import { Type, type Static } from "typebox";

/**
 * TypeBox schema for the JSON the researcher subprocess emits on stdout.
 *
 * `knownFacts`, `ambiguities`, and items in `external` accept BOTH plain
 * strings AND any object shape — Opus has used `fact`, `summary`,
 * `ambiguity`, `description` for the same body-text role across runs;
 * locking specific field names rejects good content. `normalizeAnalysisFields`
 * (below) probes a known set of body-field names and picks the first
 * non-empty string it finds.
 *
 * Root-level `additionalProperties` is intentionally permissive (future
 * fields like `confidence` / `reasoning` should not reject a payload).
 * `additionalProperties: false` is still set on the `openQuestions` element
 * so a malformed question (missing id, unknown kind, options where forbidden)
 * is caught early — that one we DO need to consume strictly.
 */
const StringOrObject = Type.Union([
  Type.String(),
  Type.Object({}, { additionalProperties: true }),
]);

export const ResearchAnalysisSchema = Type.Object({
  knownFacts: Type.Array(StringOrObject),
  ambiguities: Type.Array(StringOrObject),
  openQuestions: Type.Array(
    Type.Object(
      {
        id: Type.String({ minLength: 1 }),
        kind: Type.Union([Type.Literal("input"), Type.Literal("select")]),
        title: Type.String({ minLength: 1 }),
        options: Type.Optional(Type.Array(Type.String())),
        optional: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
  ),
  external: Type.Array(StringOrObject),
  notes: Type.Optional(Type.String()),
});

export type ResearchAnalysisFromSchema = Static<typeof ResearchAnalysisSchema>;

/**
 * Common field names a model may use for the body of a fact / ambiguity /
 * external entry. We probe in order and use the first string we find.
 */
const BODY_FIELD_CANDIDATES = [
  "summary",
  "fact",
  "ambiguity",
  "description",
  "text",
  "body",
  "content",
  "value",
] as const;

function extractBodyString(obj: Record<string, unknown>): string {
  for (const key of BODY_FIELD_CANDIDATES) {
    const v = obj[key];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  // Fallback: any string-valued property that isn't `id`/`kind`/`title`/`url`.
  for (const [k, v] of Object.entries(obj)) {
    if (k === "id" || k === "kind" || k === "title" || k === "url") continue;
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  // Last resort: JSON-stringify so the planner at least sees the raw payload.
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

function normalizeOne(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id : undefined;
    const body = extractBodyString(obj);
    return id ? `${id}: ${body}` : body;
  }
  return String(item);
}

export function normalizeAnalysisFields(parsed: ResearchAnalysisFromSchema): {
  knownFacts: string[];
  ambiguities: string[];
} {
  return {
    knownFacts: parsed.knownFacts.map(normalizeOne),
    ambiguities: parsed.ambiguities.map(normalizeOne),
  };
}

/** Normalize a single `external` entry into the consumer shape (kept loose for the same reason). */
export function normalizeExternalEntry(item: unknown): { url?: string; title?: string; summary: string } {
  if (typeof item === "string") return { summary: item };
  if (item && typeof item === "object") {
    const obj = item as Record<string, unknown>;
    return {
      url: typeof obj.url === "string" ? obj.url : undefined,
      title: typeof obj.title === "string" ? obj.title : undefined,
      summary: extractBodyString(obj),
    };
  }
  return { summary: String(item) };
}
