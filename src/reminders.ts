// Reminder cards: one per customer who owes money.
// Model text only ever goes into textarea.value / textContent.
import { writeReminder, type Tone } from "./gemma.ts";
import { formatINR, type CustomerBalance } from "./ledger.ts";
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

/** The message as sent: Gemma's text plus a plain-text UPI line if one is set. */
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

export class RemindersView {
  private state = new Map<string, ReminderState>();
  private customers: CustomerBalance[] = [];

  constructor(
    private list: HTMLElement,
    private empty: HTMLElement,
    private getSettings: () => Settings,
  ) {}

  update(customers: CustomerBalance[]): void {
    this.customers = customers.filter((c) => c.balance > 0);
    this.render();
  }

  render(): void {
    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement ? active.dataset.focusKey : undefined;
    this.list.replaceChildren(...this.customers.map((c) => this.card(c)));
    this.empty.hidden = this.customers.length > 0;
    if (focusKey) this.list.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  private stateFor(key: string): ReminderState {
    let s = this.state.get(key);
    if (!s) {
      s = { tone: "polite", text: "", busy: false, note: "" };
      this.state.set(key, s);
    }
    return s;
  }

  private card(c: CustomerBalance): HTMLLIElement {
    const s = this.stateFor(c.key);
    const settings = this.getSettings();
    const shop = shopName(settings);
    const amount = formatINR(c.balance);
    const slug = c.key.replace(/[^a-z0-9]+/g, "-") || "customer";
    const uid = `${slug}-${Math.abs(hash(c.key))}`;

    const toneId = `tone-${uid}`;
    const tone = el("select", { id: toneId });
    tone.dataset.focusKey = `${c.key}:tone`;
    for (const t of TONES) tone.append(el("option", { value: t.value, selected: t.value === s.tone }, t.label));
    tone.addEventListener("change", () => {
      s.tone = tone.value as Tone;
    });

    const write = el("button", { type: "button", className: "btn btn-primary", disabled: s.busy },
      s.busy ? "Gemma likh raha hai..." : s.text ? "Write again" : "Write reminder");
    write.dataset.focusKey = `${c.key}:write`;
    write.setAttribute("aria-busy", String(s.busy));

    const status = el("p", { className: "reminder-status", role: "status" }, s.note);
    status.setAttribute("aria-live", "polite");

    const textId = `msg-${uid}`;
    const textarea = el("textarea", { id: textId, rows: 5, value: s.text, placeholder: "Reminder will appear here. You can edit it." });
    textarea.dataset.focusKey = `${c.key}:text`;

    const copy = el("button", { type: "button", className: "btn btn-secondary" }, "Copy");
    copy.dataset.focusKey = `${c.key}:copy`;

    const wa = el("a", { className: "btn btn-whatsapp", target: "_blank", rel: "noopener noreferrer" }, "Open in WhatsApp");
    const upiValid = isValidUpi(settings.upi);
    const upi = el("a", { className: "btn btn-ghost", href: upiValid ? upiLink(settings.upi, shop, c.balance) : "" }, "UPI pay link");

    const actions = el("div", { className: "reminder-actions" }, copy, wa);
    if (upiValid) actions.append(upi);

    const syncLinks = (): void => {
      const msg = textarea.value.trim();
      wa.href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
      actions.hidden = !msg;
    };
    syncLinks();

    textarea.addEventListener("input", () => {
      s.text = textarea.value;
      syncLinks();
    });

    copy.addEventListener("click", async () => {
      const ok = await copyText(textarea.value.trim());
      s.note = ok ? "Copied" : "Couldn't copy. Select the text and copy it by hand.";
      status.textContent = s.note;
    });

    write.addEventListener("click", async () => {
      s.busy = true;
      s.note = "Gemma likh raha hai...";
      this.render();
      try {
        const res = await writeReminder({ name: c.name, amount, shop, tone: s.tone });
        s.text = finalMessage(res.text, this.getSettings());
        s.note = res.fromTemplate
          ? "Gemma's draft missed the name or amount, so a standard message is shown. Edit as you like."
          : "Done. Read it once, edit if needed, then copy or open WhatsApp.";
      } catch (err) {
        s.note = err instanceof Error ? err.message : "Couldn't write the reminder.";
      } finally {
        s.busy = false;
        this.render();
      }
    });

    const li = el(
      "li",
      { className: "reminder-card" },
      el("div", { className: "reminder-head" },
        el("h3", {}, c.name),
        el("span", { className: "reminder-amount" }, amount),
      ),
      el("div", { className: "reminder-controls" },
        el("div", { className: "field" }, el("label", { htmlFor: toneId }, "Tone"), tone),
        write,
      ),
      el("div", { className: "field" }, el("label", { htmlFor: textId }, `Message for ${c.name}`), textarea),
      actions,
      status,
    );
    return li;
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
