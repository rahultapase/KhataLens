// Hisaab view: customer balance list (master) + reminder composer (detail).
// Model text only ever goes into textarea.value / textContent.
import { writeReminder, type Tone } from "./gemma.ts";
import { formatINR, totalOwed, type CustomerBalance } from "./ledger.ts";
import { isValidUpi, shopName, upiLink, type Settings } from "./settings.ts";

interface ReminderState {
  tone: Tone;
  text: string;
  busy: boolean;
  note: string;
}

const TONES: { value: Tone; label: string }[] = [
  { value: "polite", label: "Polite" },
  { value: "friendly", label: "Friendly" },
  { value: "firm", label: "Firm but respectful" },
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** Gemma's text plus a plain-text UPI line if one is set. */
export function finalMessage(text: string, settings: Settings): string {
  const body = text.trim();
  const upi = settings.upi.trim();
  if (!body || !isValidUpi(upi) || body.includes(upi)) return body;
  return `${body}\nUPI: ${upi}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  const ta = el("textarea", { value: text, readOnly: true });
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** Brief highlight on a value that just changed (CSS handles reduced motion). */
function bump(node: Element | null): void {
  if (!(node instanceof HTMLElement)) return;
  node.classList.remove("bump");
  void node.offsetWidth; // restart the animation
  node.classList.add("bump");
  node.addEventListener("animationend", () => node.classList.remove("bump"), { once: true });
}

function stateOf(c: CustomerBalance): "owes" | "advance" | "settled" {
  return c.balance > 0 ? "owes" : c.balance < 0 ? "advance" : "settled";
}

export class HisaabView {
  private state = new Map<string, ReminderState>();
  private customers: CustomerBalance[] = [];
  private selected: string | null = null;

  constructor(
    private list: HTMLElement,
    private totalEl: HTMLElement,
    private summaryEl: HTMLElement,
    private composer: HTMLElement,
    private section: HTMLElement,
    private getSettings: () => Settings,
  ) {}

  /** Last seen balances, to highlight values that just changed. */
  private prev = new Map<string, number>();
  private prevTotal: number | null = null;
  private changed = new Set<string>();

  update(customers: CustomerBalance[]): void {
    this.changed.clear();
    if (this.prev.size > 0) {
      for (const c of customers) {
        if (this.prev.has(c.key) && this.prev.get(c.key) !== c.balance) this.changed.add(c.key);
      }
    }
    this.prev = new Map(customers.map((c) => [c.key, c.balance]));
    const total = totalOwed(customers);
    if (this.prevTotal !== null && this.prevTotal !== total && customers.length > 0) bump(this.totalEl);
    this.prevTotal = total;
    this.customers = customers;
    const owing = customers.filter((c) => c.balance > 0);
    if (!this.selected || !customers.some((c) => c.key === this.selected)) {
      this.selected = owing[0]?.key ?? customers[0]?.key ?? null;
    }
    this.section.dataset.empty = String(customers.length === 0);
    this.totalEl.textContent = formatINR(totalOwed(customers));
    this.summaryEl.textContent =
      customers.length === 0
        ? "No customers yet"
        : `${owing.length} of ${customers.length} customers owe money`;
    this.renderList();
    this.renderComposer();
  }

  /** Re-render after settings change (shop name / UPI). */
  refresh(): void {
    this.renderComposer();
  }

  private stateFor(key: string): ReminderState {
    let s = this.state.get(key);
    if (!s) {
      s = { tone: "polite", text: "", busy: false, note: "" };
      this.state.set(key, s);
    }
    return s;
  }

  private select(key: string): void {
    this.selected = key;
    this.renderList();
    this.renderComposer();
    this.list.querySelector<HTMLButtonElement>(`button[data-key="${CSS.escape(key)}"]`)?.focus();
  }

  private renderList(): void {
    const total = totalOwed(this.customers);
    const items = this.customers.map((c) => {
      const st = stateOf(c);
      const s = this.state.get(c.key);
      const btn = el(
        "button",
        { type: "button", className: "cust" },
        el("span", { className: "cust-name" }, c.name),
        el("span", { className: "cust-amount" }, st === "settled" ? "₹0" : formatINR(Math.abs(c.balance))),
        el(
          "span",
          { className: "cust-detail" },
          `Udhaar ${formatINR(c.udhaar)} · Jama ${formatINR(c.jama)}`,
        ),
        el(
          "span",
          { className: "cust-note" },
          s?.text ? "Reminder drafted" : st === "owes" ? "baaki" : st === "advance" ? "advance paid" : "hisaab clear",
        ),
      );
      // Share of everything still to collect
      const share = total > 0 && c.balance > 0 ? c.balance / total : 0;
      const bar = el("span", { className: "cust-bar" });
      bar.style.setProperty("--share", share.toFixed(4));
      bar.setAttribute("aria-hidden", "true");
      btn.append(bar);
      btn.dataset.key = c.key;
      btn.dataset.state = st;
      if (this.changed.has(c.key)) bump(btn.querySelector(".cust-amount"));
      if (s?.text) btn.dataset.drafted = "true";
      if (c.key === this.selected) btn.setAttribute("aria-current", "true");
      btn.addEventListener("click", () => this.select(c.key));
      return el("li", {}, btn);
    });
    this.list.replaceChildren(...items);
  }

  private renderComposer(): void {
    const c = this.customers.find((x) => x.key === this.selected);
    if (!c) {
      this.composer.replaceChildren(
        el("div", { className: "composer-empty" },
          el("p", { className: "composer-empty-title" }, "Reminders appear here"),
          el("p", {}, "Read a khata page and pick a customer who owes money. Gemma drafts a short, respectful Hinglish message."),
        ),
      );
      return;
    }

    const s = this.stateFor(c.key);
    const settings = this.getSettings();
    const shop = shopName(settings);
    const amount = formatINR(c.balance);

    const head = el(
      "div",
      { className: "composer-head" },
      el("div", {},
        el("p", { className: "composer-kicker" }, "Reminder for"),
        el("h3", { id: "composer-title" }, c.name),
      ),
      el("p", { className: "composer-amount" },
        el("span", {}, c.balance > 0 ? amount : formatINR(Math.abs(c.balance))),
        el("small", {}, c.balance > 0 ? "baaki" : c.balance < 0 ? "advance paid" : "hisaab clear"),
      ),
    );

    if (c.balance <= 0) {
      this.composer.replaceChildren(
        head,
        el("p", { className: "composer-clear" }, `${c.name} doesn't owe anything right now, so there's nothing to remind.`),
      );
      return;
    }

    // Tone: a segmented radio group
    const tones = el("fieldset", { className: "segmented" }, el("legend", {}, "Tone"));
    for (const t of TONES) {
      const id = `tone-${t.value}`;
      const input = el("input", { type: "radio", name: "tone", id, value: t.value, checked: s.tone === t.value, disabled: s.busy });
      input.addEventListener("change", () => {
        if (input.checked) s.tone = t.value;
      });
      tones.append(input, el("label", { htmlFor: id }, t.label));
    }

    const write = el(
      "button",
      { type: "button", className: "btn btn-primary btn-write", disabled: s.busy },
      s.busy ? "Gemma likh raha hai..." : s.text ? "Write again" : "Write reminder with Gemma",
    );
    write.setAttribute("aria-busy", String(s.busy));

    const status = el("p", { className: "composer-status", role: "status" }, s.note);
    status.setAttribute("aria-live", "polite");

    // Message, styled as the WhatsApp bubble it will become
    const textarea = el("textarea", {
      id: "message",
      rows: 6,
      value: s.text,
      readOnly: s.busy,
      placeholder: "Pick a tone and press Write. The draft lands here and you can edit it before sending.",
    });

    const copy = el("button", { type: "button", className: "btn btn-secondary" }, "Copy message");
    const wa = el("a", { className: "btn btn-whatsapp", target: "_blank", rel: "noopener noreferrer" }, "Open in WhatsApp");
    const upiValid = isValidUpi(settings.upi);
    const actions = el("div", { className: "composer-actions" }, copy, wa);
    if (upiValid) {
      actions.append(el("a", { className: "btn btn-ghost", href: upiLink(settings.upi, shop, c.balance) }, "UPI pay link"));
    }

    const syncLinks = (): void => {
      const msg = textarea.value.trim();
      wa.href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
      const off = !msg || s.busy;
      copy.disabled = off;
      wa.toggleAttribute("aria-disabled", off);
      wa.tabIndex = off ? -1 : 0;
    };
    syncLinks();
    wa.addEventListener("click", (e) => {
      if (wa.hasAttribute("aria-disabled")) e.preventDefault();
    });

    textarea.addEventListener("input", () => {
      s.text = textarea.value;
      syncLinks();
    });

    copy.addEventListener("click", async () => {
      const ok = await copyText(textarea.value.trim());
      s.note = ok ? "Copied. Paste it in WhatsApp or SMS." : "Couldn't copy. Select the text and copy it by hand.";
      status.textContent = s.note;
      if (ok) {
        copy.textContent = "Copied";
        window.setTimeout(() => (copy.textContent = "Copy message"), 1600);
      }
    });

    write.addEventListener("click", async () => {
      const key = c.key;
      s.busy = true;
      s.note = "";
      this.renderComposer();
      try {
        const res = await writeReminder({ name: c.name, amount, shop, tone: s.tone });
        s.text = finalMessage(res.text, this.getSettings());
        s.note = res.fromTemplate
          ? "Gemma's draft missed the name or amount, so a standard message is shown. Edit as you like."
          : "Drafted by Gemma. Read it once, then copy or open WhatsApp.";
      } catch (err) {
        s.note = err instanceof Error ? err.message : "Couldn't write the reminder.";
      } finally {
        s.busy = false;
        this.renderList();
        if (this.selected === key) {
          this.renderComposer();
          this.composer.querySelector<HTMLTextAreaElement>("#message")?.focus();
        }
      }
    });

    const bubble = el(
      "div",
      { className: "bubble-wrap" },
      el("label", { htmlFor: "message" }, "Message", el("span", { className: "muted" }, " (edit freely)")),
      el("div", { className: "bubble" }, textarea),
    );
    bubble.dataset.busy = String(s.busy);

    this.composer.replaceChildren(
      head,
      el("div", { className: "composer-controls" }, tones, write),
      bubble,
      actions,
      status,
      el("p", { className: "composer-foot" }, "Nothing is sent automatically. WhatsApp opens with the text ready; you pick the contact and tap send. UPI links open only on a phone with a UPI app."),
    );
  }
}
