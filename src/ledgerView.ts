// Ledger UI: the editable table. Balance changes are published to listeners.
// All user and model text goes in via textContent / value, never innerHTML.
import { balances, blankEntry, fromRaw, load, save, type CustomerBalance, type Entry } from "./ledger.ts";
import type { RawEntry } from "./gemma.ts";

type Listener = (list: CustomerBalance[]) => void;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export class LedgerView {
  private entries: Entry[] = load();
  private listeners: Listener[] = [];

  constructor(
    private tbody: HTMLTableSectionElement,
    private tableWrap: HTMLElement,
    private emptyState: HTMLElement,
    private countEl: HTMLElement,
  ) {
    this.renderTable();
    this.renderBalances();
  }

  onBalancesChange(fn: Listener): void {
    this.listeners.push(fn);
    fn(balances(this.entries));
  }

  get size(): number {
    return this.entries.length;
  }

  addFromGemma(raw: RawEntry[]): void {
    this.entries.push(...raw.map(fromRaw));
    this.commit(true);
  }

  addBlank(): void {
    const entry = blankEntry();
    this.entries.push(entry);
    this.commit(true);
    this.tbody.querySelector<HTMLInputElement>(`[data-id="${entry.id}"] input`)?.focus();
  }

  clear(): void {
    this.entries = [];
    this.commit(true);
  }

  private commit(rerenderTable: boolean): void {
    save(this.entries);
    if (rerenderTable) this.renderTable();
    this.renderBalances();
  }

  private update(id: string, patch: Partial<Entry>): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    Object.assign(entry, patch);
    this.commit(false);
  }

  private remove(id: string, rowIndex: number): void {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.commit(true);
    // Keep keyboard focus nearby after the row disappears.
    const rows = this.tbody.querySelectorAll<HTMLTableRowElement>("tr");
    const next = rows[Math.min(rowIndex, rows.length - 1)];
    (next?.querySelector<HTMLButtonElement>(".row-delete") ?? document.getElementById("add-row"))?.focus();
  }

  private renderTable(): void {
    const rows = this.entries.map((entry, i) => this.row(entry, i));
    this.tbody.replaceChildren(...rows);
    const empty = this.entries.length === 0;
    this.emptyState.hidden = !empty;
    this.tableWrap.hidden = empty;
    this.countEl.textContent = `${this.entries.length} ${this.entries.length === 1 ? "entry" : "entries"}`;
  }

  private row(entry: Entry, index: number): HTMLTableRowElement {
    const n = index + 1;
    const field = (
      key: "customer" | "item" | "date",
      label: string,
      extra: Partial<HTMLInputElement> = {},
    ): HTMLTableCellElement => {
      const id = `${key}-${entry.id}`;
      const input = el("input", { id, type: "text", value: entry[key], autocomplete: "off", ...extra });
      input.addEventListener("input", () => this.update(entry.id, { [key]: input.value }));
      return el(
        "td",
        { className: `col-${key}` },
        el("label", { htmlFor: id, className: "cell-label" }, label, el("span", { className: "visually-hidden" }, `, row ${n}`)),
        input,
      );
    };

    const amountId = `amount-${entry.id}`;
    const amount = el("input", {
      id: amountId,
      type: "number",
      inputMode: "decimal",
      min: "0",
      step: "any",
      value: String(entry.amount),
    });
    amount.addEventListener("input", () => {
      const v = Number(amount.value);
      this.update(entry.id, { amount: Number.isFinite(v) ? Math.abs(v) : 0 });
    });

    const kind = el("button", { type: "button", className: "kind-toggle" });
    const paintKind = (k: Entry["kind"]): void => {
      kind.dataset.kind = k;
      kind.textContent = k === "jama" ? "Jama" : "Udhaar";
      kind.setAttribute(
        "aria-label",
        k === "jama"
          ? `Row ${n}: jama (payment received). Switch to udhaar`
          : `Row ${n}: udhaar (credit given). Switch to jama`,
      );
    };
    paintKind(entry.kind);
    kind.addEventListener("click", () => {
      const next = entry.kind === "jama" ? "udhaar" : "jama";
      this.update(entry.id, { kind: next });
      paintKind(next);
      tr.dataset.kind = next;
    });

    const del = el("button", { type: "button", className: "row-delete btn-icon" }, "Delete");
    del.setAttribute("aria-label", `Delete row ${n}`);
    del.addEventListener("click", () => this.remove(entry.id, index));

    const tr = el(
      "tr",
      {},
      field("date", "Date", { placeholder: "dd/mm", inputMode: "numeric" }),
      field("customer", "Customer", { placeholder: "Name" }),
      field("item", "Item"),
      el(
        "td",
        { className: "col-amount" },
        el("label", { htmlFor: amountId, className: "cell-label" }, "Amount (₹)", el("span", { className: "visually-hidden" }, `, row ${n}`)),
        amount,
      ),
      el("td", { className: "col-kind" }, kind),
      el("td", { className: "col-actions" }, del),
    );
    tr.dataset.id = entry.id;
    tr.dataset.kind = entry.kind;
    return tr;
  }

  private renderBalances(): void {
    const list = balances(this.entries);
    for (const fn of this.listeners) fn(list);
  }
}
