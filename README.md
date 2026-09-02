# Notary Signing Checklists

Static, offline-capable field checklists for notary signing agents. No backend, no build step, no dependencies — plain HTML, CSS, and one small script.

**Live:** https://stevenmoazez-png.github.io/notary-checklist/

## What's here

| Path | Checklist |
|---|---|
| `/` | WA residential **seller** closing |

## Structure

```
index.html                 the seller checklist
manifest.webmanifest       PWA manifest (add to home screen)
sw.js                      service worker — precaches everything for offline use
assets/
  checklist.css            all styling, light + dark, plus print styles
  checklist.js             progress bar, localStorage persistence, reset, print
  fonts.css                @font-face for the self-hosted faces
  fonts/                   Archivo, Source Serif 4, IBM Plex Mono (latin woff2)
  icons/                   generated PWA + apple-touch icons
```

Fonts are self-hosted rather than pulled from Google so the page renders correctly with no signal — the whole point is that it works at a kitchen table with one bar of service.

## Local preview

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. A real HTTP origin is required — the service worker won't register over `file://`.

## Adding another checklist

1. Copy `index.html` to `wa-buyer/index.html` (or whichever package).
2. Fix the asset paths — `./assets/…` becomes `../assets/…`.
3. Give its checkboxes a fresh `data-key` prefix and bump `STORE` in a page-local script so its progress doesn't collide with the seller list.
4. Add the new paths to `ASSETS` in `sw.js` and **bump `CACHE`** to `-v2`.
5. Once there are three or more, replace the root with a small hub page.

## Deploying

GitHub Pages serves from the `main` branch root. Push and it's live:

```bash
git add -A && git commit -m "Update checklist" && git push
```

Bump the `CACHE` constant in `sw.js` on any content change, or returning visitors keep the cached copy.

## Content accuracy

The checklists describe general operating practice, not legal requirements, and are **not legal advice**. Washington notary rules (journal, certificate wording, acceptable ID) come from the Washington Department of Licensing and RCW 42.45 — verify against the current versions before relying on anything here. Document lists and recording practices vary by county and by title company.
