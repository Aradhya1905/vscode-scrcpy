# 04 — Token cleanup and interaction pass

## Problem

Change [02](02-design-tokens.md) landed the token layer and aliased `--vsc-*`
onto it, which made most of the sidebar theme-aware in one edit. Six things were
left behind, and together they are most of the reason the UI still reads as
unfinished.

### 1. `settingsPanel.css` hardcodes dark colours outside a dark-locked root

The dark-lock block in `tokens.css:159-186` covers `.logcat-root`, `.fm-root`
and `.sl-root`. The settings and "more" panels are not in it — they live inside
the sidebar, which is theme-aware — but they still hardcode:

| Location | Value | Used for |
|---|---|---|
| `settingsPanel.css:7` | `rgba(22, 27, 34, 0.95)` | `.panel-overlay` background |
| `settingsPanel.css:94` | `#2C3038` | `.quick-action-icon` background |
| `settingsPanel.css:105` | `#353A44` | `.quick-action-icon` hover |
| `settingsPanel.css:124` | `#D1D1D1` | `.quick-action-label` text |
| `settingsPanel.css:100` | `#D1D1D1` | `.quick-action-icon svg` |
| `settingsPanel.css:113,133,167` | `rgba(88,166,255,.2)`, `rgba(48,54,61,.5)` | active / hover fills |

On Light+ the sidebar is light and these two panels open as dark slabs on top of
it. This is the single most visible remaining theme bug.

### 2. The toggle switch knob does not animate

`settingsPanel.css:211-225`:

```css
.toggle-knob {
  top: 2px;
  left: 2px;
  transition: background-color .2s, border-color .2s, color .2s,
              box-shadow .2s, opacity .2s, transform .2s;
}

.toggle-switch.active .toggle-knob {
  left: calc(100% - 22px);
}
```

The active state moves the knob with `left`, but `left` is not in the transition
list, so the knob teleports. The `transform` entry in that list animates nothing.
`left` is also a layout property — animating it would trigger reflow on every
frame of the transition.

### 3. `.btn-icon svg` overrides every lucide `size` prop

`buttons.css:65-68` sets `.btn-icon svg { width: 16px; height: 16px }`. Lucide
renders `width`/`height` as *attributes*, and a CSS rule beats a presentation
attribute, so every `size={n}` on a toolbar button is dead:

- `Toolbar.tsx:295` `<Circle size={10} />` renders at 16px
- `Toolbar.tsx:285` `<ChevronLeft size={14} />` renders at 16px
- `Toolbar.tsx:309` `<Square size={14} />` renders at 16px

The Android navigation convention — a small circle for Home, a slightly larger
square for Recents, a chevron for Back — is flattened into three glyphs of
identical weight, which is a large part of why the toolbar reads as an
undifferentiated row.

### 4. `backdrop-filter` on two surfaces that overlap the video canvas

Change 02 set this as an explicit constraint and then only enforced it for new
surfaces. Two pre-existing violations remain:

- `settingsPanel.css:8` — `.panel-overlay` has `backdrop-filter: blur(12px)` and
  is positioned `bottom: 100%` relative to `.toolbar-container`, i.e. directly
  over the video.
- `toolbar.css:46` — `.toolbar-indicator` has `backdrop-filter: blur(4px)` and
  sits at the bottom edge of the video area.

A blurred layer has to re-sample what is behind it whenever that changes, so
each of these forces a composite pass per decoded frame while it is on screen.

### 5. Nothing has a focus style

Across all of `webview-ui/src/styles/`, `:focus` / `:focus-visible` appears only
on text inputs (`base.css:101`, `logs.css:108,204`, `logcat.css:221,434`,
`settingsPanel.css:328`), `.fm-row` (`fileManager.css:381`) and the video canvas
(`videoContainer.css:84`). Neither `.btn` nor `.btn-icon` has one, so tabbing
through the toolbar gives no visible indication of where focus is.

### 6. The motion tokens are unused

`tokens.css:94-96` defines `--dur-fast`, `--dur-base` and `--ease`. No
stylesheet references them. Every file instead re-spells `0.15s ease` (or
`0.2s`, or `0.3s`) inline, including the long explicit property lists that
change 02 generated when it removed `transition: all`.

## Change

Colour source, motion, and interaction states only. No component is restructured
here — that is [05](05-toolbar-status-rework.md).

- **Migrate `settingsPanel.css` onto the tokens.** `.panel-overlay` →
  `--surface-overlay`; quick-action fills → `--surface-raised` /
  `--surface-hover`; label/glyph greys → `--text` / `--text-muted`; the blue
  active fill → `--accent-soft` (already defined via `color-mix`).
- **Fix the toggle knob.** Keep the knob at `left: 2px` and move it with
  `transform: translateX(16px)`, which is already in the transition list and is
  compositor-only.
- **Stop overriding glyph size.** Delete the `width`/`height` rule from
  `.btn-icon svg`, keeping `flex-shrink: 0`. Sizes then come from the `size`
  prop at each call site, and the existing values in `Toolbar.tsx` take effect
  as written.
- **Remove both `backdrop-filter` declarations.** `.panel-overlay` becomes an
  opaque `--surface-overlay` with `--shadow-3`; `.toolbar-indicator` becomes an
  opaque `--surface-raised` with `--shadow-1`. The zoom HUD keeps its blur — it
  is a small pill, and it is the one place where the effect earns its cost.
