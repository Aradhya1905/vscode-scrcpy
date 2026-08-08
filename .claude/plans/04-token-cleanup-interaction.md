# Plan 04 — Token cleanup and interaction pass

**Detail doc:** [`docs/changes/04-token-cleanup-interaction.md`](../../docs/changes/04-token-cleanup-interaction.md)

**Goal:** finish what change 02 started. Every sidebar surface follows the
theme, every transition uses the motion tokens, every focusable control has a
focus ring, and no blurred layer overlaps the video.

**Depends on:** plan 02 (the tokens this consumes).

**Scope:** CSS only, plus one deleted CSS rule that unblocks the icon `size`
props already written in `Toolbar.tsx`. No component is restructured.

## Steps

1. Migrate `settingsPanel.css` onto the tokens. Replace `rgba(22,27,34,.95)`
   (`:7`), `#2C3038` (`:94`), `#353A44` (`:105`), `#D1D1D1` (`:100,124`), and
   the `rgba` hover/active fills (`:113,133,167`) with `--surface-overlay`,
   `--surface-raised`, `--surface-hover`, `--text`, `--text-muted`,
   `--accent-soft`.
2. Fix the toggle knob (`settingsPanel.css:211-225`): keep `left: 2px`, move
   with `transform: translateX(16px)`.
3. Delete `width`/`height` from `.btn-icon svg` (`buttons.css:65-68`); keep
   `flex-shrink: 0`. Verify each toolbar glyph against its `size` prop and
   adjust the props, not the CSS, if any look wrong.
4. Remove `backdrop-filter` from `.panel-overlay` (`settingsPanel.css:8`) and
   `.toolbar-indicator` (`toolbar.css:46`). Give them opaque token backgrounds
   with `--shadow-3` / `--shadow-1`.
5. Add a global `:focus-visible` outline in `base.css` using `--focus-ring`.
6. Replace every hardcoded duration/easing across the sidebar stylesheets with
   `--dur-fast` / `--dur-base` / `--ease`.
7. Apply the elevation tokens: `--shadow-1` on `.toolbar`, `--shadow-2` on the
   device dropdown and `.dropdown-menu`, `--shadow-3` on `.panel-overlay`.
   Point `zoomHud.css:15-17` at `--shadow-3` instead of its hardcoded copy.

## Constraints

- No layout, spacing, or structural change. If a component moves, it belongs in
  plan 05.
- `zoomHud.css` keeps its `backdrop-filter`. It is a small pill and the one
  place the effect is worth a composite pass.
- Do not touch `logcat.css`, `logs.css`, `fileManager.css`, `shellLogs.css` —
  those are still dark-locked and are a separate migration.

## Checks

- `rg -n "#[0-9a-fA-F]{6}" webview-ui/src/styles/settingsPanel.css` → no hits.
- `rg -n "backdrop-filter" webview-ui/src/styles` → `zoomHud.css` only.
- `rg -n "[0-9.]+m?s (ease|cubic-bezier)" webview-ui/src/styles` → no hits
  outside `tokens.css`.
- Settings and More panels are light on Light+, readable on High Contrast.
- Toggle switches animate; no layout thrash in Paint flashing.
- Keyboard focus ring visible on every toolbar button; absent on mouse click.
- Home renders visibly smaller than Recents.
- Streaming with the Settings panel open shows no per-frame composite for the
  panel layer.
- `npm run typecheck && npm run lint && npm run format:check` green.
