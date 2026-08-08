# Plan 01 — Webview fonts

**Detail doc:** [`docs/changes/01-webview-fonts.md`](../../docs/changes/01-webview-fonts.md)

**Goal:** stop shipping a font import that the webview CSP blocks; source
typography from the host editor instead.

## Steps

1. Create `webview-ui/src/styles/tokens.css` with the two font tokens:
   - `--font-ui: var(--vscode-font-family, <system sans stack>)`
   - `--font-mono: var(--vscode-editor-font-family, <mono stack>)`

   (Plan 02 fills the rest of this file in. It is created here because plan 01
   is the first consumer.)
2. Import `tokens.css` as the first import in `webview-ui/src/styles/index.css`.
3. Delete the `@import url('https://fonts.googleapis.com/...')` line from
   `webview-ui/src/styles/base.css:1`.
4. In `base.css`, set `body { font-family: var(--font-ui); }`.
5. Replace `'JetBrains Mono', monospace` with `var(--font-mono)` in
   `zoomHud.css` and any other stylesheet that names it.

## Checks

- `rg -n "fonts.googleapis|JetBrains Mono|'Outfit'" webview-ui/src media` → no hits.
- `npm run compile:webview` → `media/build/webview.css` has no `@import` of an
  `http(s)` URL.
- Sidebar open, webview DevTools: no CSP violation logged, no request to
  `fonts.googleapis.com`.
- Zoom HUD percentage still renders monospaced with tabular figures.

## Notes

If the branded typeface is wanted later, this is additive: drop the woff2 files
into `media/fonts/`, add `font-src {{cspSource}}` to the CSP in
`media/webview.html`, declare `@font-face` with `asWebviewUri`, and repoint
`--font-ui` / `--font-mono`. Nothing else changes, because every call site goes
through the two tokens.
