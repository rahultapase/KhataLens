// Ledger state: entries, customer balances, localStorage persistence.
import type { EntryKind, RawEntry } from "./gemma.ts";

export interface Entry {
  id: string;
  customer: string;
  item: string;
  date: string;
  amount: number;
  kind: EntryKind;
  /** Where the row came from; "gemma" rows can be marked as corrected. */
  source?: "gemma" | "manual";
  /** True once the shopkeeper changed a Gemma row by hand. */
  edited?: boolean;
}

export interface CustomerBalance {
  key: string;
  name: string;
  udhaar: number;
  jama: number;
  /** sum(udhaar) - sum(jama). Positive = customer owes the shop. */
  balance: number;
  entries: number;
}

const STORAGE_KEY = "khatalens.ledger.v1";

function newId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function customerKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function fromRaw(raw: RawEntry): Entry {
  return {
    id: newId(),
    customer: raw.customer,
    item: raw.item ?? "",
    date: raw.date ?? "",
    amount: raw.amount,
    kind: raw.kind,
  };
}

export function blankEntry(): Entry {
  return { id: newId(), customer: "", item: "", date: "", amount: 0, kind: "udhaar", source: "manual" };
}

export function load(): Entry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is Entry => !!e && typeof e === "object" && typeof (e as Entry).id === "string")
      .map((e) => ({
        id: e.id,
        customer: String(e.customer ?? ""),
        item: String(e.item ?? ""),
        date: String(e.date ?? ""),
        amount: Number.isFinite(Number(e.amount)) ? Number(e.amount) : 0,
        kind: e.kind === "jama" ? ("jama" as const) : ("udhaar" as const),
        source: e.source === "gemma" ? ("gemma" as const) : ("manual" as const),
        edited: e.edited === true,
      }));
  } catch {
    return [];
  }
}

export function save(entries: Entry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or blocked (private mode). The ledger still works for this visit.
  }
}

/** Groups by trimmed, case-insensitive name. Sorted by amount owed, highest first. */
export function balances(entries: Entry[]): CustomerBalance[] {
  const map = new Map<string, CustomerBalance>();
  for (const e of entries) {
    const key = customerKey(e.customer);
    if (!key) continue;
    let c = map.get(key);
    if (!c) {
      c = { key, name: e.customer.trim().replace(/\s+/g, " "), udhaar: 0, jama: 0, balance: 0, entries: 0 };
      map.set(key, c);
    }
    const amt = Number.isFinite(e.amount) ? Math.abs(e.amount) : 0;
    if (e.kind === "jama") c.jama += amt;
    else c.udhaar += amt;
    c.entries += 1;
  }
  const list = [...map.values()];
  for (const c of list) c.balance = round2(c.udhaar - c.jama);
  return list.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
}

/** What the shop still has to collect: the sum of positive balances. */
export function totalOwed(list: CustomerBalance[]): number {
  return round2(list.reduce((sum, c) => sum + Math.max(0, c.balance), 0));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

export function formatINR(n: number): string {
  return inr.format(n);
}
