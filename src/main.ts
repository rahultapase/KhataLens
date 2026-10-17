import "./styles.css";
import { extractEntries, GemmaParseError, OllamaDownError, warmUp, type GemmaStatus } from "./gemma.ts";
import { fetchSample, prepareImage, type PreparedImage } from "./image.ts";
import { formatINR } from "./ledger.ts";
import { LedgerView } from "./ledgerView.ts";
import { HisaabView } from "./reminders.ts";
import { isValidUpi, loadSettings, saveSettings, shopName } from "./settings.ts";
import { csvFilename, downloadCsv, ledgerCsv } from "./csv.ts";

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const statusEl = $("gemma-status");
const photoInput = $<HTMLInputElement>("photo-input");
const sampleBtn = $<HTMLButtonElement>("sample-btn");
const stage = $("stage");
const stageEmpty = $("stage-empty");
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

// ---------- Ledger + hisaab ----------

const ledger = new LedgerView(
  $<HTMLTableSectionElement>("ledger-body"),
  $("ledger-wrap"),
  $("ledger-empty"),
  $("entry-count"),
);

const settings = loadSettings();
const shopInput = $<HTMLInputElement>("shop-name");
const upiInput = $<HTMLInputElement>("upi-id");
shopInput.value = settings.shop;
upiInput.value = settings.upi;

const hisaab = new HisaabView(
  $("customer-list"),
  $("grand-total"),
  $("hisaab-summary"),
  $("composer"),
  $("hisaab"),
  () => settings,
);
const ledgerSum = $("ledger-sum");
const csvBtn = $<HTMLButtonElement>("download-csv");
csvBtn.addEventListener("click", () => {
  if (ledger.size === 0) return;
  downloadCsv(ledgerCsv(ledger.snapshot(), shopName(settings)), csvFilename());
});
ledger.onBalancesChange((list) => {
  csvBtn.disabled = ledger.size === 0;
  hisaab.update(list);
  // One-line arithmetic under the table: udhaar - jama = baaki
  const udhaar = list.reduce((s, c) => s + c.udhaar, 0);
  const jama = list.reduce((s, c) => s + c.jama, 0);
  ledgerSum.hidden = list.length === 0;
  ledgerSum.replaceChildren(
    sumPart("Udhaar", formatINR(udhaar), "owed"),
    " − ",
    sumPart("Jama", formatINR(jama), "jama"),
    " = ",
    sumPart("Baaki", formatINR(udhaar - jama), "net"),
  );
});

function sumPart(label: string, value: string, tone: string): HTMLElement {
  const span = document.createElement("span");
  span.className = `sum-part sum-${tone}`;
  const l = document.createElement("span");
  l.className = "sum-label";
  l.textContent = label;
  const v = document.createElement("strong");
  v.textContent = value;
  span.append(l, " ", v);
  return span;
}

function markUpi(): void {
  const v = upiInput.value.trim();
  upiInput.setAttribute("aria-invalid", String(v !== "" && !isValidUpi(v)));
}
markUpi();
shopInput.addEventListener("input", () => {
  settings.shop = shopInput.value;
  saveSettings(settings);
});
shopInput.addEventListener("change", () => hisaab.refresh());
upiInput.addEventListener("input", () => {
  settings.upi = upiInput.value.trim();
  saveSettings(settings);
  markUpi();
});
upiInput.addEventListener("change", () => hisaab.refresh());

$("add-row").addEventListener("click", () => ledger.addBlank());
$("clear-ledger").addEventListener("click", () => {
  if (ledger.size === 0) return;
  if (window.confirm(`Clear all ${ledger.size} entries? This can't be undone.`)) ledger.clear();
});

// ---------- Theme ----------

const THEME_KEY = "khatalens.theme";
const themeBtn = $<HTMLButtonElement>("theme-toggle");
const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

function paintTheme(): void {
  const dark = document.documentElement.dataset.theme === "dark";
  themeBtn.setAttribute("aria-pressed", String(dark));
  themeBtn.title = dark ? "Switch to light mode" : "Switch to dark mode";
  themeMeta?.setAttribute("content", dark ? "#0d1220" : "#1f2b5c");
}
paintTheme();

themeBtn.addEventListener("click", () => {
  const root = document.documentElement;
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  root.classList.add("theme-switching");
  root.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // storage blocked; theme lasts for this visit
  }
  paintTheme();
  window.setTimeout(() => root.classList.remove("theme-switching"), 260);
});

