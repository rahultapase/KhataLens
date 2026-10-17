# KhataLens: build plan

Hacktoberfest 2026 Mumbai (Paytm office), track: Best Use of Gemma 4. Budget: 90 min.

A shopkeeper photographs a page of his handwritten udhaar (credit) notebook. Gemma 4 reads it on
the laptop (no cloud), turns it into an editable digital ledger, totals what each customer owes,
and writes a polite Hinglish reminder per customer that he can copy and send on WhatsApp himself.

Auto-sending WhatsApp messages is out of scope (future work).

## Checked state (Sat 17 Oct)

| Item | Status |
|---|---|
| Model | `gemma4:e2b` in Ollama 0.40.3 (4.6B, Q4_K_M). Capabilities: vision, tools, thinking. 128K context |
| API | `http://localhost:11434` is up |
| Node / npm | 22.23.2 / 10.9.8 (Vite 8 needs >= 22.12) |
| TypeScript 6.0.3, Vite 8.3.4 | both on npm |
| Repo | `github.com/rahultapase/KhataLens` exists and is empty |
| Folder | `E:\WD\Hacktoberfest\khatalens` has only `skills/` (impeccable, emil-design-eng, find-skills) |

Not checked yet: how well e2b reads your actual handwriting. Phase 1 tests that first.

## Decisions (approved Sat 17 Oct)

- Notebook: English numbers, English/Hinglish in Roman script. Sample photo at
  `khatalens/public/sample-khata.jpg` (fake names, committed for the demo).
- UPI: optional UPI ID in settings. WhatsApp doesn't make `upi://` links tappable, so the message
  carries the UPI ID and amount as plain text. The app itself shows a `upi://pay` link.
- WhatsApp: "Open in WhatsApp" via `https://wa.me/?text=...` (user picks contact, taps send).
- Shop name default "Sharma General Store", editable.
- Push straight to `main`. `skills/` stays out of the repo (gitignored).
- Model: `gemma4:e2b` only.
- Build runs in a fresh Kiro session from `PROMPT.md`.

## Architecture

- Frontend only: Vite vanilla TS, plain HTML/CSS with OKLCH tokens. No UI framework, no backend.
- The browser calls Ollama through a Vite dev proxy (`/ollama` -> `localhost:11434`), so there's
  no CORS setup and no API key.
- Gemma 4 does two jobs:
  1. Vision: photo -> JSON entries via `/api/chat` with `images` + a `format` JSON schema
     (structured output), `think: false`, low temperature.
  2. Text: customer + balance + tone -> a short Hinglish reminder.
- The image is downscaled in the browser (canvas, longest side ~1280 px, JPEG) before sending,
  for speed.
- The ledger is kept in `localStorage`. Nothing leaves the laptop.

Extraction schema (draft):
```json
{ "entries": [ { "customer": "Ramesh", "amount": 450, "kind": "udhaar | jama",
                 "date": "12/10 or null", "item": "atta, doodh or null" } ],
  "unreadable_lines": 0 }
```
`udhaar` = credit given (customer owes more), `jama` = payment received (customer owes less).

## Phases (commit and push after each)

| # | Phase | Time | Done when | Commit message |
|---|---|---|---|---|
| 0 | Scaffold: hand-written `package.json` with exact pins (`vite 8.3.4`, `typescript 6.0.3`), `index.html`, `tsconfig.json` (TS 6: `moduleResolution: bundler`, `types: ["vite/client"]`), `vite.config.ts` with proxy, `.gitignore`, README stub. `git init`, remote, push | 5 min | `npm run build` passes, repo has a first commit | `chore: scaffold Vite 8 + TS 6 vanilla app` |
| 1 | Gemma core: `src/gemma.ts` (chat call, timeout, JSON parse with one retry), `src/image.ts` (file/camera input, downscale, base64). Test on a real khata photo right away | 20 min | photo -> entries JSON shown on screen | `feat: extract khata entries with Gemma 4 vision` |
| 2 | Ledger: editable table (fix misreads, add/delete rows, toggle udhaar/jama), per-customer balance cards sorted by amount owed, grand total, localStorage | 20 min | edits update balances live and survive a refresh | `feat: editable ledger with customer balances` |
| 3 | Reminders: per customer "Write reminder" -> Gemma text call; tone (polite / friendly / firm-but-respectful); settings for shop name + optional UPI ID; Copy button; "Open in WhatsApp" link (`wa.me/?text=`; the user picks the contact and taps send); `upi://pay` link in the app | 15 min | copy works; message names amount, customer and shop | `feat: Hinglish payment reminders` |
| 4 | Design pass with `skills/impeccable` + `skills/emil-design-eng`: OKLCH tokens, mobile-first layout, loading state ("Gemma padh raha hai..."), empty and error states (Ollama down, unreadable photo), focus states, keyboard reachability | 15 min | no console errors, usable at 375 px wide | `style: design pass and states` |
| 5 | Ship: README (problem, how Gemma 4 is used, run steps, screenshots, future work), demo script, submission text | 10 min | pushed, README renders on GitHub | `docs: README and screenshots` |
| | Buffer | 5 min | | |

If we fall behind, cut in this order: WhatsApp link, tone selector, add/delete rows, design
polish. Never cut: photo -> ledger -> balance -> copyable reminder.

## Demo script (2 min)

1. "40% of small shops in India run on a paper udhaar khata." Show the notebook.
2. Snap or upload the page, and Gemma 4 reads it locally (point out it works offline).
3. Fix one misread in the table and the balance updates.
4. Click "Write reminder" on the top debtor, copy it, and show it pasted into WhatsApp.
5. Why Gemma 4: multimodal on a 4.6B model that runs on a shop laptop, so customer data stays private.

## Risks

| Risk | Mitigation |
|---|---|
| e2b misreads handwriting (especially Devanagari) | editable table is the core UX, not an afterthought; test in Phase 1 with your real photo |
| Slow first call (model load) | warm the model at app start with a tiny request; show progress |
| Invalid JSON | `format` schema + one retry + raw-text fallback |
| Ollama not running | clear banner with the `ollama serve` hint |
| Only runs locally | Project URL = GitHub repo; demo live from the laptop |

## Security

No keys or secrets are involved. Ollama is local only. The README will say not to expose
port 11434 publicly. `.gitignore` covers `node_modules`, `dist`, `*.env`, `*credentials*`, `*.key`.
