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
- Decide every line on its own, never from the lines around it. A line with goods (atta, dal, doodh, tel, ande, chai...) is always "udhaar".
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

/** An "item" that is really a payment note: jama, paid, diya, received, cash... */
const PAYMENT_WORDS = /^(jama|jma|paid|pay|payment|diya|diye|di|received|recd|rcvd|wapas|cash|upi|online)\b[\s.:-]*\d*\s*$/i;

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
    let item = typeof r.item === "string" && r.item.trim() ? r.item.trim() : null;
    let kind: EntryKind = r.kind === "jama" ? "jama" : "udhaar";
    // Khata rule, applied in code because the model can drift into labelling a
    // run of lines the same way: a payment word means jama; real goods mean udhaar.
    if (item && PAYMENT_WORDS.test(item)) {
      kind = "jama";
      item = null;
    } else if (item) {
      kind = "udhaar";
    }
    entries.push({
      customer,
      amount: Math.abs(amount),
      kind,
      date: typeof r.date === "string" && r.date.trim() ? r.date.trim() : null,
      item,
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

export type Tone = "polite" | "friendly" | "firm";

const TONE_GUIDE: Record<Tone, string> = {
  polite: "Polite: warm, humble and gentle. No deadline.",
  friendly: "Friendly: casual and cheerful, like a neighbourhood shopkeeper who knows them well (for example 'kaise ho', 'jab time mile'). No deadline.",
  firm: "Firm but respectful: clearly ask them to clear the amount is hafte (this week). Still courteous, never rude.",
};

const REMINDER_SYSTEM = `You write short WhatsApp payment reminders for a small Indian kirana shop.
Write in Roman-script Hinglish: mostly Hindi words written in English letters, with a few simple English words. Never use Devanagari. Do not write the whole message in English.
Language example only (match the language mix, but use your own wording and follow the requested tone): "Namaste Sunil ji, Gupta Kirana se yaad dila rahe hain ki aapka ₹250 baaki hai. Jab suvidha ho, chuka dijiye. Dhanyavaad!"
Rules:
- At most 60 words.
- Always respectful. Use "ji". No threats, no shaming, no guilt, no legal words, no mention of other customers.
- Must include the customer's name, the exact amount written as given (for example "₹370"), and the shop name.
- Do not mention UPI or payment apps; that is added separately.
- Output only the message text. No quotes, no title, no notes, no options.`;

export interface ReminderInput {
  name: string;
  amount: string; // already formatted, e.g. "₹370"
  shop: string;
  tone: Tone;
}

function cleanText(raw: string): string {
  return raw
    .trim()
    .replace(/^(message|reminder)\s*:\s*/i, "")
    .replace(/\*\*/g, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
}

function digits(s: string): string {
  return s.replace(/[^\d.]/g, "").replace(/\.0+$/, "");
}

function reminderOk(text: string, input: ReminderInput): boolean {
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean).length;
  return (
    words > 5 &&
    words <= 70 &&
    lower.includes(input.name.toLowerCase()) &&
    text.replace(/,/g, "").includes(digits(input.amount)) &&
    lower.includes(input.shop.toLowerCase()) &&
    !/[\u0900-\u097F]/.test(text)
  );
}

/** Deterministic message used only if Gemma's answer misses the name, amount or shop twice. */
export function templateReminder({ name, amount, shop, tone }: ReminderInput): string {
  switch (tone) {
    case "friendly":
      return `Namaste ${name} ji! ${shop} se yaad dila rahe the, aapka ${amount} baaki hai. Jab bhi time mile, de dijiye. Shukriya!`;
    case "firm":
      return `Namaste ${name} ji, ${shop} ki taraf se: aapka ${amount} kaafi din se baaki hai. Kripya is hafte tak clear kar dijiye. Dhanyavaad.`;
    default:
      return `Namaste ${name} ji, ${shop} se vinamra nivedan hai ki aapka ${amount} baaki hai. Suvidha anusaar chuka dijiye. Dhanyavaad.`;
  }
}

/** Customer balance -> short Hinglish reminder. Retries once, then falls back to a template. */
export async function writeReminder(input: ReminderInput): Promise<{ text: string; fromTemplate: boolean }> {
  const user = `Customer: ${input.name}
Amount due: ${input.amount}
Shop name: ${input.shop}
Tone: ${TONE_GUIDE[input.tone]}
Write the reminder.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = cleanText(
      await chat([
        { role: "system", content: REMINDER_SYSTEM },
        { role: "user", content: user },
      ]),
    );
    if (reminderOk(text, input)) return { text, fromTemplate: false };
  }
  return { text: templateReminder(input), fromTemplate: true };
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
