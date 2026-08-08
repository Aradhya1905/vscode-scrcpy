# 01 — Webview fonts

## Problem

`webview-ui/src/styles/base.css:1` starts with:

```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@300;400;500;600&display=swap');
```

The webview CSP in `media/webview.html` is:

```
default-src 'none'; style-src {{cspSource}} 'unsafe-inline'; script-src {{cspSource}} 'unsafe-inline'; img-src {{cspSource}} data: blob:;
```

`fonts.googleapis.com` is not in `style-src`, and `fonts.gstatic.com` (where the
actual woff2 files live) is not in any directive. The request is blocked by the
browser before it leaves the process.

The import also survives the production build — it is the first thing in
`media/build/webview.css`. So on every install, in every window:

- `font-family: 'Outfit', ...` silently falls back to `-apple-system` /
  `Segoe UI`.
- `font-family: 'JetBrains Mono', monospace` (used by `.zoom-hud-level` and the
  log panels) silently falls back to the generic `monospace`.
- Each webview load also spends time on a blocked network request that can
  delay first paint, because `@import` is render-blocking.

Net effect: none of the typography in the design was ever actually seen, and the
UI reads as unstyled default-sans.

## Decision

Do **not** re-add a remote font. Two options were considered:

1. **Self-host the woff2 files** under `media/fonts/`, reference them with
   `webview.asWebviewUri`, and add `font-src {{cspSource}}` to the CSP.
   Keeps the branded look. Costs ~100 KB of committed binaries per family and
   a CSP change.
2. **Use the fonts the user already picked in VS Code** — `--vscode-font-family`
   for UI text and `--vscode-editor-font-family` for anything tabular/monospace.

Option 2 is chosen. For an editor extension this is the more correct default:
the panel inherits the host's typography, matches every other part of the
window, costs zero bytes, cannot be blocked, and respects users who have
deliberately configured a font (including for accessibility or CJK coverage).

Option 1 stays open — the plan records exactly what would need to change if the
branded typeface is wanted later. It is an additive change on top of this one.

## Change

- Delete the `@import url(...)` line from `webview-ui/src/styles/base.css`.
- Route both font stacks through the new token layer (see
  [02-design-tokens.md](02-design-tokens.md)), which defines:
  - `--font-ui` → `var(--vscode-font-family, <system stack>)`
  - `--font-mono` → `var(--vscode-editor-font-family, <mono stack>)`
- Replace the hardcoded `'Outfit', ...` stack on `body` with `var(--font-ui)`.
- Replace `'JetBrains Mono', monospace` occurrences with `var(--font-mono)`.

## Files

- `webview-ui/src/styles/base.css`
- `webview-ui/src/styles/tokens.css` (new — defines the two font tokens)
- `webview-ui/src/styles/zoomHud.css`
- any other stylesheet naming `Outfit` or `JetBrains Mono`

## Verification

- `rg -n "fonts.googleapis|JetBrains Mono|'Outfit'" webview-ui/src media` returns nothing.
- `npm run compile:webview`, then confirm `media/build/webview.css` has no `@import`
  of an `http(s)` URL.
- Open the sidebar, DevTools → Network: no request to `fonts.googleapis.com`,
  no CSP violation in Console.
- The zoom HUD percentage stays monospaced and tabular (it also sets
  `font-variant-numeric: tabular-nums`, which the editor font will honour).

## Rollback

Restore the `@import` line. Nothing else depends on it. (It will still be blocked.)
