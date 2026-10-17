import "./styles.css";
import { extractEntries, GemmaParseError, warmUp, type GemmaStatus } from "./gemma.ts";
import { fetchSample, prepareImage, type PreparedImage } from "./image.ts";
import { LedgerView } from "./ledgerView.ts";
import { RemindersView } from "./reminders.ts";
import { isValidUpi, loadSettings, saveSettings } from "./settings.ts";

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const statusEl = $("gemma-status");
const photoInput = $<HTMLInputElement>("photo-input");
const sampleBtn = $<HTMLButtonElement>("sample-btn");
const preview = $("preview");
const previewImg = $<HTMLImageElement>("preview-img");
const previewMeta = $("preview-meta");
const readBtn = $<HTMLButtonElement>("read-btn");
const progress = $("read-progress");
const errorBox = $("read-error");
const errorMsg = $("read-error-msg");
const errorRawWrap = $("read-error-raw-wrap");
const errorRaw = $("read-error-raw");
const extractJson = $("extract-json");

const ledger = new LedgerView(
  $<HTMLTableSectionElement>("ledger-body"),
  $("ledger-wrap"),
  $("ledger-empty"),
  $("balance-cards"),
  $("grand-total"),
  $("entry-count"),
);

// Settings + reminders
const settings = loadSettings();
const shopInput = $<HTMLInputElement>("shop-name");
const upiInput = $<HTMLInputElement>("upi-id");
shopInput.value = settings.shop;
upiInput.value = settings.upi;

const reminders = new RemindersView($("reminder-list"), $("reminders-empty"), () => settings);
ledger.onBalancesChange((list) => reminders.update(list));

function markUpi(): void {
  const v = upiInput.value.trim();
  upiInput.setAttribute("aria-invalid", String(v !== "" && !isValidUpi(v)));
}
markUpi();
shopInput.addEventListener("input", () => {
  settings.shop = shopInput.value;
  saveSettings(settings);
});
shopInput.addEventListener("change", () => reminders.render());
upiInput.addEventListener("input", () => {
  settings.upi = upiInput.value.trim();
  saveSettings(settings);
  markUpi();
});
upiInput.addEventListener("change", () => reminders.render());

$("add-row").addEventListener("click", () => ledger.addBlank());
$("clear-ledger").addEventListener("click", () => {
  if (ledger.size === 0) return;
  if (window.confirm(`Clear all ${ledger.size} entries? This can't be undone.`)) ledger.clear();
});

let current: PreparedImage | null = null;
let previewUrl: string | null = null;

const STATUS_TEXT: Record<GemmaStatus, string> = {
  checking: "Checking Gemma...",
  loading: "Gemma loading (first time takes a minute)...",
  ready: "Gemma ready",
  down: "Ollama not running: run `ollama serve`",
  "no-model": "Gemma not installed: run `ollama pull gemma4:e2b`",
};

function setStatus(s: GemmaStatus): void {
  statusEl.textContent = STATUS_TEXT[s];
  statusEl.dataset.state = s;
}

function showError(message: string, raw?: string): void {
  errorMsg.textContent = message;
  errorRaw.textContent = raw ?? "";
  errorRawWrap.hidden = !raw;
  errorBox.hidden = false;
}

async function loadPhoto(blob: Blob, label: string): Promise<void> {
  errorBox.hidden = true;
  readBtn.disabled = true;
  try {
    current = await prepareImage(blob);
  } catch (err) {
    current = null;
    showError(err instanceof Error ? err.message : "Could not open that photo.");
    return;
  }
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  previewImg.src = previewUrl;
  previewMeta.textContent = `${label} - sent as ${current.width} x ${current.height}, ${Math.round(current.bytes / 1024)} KB`;
  preview.hidden = false;
  readBtn.disabled = false;
}

photoInput.addEventListener("change", () => {
  const file = photoInput.files?.[0];
  if (file) void loadPhoto(file, file.name);
});

sampleBtn.addEventListener("click", async () => {
  try {
    await loadPhoto(await fetchSample(), "Sample page");
  } catch (err) {
    showError(err instanceof Error ? err.message : "Sample page not found.");
  }
});

readBtn.addEventListener("click", async () => {
  if (!current) return;
  errorBox.hidden = true;
  readBtn.disabled = true;
  progress.hidden = false;
  progress.textContent = "Gemma padh raha hai...";
  const started = performance.now();
  try {
    const result = await extractEntries(current.base64);
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    extractJson.textContent = JSON.stringify(result, null, 2);
    ledger.addFromGemma(result.entries);
    const skipped = result.unreadable_lines > 0 ? ` ${result.unreadable_lines} line(s) were unreadable; add them by hand.` : "";
    progress.textContent = `Read ${result.entries.length} entries in ${secs} s and added them to the ledger.${skipped}`;
    if (result.entries.length === 0) {
      showError("Gemma couldn't find any entries. Try a sharper, well-lit photo of one page.");
    }
  } catch (err) {
    progress.hidden = true;
    if (err instanceof GemmaParseError) {
      showError("Gemma's answer didn't make sense, even after a retry.", err.raw);
    } else {
      showError(err instanceof Error ? err.message : "Something went wrong.");
    }
  } finally {
    readBtn.disabled = false;
  }
});

void warmUp(setStatus);
