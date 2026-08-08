# 02 — Design token layer / theme awareness

## Problem

`webview-ui/src/styles/base.css:4-23` hardcodes a single dark palette:

```css
:root {
  --vsc-bg: #0d1117;
  --vsc-secondary: #161b22;
  --vsc-tertiary: #1c2128;
  --vsc-border: #30363d;
  --vsc-text: #e6edf3;
  --vsc-text-muted: #8b949e;
  --vsc-blue: #58a6ff;
  ...
}
```

These are GitHub-dark values. Consequences:

- A user on a light theme (or High Contrast, or any custom theme) gets a dark
  slab welded into their sidebar. It does not read as part of the editor.
- Nothing responds to `workbench.colorTheme` changes at all.
- There is no elevation, radius, or motion scale — every surface is a flat fill
  with a 1px `--vsc-border`, which is the main reason the UI reads as
  "simple, no flair" even where the layout is fine.

VS Code injects its full theme palette into every webview as `--vscode-*` CSS
custom properties, and updates them live when the theme changes. None of that is
being used.

## Change

Add `webview-ui/src/styles/tokens.css`, imported first from `index.css`, that
defines a semantic token set on `:root`:

- **Typography** — `--font-ui`, `--font-mono` (see [01](01-webview-fonts.md)),
  plus a small type scale.
- **Surfaces** — `--surface`, `--surface-raised`, `--surface-overlay`,
  `--surface-sunken`.
- **Text** — `--text`, `--text-muted`, `--text-subtle`.
- **Lines** — `--border`, `--border-strong`.
- **Accents** — `--accent`, `--accent-soft`, `--success`, `--danger`,
  `--warning`, `--info`.
- **Radii** — `--radius-sm/md/lg/pill`.
- **Elevation** — `--shadow-1/2/3`, each a layered shadow plus the inset top
  highlight that the zoom HUD already uses (`inset 0 1px 0 rgba(255,255,255,.06)`).
  That inset highlight is what makes a surface read as a raised object rather
  than a coloured rectangle.
- **Motion** — `--dur-fast` (120ms), `--dur-base` (180ms), `--ease`.

Every token is defined as `var(--vscode-<something>, <hardcoded fallback>)` so
the panel tracks the host theme but still renders correctly if a variable is
missing (older VS Code, or the Vite dev server outside a webview).

### Backwards compatibility

The existing 15 stylesheets reference `--vsc-bg`, `--vsc-border`, etc. in
hundreds of places. Rather than rewrite them all in one pass, the legacy names
are **redefined as aliases of the new tokens**:

```css
--vsc-bg: var(--surface);
--vsc-secondary: var(--surface-raised);
--vsc-border: var(--border);
...
```

so the whole UI becomes theme-aware in one edit, with no risk of a missed
call site. New and reworked components use the semantic names directly; the
`--vsc-*` aliases can be retired file-by-file later.

### Dark-locked panels (temporary)

Aliasing `--vsc-*` themes the sidebar cleanly, because its stylesheets
(`toolbar.css`, `deviceSelector.css`, `buttons.css`, `videoContainer.css`,
`zoomHud.css`, `placeholder.css`) barely hardcode any colour. The three heavy
panels are a different story:

| Stylesheet | hardcoded hex | hardcoded rgba |
|---|---|---|
| `logcat.css` | 46 | 88 |
| `logs.css` | 18 | 43 |
| `fileManager.css` | 0 | 65 |
| `shellLogs.css` | 0 | 35 |
| `tooltip.css` | 26 | 16 |

Those files hardcode *foreground* colours (log-level greens, pinks, yellows)
while taking their *background* from `--vsc-bg`. Letting the background follow a
light theme while the text stays hardcoded would make them unreadable.

So `.logcat-root`, `.fm-root` and `.sl-root` get a scoped block in `tokens.css`
that pins the tokens back to the dark fallbacks. Those panels look exactly as
they do today; the sidebar becomes theme-aware. Deleting a selector from that
block is the last step of migrating that panel, tracked in
[backlog.md](backlog.md).

`tooltip.css` needs no such block: it hardcodes both its foreground and its
background, so it stays self-consistently dark in every theme, which is a
conventional look for a tooltip.

### Motion cleanup

`transition: all` appears in `buttons.css`, `deviceSelector.css`, and ~8 places
in `logcat.css`. `all` includes layout-affecting properties, so a hover can
trigger layout + paint instead of a compositor-only change. These are narrowed
to the properties actually being animated, and a global
`@media (prefers-reduced-motion: reduce)` block collapses all durations to
`0.01ms`.

### Explicit non-goals for this change

- No component is visually redesigned here. This change only swaps the colour
  source and adds the scales. The toolbar/placeholder/settings rework is a
  separate, later change that consumes these tokens.
- `backdrop-filter` is *not* introduced anywhere new. It stays on the zoom HUD
  only. Applying it to a surface that overlaps the video canvas would force the
  blurred layer to re-composite on every decoded frame.

## Files

- `webview-ui/src/styles/tokens.css` (new)
- `webview-ui/src/styles/index.css` (import tokens first)
- `webview-ui/src/styles/base.css` (drop the hardcoded `:root` block, use tokens)
- `webview-ui/src/styles/buttons.css`, `deviceSelector.css`, `logcat.css`
  (`transition: all` → explicit property lists)

## Verification

- Switch between Dark+, Light+, and a High Contrast theme with the sidebar open.
  Text stays readable, borders stay visible, and no sidebar surface stays dark
  in a light theme.
- `rg -n "#0d1117|#161b22|#1c2128|#30363d|#e6edf3|#8b949e" webview-ui/src/styles`
  matches only: `tokens.css` (fallbacks and the dark-lock block), `logcat.css`
  and `logs.css` (inside dark-locked roots), and `tooltip.css` (self-consistently
  dark by design). Nothing in the sidebar's own stylesheets.
- `rg -n "transition: all" webview-ui/src/styles` returns nothing.
- `rg -n "JetBrains Mono|'Outfit'|fonts.googleapis" webview-ui/src media`
  returns nothing, and `media/build/webview.css` contains no `@import`.
- Mirror a device and pan/zoom — frame rate is unchanged (this change adds no
  new compositing work).

## Rollback

Remove the `tokens.css` import and restore the `:root` block in `base.css`.
The `--vsc-*` names are unchanged throughout the rest of the codebase, so
nothing else needs touching.
