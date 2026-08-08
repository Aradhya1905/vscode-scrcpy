# Plan 02 — Design token layer

**Detail doc:** [`docs/changes/02-design-tokens.md`](../../docs/changes/02-design-tokens.md)

**Goal:** make the webview follow the user's VS Code theme, and give the UI a
real elevation / radius / motion scale to build on. No component redesign in
this plan.

**Depends on:** plan 01 (creates `tokens.css`).

## Steps

1. Fill out `webview-ui/src/styles/tokens.css` on `:root`:
   - surfaces, text, borders, accents, semantic status colours
   - radii, layered shadows (each including the inset top highlight)
   - motion durations and easing
   - every token as `var(--vscode-*, <fallback>)`
2. In the same file, redefine the legacy `--vsc-*` names as aliases of the new
   tokens. This is what makes all 15 existing stylesheets theme-aware without
   touching them.
3. Delete the hardcoded `:root` palette block from
   `webview-ui/src/styles/base.css:4-23`, keeping `--phone-width` /
   `--phone-height` (layout, not theme).
4. Add a scoped block in `tokens.css` pinning `.logcat-root`, `.fm-root` and
   `.sl-root` to the dark fallback values. Those panels hardcode dozens of dark
   foreground colours, so letting only their backgrounds follow a light theme
   would make them unreadable. Temporary — removing a selector is the last step
   of migrating that panel.
5. Replace `transition: all` with explicit property lists across the
   stylesheets (23 occurrences in 8 files).
6. Add a global `@media (prefers-reduced-motion: reduce)` block that collapses
   animation and transition durations.

## Constraints

- Do not introduce `backdrop-filter` on any surface that overlaps the video
  canvas — it would force that layer to re-composite on every decoded frame.
  The zoom HUD keeps its blur; nothing else gains one in this plan.
- Do not restyle any component. Colour source and scales only, so that any
  visual regression is unambiguously a token mapping error.

## Checks

- Sidebar readable and correctly contrasted in Dark+, Light+, and a High
  Contrast theme; switching themes updates it live without a reload.
- `rg -n "#0d1117|#161b22|#1c2128|#30363d|#e6edf3|#8b949e" webview-ui/src/styles`
  matches only fallback values inside `tokens.css`.
- `rg -n "transition: all" webview-ui/src/styles` → no hits.
- Mirror a device: frame rate unchanged (this plan adds no compositing work).
- `npm run typecheck && npm run lint && npm run format:check` green.
