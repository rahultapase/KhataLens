import "./styles.css";
import { extractEntries, GemmaParseError, OllamaDownError, warmUp, type GemmaStatus } from "./gemma.ts";
import { fetchSample, prepareImage, type PreparedImage } from "./image.ts";
import { formatINR } from "./ledger.ts";
import { LedgerView } from "./ledgerView.ts";
import { HisaabView } from "./reminders.ts";
import { isValidUpi, loadSettings, saveSettings, shopName } from "./settings.ts";
import { csvFilename, downloadCsv, ledgerCsv } from "./csv.ts";
import { fingerprint, PageRegistry } from "./pages.ts";

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
  $("ledger-pager"),
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
  if (window.confirm(`Clear all ${ledger.size} entries? This can't be undone.`)) {
    ledger.clear();
    resetPages();
  }
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

// ---------- Photos: one page or many ----------

type PageStatus = "queued" | "reading" | "done" | "error" | "skipped";

interface QueuedPage {
  label: string;
  url: string;
  image: PreparedImage;
  fp: string;
  status: PageStatus;
  note: string;
  pageNo?: number;
}

const registry = new PageRegistry();
const strip = $("page-strip");
let queue: QueuedPage[] = [];
let shown = 0;
let reading = false;

function showError(message: string, raw?: string): void {
  errorMsg.textContent = message;
  errorRaw.textContent = raw ?? "";
  errorRawWrap.hidden = !raw;
  errorBox.hidden = false;
}

function pending(): QueuedPage[] {
  return queue.filter((p) => p.status === "queued" || p.status === "error");
}

function statusText(p: QueuedPage): string {
  const before = registry.pageOf(p.fp);
  switch (p.status) {
    case "reading":
      return "Reading...";
    case "done":
      return `Page ${p.pageNo} · ${p.note}`;
    case "error":
      return p.note || "Couldn't read";
    case "skipped":
      return "Skipped, already read";
    default:
      return before ? `Already read (page ${before})` : "Ready";
  }
}

function renderPages(): void {
  const page = queue[shown];
  if (!page) {
    preview.hidden = true;
    previewMeta.hidden = true;
    stageEmpty.hidden = false;
    stage.dataset.state = "empty";
    strip.hidden = true;
    readBtn.disabled = true;
    readBtn.textContent = "Read with Gemma";
    return;
  }

  previewImg.src = page.url;
  const position = queue.length > 1 ? ` · photo ${shown + 1} of ${queue.length}` : "";
  previewMeta.textContent = `${page.label}${position} · sent to Gemma as ${page.image.width} × ${page.image.height} px, ${Math.round(page.image.bytes / 1024)} KB`;
  previewMeta.hidden = false;
  preview.hidden = false;
  stageEmpty.hidden = true;
  stage.dataset.state = "loaded";

  // Thumbnail strip, only when there is more than one photo
  strip.hidden = queue.length < 2;
  strip.replaceChildren(
    ...queue.map((p, i) => {
      const img = Object.assign(document.createElement("img"), { src: p.url, alt: "" });
      const name = Object.assign(document.createElement("span"), { className: "thumb-name", textContent: `Photo ${i + 1}` });
      const state = Object.assign(document.createElement("span"), { className: "thumb-state", textContent: statusText(p) });
      const btn = Object.assign(document.createElement("button"), { type: "button", className: "thumb" });
      btn.append(img, name, state);
      btn.dataset.status = p.status;
      if (registry.pageOf(p.fp) && p.status === "queued") btn.dataset.duplicate = "true";
      btn.setAttribute("aria-label", `Show photo ${i + 1}, ${p.label}: ${statusText(p)}`);
      if (i === shown) btn.setAttribute("aria-current", "true");
      btn.addEventListener("click", () => {
        shown = i;
        renderPages();
        strip.querySelectorAll<HTMLButtonElement>(".thumb")[i]?.focus();
      });
      const li = document.createElement("li");
      li.append(btn);
      return li;
    }),
  );

  if (!reading) {
    const n = pending().length;
    readBtn.textContent = n > 1 ? `Read ${n} pages with Gemma` : "Read with Gemma";
    readBtn.disabled = false;
  }
}

async function loadPhotos(files: Blob[], labels: string[]): Promise<void> {
  if (reading) return;
  errorBox.hidden = true;
  progress.hidden = true;
  const picked = files.map((f, i) => ({ blob: f, label: labels[i] ?? `Photo ${i + 1}` }));
  const images = picked.filter((p) => p.blob.type.startsWith("image/"));
  const notImages = picked.length - images.length;
  if (images.length === 0) {
    showError("That file isn't a photo. Choose JPG or PNG photos of the khata pages.");
    return;
  }

  readBtn.disabled = true;
  for (const p of queue) URL.revokeObjectURL(p.url);
  queue = [];
  const failed: string[] = [];
  for (const { blob, label } of images) {
    try {
      const image = await prepareImage(blob);
      queue.push({ label, url: URL.createObjectURL(blob), image, fp: await fingerprint(image.base64), status: "queued", note: "" });
    } catch {
      failed.push(label);
    }
  }
  shown = 0;
  renderPages();

  const problems: string[] = [];
  if (failed.length) problems.push(`Couldn't open ${failed.join(", ")}.`);
  if (notImages) problems.push(`Skipped ${notImages} file(s) that aren't photos.`);
  if (problems.length) showError(problems.join(" "));
}