// ---------- Gemma status ----------

const STATUS_TEXT: Record<GemmaStatus, string> = {
  checking: "Checking Gemma...",
  loading: "Gemma loading...",
  ready: "Gemma 4 ready",
  down: "Ollama not running: run ollama serve",
  "no-model": "Gemma not installed",
};

const ollamaHelp = $("ollama-help");
const ollamaHelpMsg = $("ollama-help-msg");
const ollamaHelpCmd = $("ollama-help-cmd");
const retryBtn = $<HTMLButtonElement>("ollama-retry");

function setStatus(s: GemmaStatus): void {
  statusEl.textContent = STATUS_TEXT[s];
  statusEl.dataset.state = s;
  ollamaHelp.hidden = !(s === "down" || s === "no-model");
  retryBtn.disabled = s === "checking" || s === "loading";
  if (s === "down") {
    ollamaHelpMsg.textContent = "Ollama isn't running, so Gemma can't read photos or write reminders yet.";
    ollamaHelpCmd.textContent = "ollama serve";
  } else if (s === "no-model") {
    ollamaHelpMsg.textContent = "Ollama is running, but the Gemma 4 model isn't installed.";
    ollamaHelpCmd.textContent = "ollama pull gemma4:e2b";
  }
}

retryBtn.addEventListener("click", () => void warmUp(setStatus));

// ---------- Photo ----------

let current: PreparedImage | null = null;
let previewUrl: string | null = null;

function showError(message: string, raw?: string): void {
  errorMsg.textContent = message;
  errorRaw.textContent = raw ?? "";
  errorRawWrap.hidden = !raw;
  errorBox.hidden = false;
}

async function loadPhoto(blob: Blob, label: string): Promise<void> {
  errorBox.hidden = true;
  progress.hidden = true;
  readBtn.disabled = true;
  if (!blob.type.startsWith("image/")) {
    showError("That file isn't a photo. Choose a JPG or PNG of the khata page.");
    return;
  }
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
  previewMeta.textContent = `${label} · sent to Gemma as ${current.width} × ${current.height} px, ${Math.round(current.bytes / 1024)} KB`;
  previewMeta.hidden = false;
  preview.hidden = false;
  stageEmpty.hidden = true;
  stage.dataset.state = "loaded";
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

// Drag and drop onto the stage
stage.addEventListener("dragover", (e) => {
  e.preventDefault();
  stage.dataset.drag = "true";
});
stage.addEventListener("dragleave", () => delete stage.dataset.drag);
stage.addEventListener("drop", (e) => {
  e.preventDefault();
  delete stage.dataset.drag;
  const file = e.dataTransfer?.files?.[0];
  if (file) void loadPhoto(file, file.name);
});

// ---------- Read with Gemma ----------

readBtn.addEventListener("click", async () => {
  if (!current) return;
  errorBox.hidden = true;
  readBtn.disabled = true;
  readBtn.textContent = "Gemma padh raha hai...";
  readBtn.setAttribute("aria-busy", "true");
  stage.dataset.reading = "true";
  progress.hidden = false;
  progress.dataset.tone = "busy";
  progress.textContent = "Reading the page on this laptop. The first read can take up to a minute.";
  const started = performance.now();
  try {
    const result = await extractEntries(current.base64);
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    extractJson.textContent = JSON.stringify(result, null, 2);
    ledger.addFromGemma(result.entries);
    const skipped =
      result.unreadable_lines > 0 ? ` ${result.unreadable_lines} line(s) were unreadable; add them by hand.` : "";
    progress.dataset.tone = "done";
    progress.textContent = `Read ${result.entries.length} entries in ${secs} s. Check them in the ledger.${skipped}`;
    if (result.entries.length === 0) {
      progress.hidden = true;
      showError("Gemma couldn't find any entries. Try a sharper, well-lit photo of one page.");
    }
  } catch (err) {
    progress.hidden = true;
    if (err instanceof GemmaParseError) {
      showError("Gemma's answer didn't make sense, even after a retry. Try a sharper photo, or add the rows by hand.", err.raw);
    } else if (err instanceof OllamaDownError) {
      setStatus("down");
      showError(err.message);
    } else {
      showError(err instanceof Error ? err.message : "Something went wrong.");
    }
  } finally {
    readBtn.disabled = false;
    readBtn.textContent = "Read with Gemma";
    readBtn.removeAttribute("aria-busy");
    delete stage.dataset.reading;
  }
});

void warmUp(setStatus);