- **Add a single global focus style**, scoped to `:focus-visible` so it does not
  fire on mouse clicks:

  ```css
  :focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }
  ```

- **Route every transition through the motion tokens.** Replace the hardcoded
  durations with `var(--dur-fast)` / `var(--dur-base)` and `var(--ease)`. This
  also makes the `prefers-reduced-motion` block in `tokens.css:191-205`
  authoritative rather than a `!important` override fighting hardcoded values.
- **Apply the elevation tokens.** `--shadow-1` on the toolbar surface,
  `--shadow-2` on the device dropdown and `.dropdown-menu`, `--shadow-3` on
  `.panel-overlay`. `zoomHud.css:15-17` hardcodes the same recipe the tokens
  encode; point it at `--shadow-3` so there is one definition.

### Non-goals

- No layout, hierarchy, or component structure changes.
- No new elements. Every selector touched here already exists.
- `.btn-icon`'s 32px box and its 16px default glyph are already correct — the
  backlog entry claiming 26–28px targets with 12–14px glyphs is stale against
  `buttons.css:32-68` and is dropped rather than acted on.

## Files

- `webview-ui/src/styles/settingsPanel.css`
- `webview-ui/src/styles/buttons.css`
- `webview-ui/src/styles/toolbar.css`
- `webview-ui/src/styles/zoomHud.css`
- `webview-ui/src/styles/base.css` (global `:focus-visible`)
- `webview-ui/src/styles/placeholder.css`, `deviceSelector.css`,
  `videoContainer.css` (duration/easing tokens only)

## Verification

- `rg -n "#[0-9a-fA-F]{6}" webview-ui/src/styles/settingsPanel.css` returns
  nothing.
- `rg -n "backdrop-filter" webview-ui/src/styles` matches `zoomHud.css` only.
- `rg -n "[0-9.]+m?s (ease|cubic-bezier)" webview-ui/src/styles` matches nothing
  outside `tokens.css`.
- Open Settings and More on Light+ — both panels are light, text is readable,
  and no surface stays dark.
- Toggle any switch: the knob slides. DevTools → Rendering → Paint flashing
  shows no layout on the toolbar during the transition.
- Tab through the toolbar with the keyboard: a focus ring is visible on every
  button. Click the same buttons with the mouse: no ring.
- Home renders as a visibly smaller circle than the Recents square.
- Mirror a device with the Settings panel open — DevTools → Performance shows no
  per-frame composite for the panel layer.

## Outcome

Shipped on `feature/token-cleanup-interaction`. All seven plan steps landed as
written. Four things differ from the plan text:

- **The motion-token pass covers every stylesheet, not just the sidebar.**
  `logcat.css`, `logs.css`, `fileManager.css` and `shellLogs.css` are still
  dark-locked and their *colours* were left alone as the plan requires, but a
  duration is not a colour — leaving 60-odd hardcoded timings there would have
  failed this document's own third verification grep. 174 timing literals across
  13 files now resolve through `--dur-fast` / `--dur-base` / `--ease`.
- **Ambient looping animations keep their literal durations.** `pulse 2s` in
  `deviceSelector.css` and `loading-dashoffset 2s` in `placeholder.css` are
  idle-state loops, not interaction feedback; collapsing them to 180ms would
  turn a slow breath into a strobe. The `prefers-reduced-motion` block in
  `tokens.css` already overrides both. These are the only two remaining matches
  for the timing grep.
- **`tooltip.css` lost its two `backdrop-filter` declarations.** Not in the
  plan's inventory, but tooltips render over the video canvas, and
  `.tooltip-content` sits on a fully opaque gradient — the blur had nothing to
  sample and cost a composite pass for no visual result. The remaining
  `backdrop-filter` matches are all inside the four dark-locked panels, which
  are out of scope here.
- **The zoom HUD's background became a token.** It was
  `rgba(22, 27, 34, 0.92)`, so on Light+ the pill stayed dark while
  `.zoom-hud-level` inherited the theme's dark text — unreadable. It is now
  `color-mix(in srgb, var(--surface-overlay) 92%, transparent)`, which keeps the
  translucency the blur needs and follows the theme.

Two smaller notes: `.focus-ring` was rebound from `:focus` to `:focus-visible`
so it matches the new global rule, and it survives as an opt-in for controls
flush against a container edge where `outline-offset` would clip. And the
`.btn-icon svg` deletion needed no follow-up in `Toolbar.tsx` — every icon in
a `.btn-icon` (and in `ZoomHud.tsx`) already passes an explicit `size`, so
nothing fell back to lucide's 24px default.

Verified: the three greps above, `npm run typecheck && npm run lint &&
npm run format:check`, and `npm run compile:webview`. Not verified — these need
a running Extension Development Host and a human: the Light+ / High Contrast
appearance of the Settings and More panels, the knob slide, focus-ring
visibility while tabbing, the Home-vs-Recents glyph sizes, and the Performance
trace showing no per-frame composite for the panel layer.

## Rollback

Every change is a CSS edit plus the one-line `.btn-icon svg` deletion. Revert the
stylesheet; nothing in TypeScript depends on any of it.