photoInput.addEventListener("change", () => {
  const files = [...(photoInput.files ?? [])];
  if (files.length) void loadPhotos(files, files.map((f) => f.name));
  photoInput.value = ""; // allow choosing the same photo again
});

sampleBtn.addEventListener("click", async () => {
  try {
    await loadPhotos([await fetchSample()], ["Sample page"]);
  } catch (err) {
    showError(err instanceof Error ? err.message : "Sample page not found.");
  }
});

// Drag and drop onto the stage (one or many photos)
stage.addEventListener("dragover", (e) => {
  e.preventDefault();
  stage.dataset.drag = "true";
});
stage.addEventListener("dragleave", () => delete stage.dataset.drag);
stage.addEventListener("drop", (e) => {
  e.preventDefault();
  delete stage.dataset.drag;
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) void loadPhotos(files, files.map((f) => f.name));
});

/** After "Clear ledger": forget what was read so every photo can be read again. */
function resetPages(): void {
  registry.clear();
  for (const p of queue) {
    if (p.status === "done" || p.status === "skipped") {
      p.status = "queued";
      p.note = "";
      p.pageNo = undefined;
    }
  }
  renderPages();
}

// ---------- Read with Gemma (page by page) ----------

readBtn.addEventListener("click", async () => {
  if (reading || queue.length === 0) return;
  let targets = pending();
  if (targets.length === 0) targets = [...queue]; // everything read already: offer to read again

  // Catch photos that are already in the ledger before adding their rows twice
  const dups = targets.filter((p) => registry.pageOf(p.fp) > 0);
  if (dups.length) {
    const names = dups.map((p) => `${p.label} (page ${registry.pageOf(p.fp)})`).join(", ");
    const again = window.confirm(
      `${dups.length === 1 ? "This photo is" : "These photos are"} already in the ledger: ${names}.\n\n` +
        "OK reads them again and adds their rows a second time. Cancel skips them.",
    );
    if (!again) {
      for (const p of dups) p.status = "skipped";
      targets = targets.filter((p) => !dups.includes(p));
    }
  }
  if (targets.length === 0) {
    renderPages();
    return;
  }

  reading = true;
  errorBox.hidden = true;
  readBtn.disabled = true;
  readBtn.textContent = "Gemma padh raha hai...";
  readBtn.setAttribute("aria-busy", "true");
  stage.dataset.reading = "true";
  progress.hidden = false;
  progress.dataset.tone = "busy";

  const started = performance.now();
  const results: unknown[] = [];
  const failures: string[] = [];
  let lastRaw: string | undefined;
  let pagesRead = 0;
  let entriesRead = 0;
  let unreadable = 0;

  for (let i = 0; i < targets.length; i++) {
    const p = targets[i];
    p.status = "reading";
    shown = queue.indexOf(p);
    renderPages();
    progress.textContent =
      targets.length > 1
        ? `Reading page ${i + 1} of ${targets.length}... The first read can take up to a minute.`
        : "Reading the page on this laptop. The first read can take up to a minute.";
    try {
      const result = await extractEntries(p.image.base64);
      if (result.entries.length === 0) {
        p.status = "error";
        p.note = "No entries found";
        failures.push(`${p.label}: Gemma couldn't find any entries.`);
        continue;
      }
      const pageNo = registry.add(p.fp);
      ledger.addFromGemma(result.entries, pageNo);
      results.push({ page: pageNo, photo: p.label, ...result });
      extractJson.textContent = JSON.stringify(results, null, 2);
      p.status = "done";
      p.pageNo = pageNo;
      p.note = `${result.entries.length} entries`;
      pagesRead++;
      entriesRead += result.entries.length;
      unreadable += result.unreadable_lines;
    } catch (err) {
      p.status = "error";
      p.note = "Couldn't read";
      if (err instanceof OllamaDownError) {
        setStatus("down");
        failures.push(err.message);
        break; // no point trying the remaining pages
      } else if (err instanceof GemmaParseError) {
        lastRaw = err.raw;
        failures.push(`${p.label}: Gemma's answer didn't make sense, even after a retry.`);
      } else {
        failures.push(`${p.label}: ${err instanceof Error ? err.message : "something went wrong."}`);
      }
    }
  }

  reading = false;
  readBtn.removeAttribute("aria-busy");
  delete stage.dataset.reading;
  renderPages();

  const secs = ((performance.now() - started) / 1000).toFixed(1);
  if (pagesRead > 0) {
    const what = pagesRead > 1 ? `${pagesRead} pages, ${entriesRead} entries` : `${entriesRead} entries`;
    const extra = unreadable > 0 ? ` ${unreadable} line(s) were unreadable; add them by hand.` : "";
    progress.dataset.tone = "done";
    progress.textContent = `Read ${what} in ${secs} s. Check them in the ledger.${extra}`;
  } else {
    progress.hidden = true;
  }
  if (failures.length) {
    showError(`${failures.join(" ")} Try a sharper, well-lit photo, or add the rows by hand.`, lastRaw);
  }
});

void warmUp(setStatus);
