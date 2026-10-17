// Gemma 4 via local Ollama, reached through the Vite proxy at /ollama.

export const MODEL = "gemma4:e2b";
const BASE = "/ollama";
const TIMEOUT_MS = 120_000;

export type EntryKind = "udhaar" | "jama";

export interface RawEntry {
  customer: string;
  amount: number;
  kind: EntryKind;
  date: string | null;
  item: string | null;
}

export interface Extraction {
  entries: RawEntry[];
  unreadable_lines: number;
}

/** Thrown when Gemma answers but the answer isn't usable. Carries the raw text. */
export class GemmaParseError extends Error {
  constructor(public raw: string) {
    super("Gemma's answer was not valid ledger JSON.");
  }
}

export class OllamaDownError extends Error {
  constructor(message = "Ollama is not running. Start it with: ollama serve") {
    super(message);
  }
}

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          customer: { type: "string" },
          amount: { type: "number" },
          kind: { type: "string", enum: ["udhaar", "jama"] },
          date: { type: ["string", "null"] },
          item: { type: ["string", "null"] },
        },
        required: ["customer", "amount", "kind", "date", "item"],
      },
    },
    unreadable_lines: { type: "integer" },
  },
  required: ["entries", "unreadable_lines"],
} as const;

const EXTRACTION_SYSTEM = `You read photos of handwritten Indian shop credit notebooks (udhaar khata).
Each line usually has: date, customer name, item(s), amount in rupees.
Rules:
- A line naming a customer with an amount is "udhaar" (credit given to the customer).
- If the line says jama, paid, diya, received, or similar, it is "jama" (payment received from the customer).
- Read numbers literally, exactly as written. Do not add, round or calculate.
- One entry per written line. Do not invent rows. Skip headings and totals.
- If the date or item is unclear or missing, set it to null. For jama lines, item is null.
- Count lines you cannot read at all in unreadable_lines.`;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}

interface ChatResponse {
  message?: { content?: string };
  error?: string;
}

async function chat(
  messages: ChatMessage[],
  extra: Record<string, unknown> = {},
  timeoutMs = TIMEOUT_MS,
): Promise<string> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        think: false,
        keep_alive: "15m",
        options: { temperature: 0.1 },
        ...extra,
      }),
    });
  } catch {
    if (controller.signal.aborted) {
      throw new Error("Gemma took longer than 2 minutes. Try again; the model may still be loading.");
    }
    throw new OllamaDownError();
  } finally {
    window.clearTimeout(timer);
  }
  const data = (await res.json().catch(() => ({}))) as ChatResponse;
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Model ${MODEL} not found. Run: ollama pull ${MODEL}`);
    if (data.error) throw new Error(data.error);
    // No JSON error body: the Vite proxy could not reach Ollama.
    if (res.status >= 500) throw new OllamaDownError();
    throw new Error(`Ollama error ${res.status}`);
  }
  return data.message?.content ?? "";
}

function parseExtraction(raw: string): Extraction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GemmaParseError(raw);
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Extraction).entries)) {
    throw new GemmaParseError(raw);
  }
  const p = parsed as { entries: unknown[]; unreadable_lines?: unknown };
  const entries: RawEntry[] = [];
  for (const e of p.entries) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const customer = typeof r.customer === "string" ? r.customer.trim() : "";
    const amount = typeof r.amount === "number" ? r.amount : Number(r.amount);
    if (!customer || !Number.isFinite(amount)) continue;
    entries.push({
      customer,
      amount: Math.abs(amount),
      kind: r.kind === "jama" ? "jama" : "udhaar",
      date: typeof r.date === "string" && r.date.trim() ? r.date.trim() : null,
      item: typeof r.item === "string" && r.item.trim() ? r.item.trim() : null,
    });
  }
  const unreadable = Number(p.unreadable_lines);
  return { entries, unreadable_lines: Number.isFinite(unreadable) ? unreadable : 0 };
}

/** Photo -> ledger entries. Retries once if the JSON is invalid. */
export async function extractEntries(imageBase64: string): Promise<Extraction> {
  const messages: ChatMessage[] = [
    { role: "system", content: EXTRACTION_SYSTEM },
    { role: "user", content: "Read every entry on this khata page.", images: [imageBase64] },
  ];
  let lastError: GemmaParseError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chat(messages, { format: EXTRACTION_SCHEMA });
    try {
      return parseExtraction(raw);
    } catch (err) {
      if (!(err instanceof GemmaParseError)) throw err;
      lastError = err;
    }
  }
  throw lastError ?? new GemmaParseError("");
}

export type GemmaStatus = "checking" | "loading" | "ready" | "down" | "no-model";

/** Checks Ollama, then loads the model into memory (empty messages = load only). */
export async function warmUp(onStatus: (s: GemmaStatus) => void): Promise<void> {
  onStatus("checking");
  try {
    const res = await fetch(`${BASE}/api/tags`);
    if (!res.ok) throw new OllamaDownError();
    const tags = (await res.json()) as { models?: { name: string }[] };
    if (!tags.models?.some((m) => m.name === MODEL)) {
      onStatus("no-model");
      return;
    }
  } catch {
    onStatus("down");
    return;
  }
  onStatus("loading");
  try {
    await chat([], {}, TIMEOUT_MS);
    onStatus("ready");
  } catch {
    onStatus("down");
  }
}
