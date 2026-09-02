# Notary Signing Checklists

Field tools for a notary signing agent. Two parts:

| Part | What it does | Needs network |
|---|---|---|
| **Checklist** (`/`) | WA residential seller closing, 39 items across six phases, stop-the-signing triggers, UPL-safe scripts. Progress saved on-device. | No — works offline once loaded |
| **Pre-signing brief** (`/analyze/`) | Photograph or paste up to 6 pages from a closing package; get a signing-table checklist built from that document, in the same form as the standing checklist — a "Before you leave" phase, then one numbered phase per section of the document in printed order with tappable items carrying the real figures, then the 60-second presentment script, a never-skip list, a stop-the-signing panel built from the document's own discrepancies, and verified arithmetic. Progress bar counts the boxes. | Yes — one Claude Opus 5 call per brief |

**Live:** https://notary-brief.fly.dev/
**Static copy (checklist only, offline):** https://stevenmoazez-png.github.io/notary-checklist/

## The boundary the whole thing is built around

A notary may **locate and identify** information on a document. A notary may **not explain** what it means — that is unauthorized practice of law. The brief is written for the notary and may reason freely. The one client-facing field, `script`, is constrained by schema description and system prompt to locating language only, and must end by referring the signer to their escrow officer.

## Data handling

Nothing is stored. Page images are held in the browser, sent once, processed in memory, and discarded. Nothing is written to disk on the server. Log lines carry request shape and outcome only — no document text, figures, or party names — and client IPs are HMAC'd with a random per-boot salt. Closing packages carry GLBA-adjacent personal and financial data, and signing services generally require destruction after the signing; retaining any of it would work against the user.

## Structure

```
index.html                 the checklist
analyze/index.html         the brief generator
manifest.webmanifest       PWA manifest (add to home screen)
sw.js                      service worker — precaches the site; never touches /api/
server/
  index.js                 Node http server: static allowlist + POST /api/analyze
  brief-schema.js          zod schema for the brief + the system prompt
assets/
  checklist.css / .js      checklist styling and behaviour (light + dark + print)
  analyze.css / .js        brief generator styling and behaviour
  fonts.css, fonts/        self-hosted Archivo, Source Serif 4, IBM Plex Mono
  icons/                   generated PWA + apple-touch icons
Dockerfile, fly.toml       deployment
```

No framework, no build step. Fonts are self-hosted so the checklist renders correctly with no signal.

## Running locally

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... node server/index.js
```

Open http://localhost:8080. Without the key the site serves normally and `/api/analyze` returns 503.

## Configuration

| Env var | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | for the brief | A **workspace-scoped** key (Console → API keys → Linked account: *Not linked*). |
| `ANTHROPIC_WORKSPACE_ID` | only for identity-linked keys | Sent as `anthropic-workspace-id`. Not needed with a workspace-scoped key. |
| `PORT` | no | Defaults to 8080. |

Set secrets on Fly without echoing them:

```bash
printf 'Paste the API key, then press Return: ' && read -rs KEY && echo && flyctl secrets set ANTHROPIC_API_KEY="$KEY" -a notary-brief && unset KEY
```

## Deploying

```bash
flyctl deploy --now --ha=false -a notary-brief
```

GitHub Pages also serves `main` at the static URL above; the brief generator's button there fails with a message pointing at the full version. Bump `CACHE` in `sw.js` on any content change or returning visitors keep the cached copy.

## Limits and cost

- 6 pages per request, 5 MB per image after the client downscales to 2000 px, 14 MB per request.
- Per-IP rate limit: 12 briefs/hour, 40/day. In-memory, resets on deploy.
- Cost: roughly 10–15¢ per brief at current Opus 5 pricing (measured: 5.9k in / 4.3k out ≈ 14¢ for a one-page statement). Takes about a minute.
- The Fly machine sleeps when idle; the first request after a quiet stretch has a 3–5 s cold start.

## Adding another checklist

1. Copy `index.html` to e.g. `wa-buyer/index.html` and fix asset paths to `../assets/…`.
2. Give its checkboxes a new `data-key` prefix and a new `STORE` key so progress doesn't collide.
3. Add the new top-level directory to `PUBLIC_TOP` in `server/index.js`.
4. Add the new paths to `ASSETS` in `sw.js` and bump `CACHE`.

## Accuracy

Not legal advice. The checklist describes general operating practice; Washington notary rules come from the Department of Licensing and RCW 42.45 — verify against current versions. The brief is model-extracted and can be wrong; every figure must be checked against the document before it is relied on. The brief exists to make reading the package faster, not to replace reading it.
