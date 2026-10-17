# Kickoff prompt: paste everything below the line into a new Kiro session

---

Build **KhataLens** in `E:\WD\Hacktoberfest\khatalens`. It's a hackathon entry for "Best Use of
Gemma 4" at Hacktoberfest 2026 Mumbai, and we have about 80 minutes. Read
`khatalens/PLAN.md` first. It is the approved plan, so you don't need to re-plan or ask for
approval. Go phase by phase and move fast.

## What it does

A shopkeeper photographs a page of his handwritten udhaar (credit) notebook. Gemma 4, running
locally in Ollama, reads it into an editable ledger. The app totals what each customer owes and
writes a polite Hinglish reminder per customer, with Copy, Open in WhatsApp, and an optional UPI ID.
Nothing is sent automatically, and nothing leaves the laptop.

## Fixed stack (don't substitute)

- Vite **8.3.4** vanilla TypeScript, TypeScript **6.0.3**, exact pins (no `^`). No UI framework,
  no runtime dependencies unless truly unavoidable (ask first).
- Plain HTML + CSS with **OKLCH** color tokens as CSS custom properties.
- Write `package.json`, `index.html`, `tsconfig.json` and `vite.config.ts` by hand; don't run
  `npm create vite`. TS 6 tsconfig: `"moduleResolution": "bundler"`, `"module": "ESNext"`,
  `"target": "ES2022"`, `"strict": true`, `"noEmit": true`, `"types": ["vite/client"]`,
  `"lib": ["ES2022","DOM","DOM.Iterable"]`. Scripts: `dev`, `build` (`tsc && vite build`), `preview`.
- Node 22.23.2 / npm 10.9.8 on Windows PowerShell. Never run `npm run dev` in the foreground.
  Use a background process, and tell me the URL.

## Gemma 4 via Ollama

- Model `gemma4:e2b` (vision capable) at `http://localhost:11434`, Ollama 0.40.3, already running.
  Don't pull other models.
- `vite.config.ts`: proxy `/ollama` -> `http://localhost:11434` with `changeOrigin: true` and a
  rewrite stripping `/ollama`. If Ollama returns 403, strip the `Origin` header in the proxy's
  `configure` hook.
- `POST /ollama/api/chat` with `stream: false`, `think: false`, `options.temperature: 0.1`,
  `keep_alive: "15m"`. For vision, put the base64 image (no `data:` prefix) in `messages[].images`.
- Extraction uses `format` with this JSON schema (structured output):
  `{ entries: [{ customer: string, amount: number, kind: "udhaar"|"jama", date: string|null,
  item: string|null }], unreadable_lines: integer }`.
  The system prompt explains khata conventions. A line naming a customer with an amount is udhaar
  (credit given) unless it says jama / paid / diya / received, which is jama (payment). Read
  numbers literally, don't invent rows, and set uncertain fields to null.
- Reminders: a text-only call returning plain text in Roman-script Hinglish, at most 60 words. It
  must be respectful (no threats, no shaming) and include the customer name, ₹ amount and shop
  name. If a UPI ID is set, add a line like `UPI: <id>`. Tones: polite / friendly / firm-but-respectful.
- Downscale images in the browser before sending: canvas, longest side 1280 px, JPEG 0.85.
- Timeout 120 s (the first call loads the model). Retry once on invalid JSON, then show the raw
  text in an error state. Warm the model at app start with a tiny request, and show the status
  ("Gemma ready" / "loading" / "Ollama not running: run `ollama serve`").
- **Phase 1 starts with a raw API check** (PowerShell `Invoke-RestMethod`) against the sample
  image, before you write UI code. Report how accurate it is.

## Sample data

`public/sample-khata.jpg` is a photo I wrote by hand. Add a "Try sample page" button that loads
it. The page says:

```
12/10  Ramesh   atta 5kg        250
12/10  Sunita   doodh, bread     80
13/10  Ramesh   chawal          320
13/10  Imran    tel 1L          180
14/10  Sunita   jama             50
14/10  Pooja    sabun, surf     140
15/10  Imran    jama            100
16/10  Ramesh   jama            200
```

Expected balances: Ramesh ₹370, Pooja ₹140, Imran ₹80, Sunita ₹30, total ₹620. Use these to
verify Phase 2. If the photo is missing, tell me and keep going with file upload.

## Features (by phase, see PLAN.md for the time budget)

1. **Capture + extract:** file input with `accept="image/*" capture="environment"`, image
   preview, a "Read with Gemma" button, and a progress state ("Gemma padh raha hai...").
2. **Ledger:** editable table (customer, item, date, amount, udhaar/jama toggle, delete row,
   add row). Customer balance cards sorted by amount owed, then a grand total. Balance =
   sum(udhaar) - sum(jama). Group customers by name, trimmed and case-insensitive. Persist to
   `localStorage`, with a "Clear ledger" button that asks for confirmation.
3. **Reminders:** settings panel (shop name, default "Sharma General Store", optional UPI ID,
   saved in localStorage). Each customer with balance > 0 gets "Write reminder", a tone selector,
   an editable textarea with the result, **Copy** (Clipboard API with a fallback and an
   aria-live "Copied" message), **Open in WhatsApp** (`https://wa.me/?text=` + encodeURIComponent,
   new tab, `rel="noopener"`), and, if a UPI ID is set, a `upi://pay?pa=<id>&pn=<shop>&am=<amount>&cu=INR`
   link labelled "UPI pay link". Note in the UI that UPI links only open on phones.
4. **Design pass:** read `skills/impeccable/SKILL.md` and `skills/emil-design-eng/SKILL.md`,
   plus only the reference files they point you to for this task. Look: a warm paper ledger,
   cream background, ink-blue text and primary, a red accent for amounts owed, green for jama. All
   colors are OKLCH tokens in `:root`. Mobile-first and usable at 375 px. Visible focus rings,
   labels on every input, 44 px tap targets, `prefers-reduced-motion` respected, AA contrast. No
   console errors.
5. **Ship:** README.md (problem, how Gemma 4 is used and why on-device matters for shop data,
   setup and run steps including `ollama pull gemma4:e2b`, screenshots in `docs/screenshots/`,
   future work: WhatsApp Business API auto-send, Devanagari/Marathi notebooks, multi-page
   books, voice entry). Also save the submission text (title, tagline, description, how Gemma is
   used, technologies) at the end of README under "Hackathon submission".

## Rules

- Escape all model output before putting it in the DOM. Use `textContent`, never `innerHTML`
  with model text.
- No secrets anywhere. No backend. Add a README note that port 11434 shouldn't be exposed.
- `.gitignore`: `node_modules/`, `dist/`, `skills/`, `*.env`, `*credentials*`, `*.key`, `.DS_Store`.
- Keep `PLAN.md` and `PROMPT.md` in the repo.
- After each phase: run `npm run build` (it must pass), check the feature in the browser (use
  chrome-devtools tools if available), then commit and **push to `main`** at
  `https://github.com/rahultapase/KhataLens` (empty repo). You have my explicit yes for these
  commits and pushes, using the commit messages in PLAN.md. Stage files by name or by folder,
  never `git add -A`. Before the first commit, check that `git status` doesn't show `skills/`.
- Phase 0: `git init -b main`, `git remote add origin https://github.com/rahultapase/KhataLens.git`,
  first push with `-u`. If the push fails on auth, stop and tell me.
- If you're behind schedule, cut in the order PLAN.md gives (WhatsApp link, tone selector,
  add/delete rows, polish), and tell me what you cut. Never cut photo -> ledger -> balance ->
  copyable reminder.
- After each phase, report in 2–3 lines: what works, what was verified, and the time used.
