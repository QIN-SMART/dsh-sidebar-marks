# dsh-sidebar-marks

Mark conversations in the DSH sidebar: a **soft tinted background** (any color, any strength), a **colored dot** at the row's end or before the title, and an optional **per-conversation title size**. Conversations you never marked look exactly like the stock UI.

```
dsh plugin --profile web add github:QIN-SMART/dsh-sidebar-marks
# then reload the browser page
```

[中文说明](README.md) · no runtime dependencies · self test needs nothing but Node

![verify](https://github.com/QIN-SMART/dsh-sidebar-marks/actions/workflows/verify.yml/badge.svg)

![Marks rendered on a 1:1 DSH sidebar mock (example data)](docs/verify-light.png)

## How to use it

| Entry point | Action |
|---|---|
| Row menu | Hover a conversation row → **…** → **Mark…** |
| Keyboard | Press **⌘⇧M** (macOS) / **Ctrl+Shift+M** (Windows, Linux) to mark the conversation you are viewing |
| Mouse | Right-click any conversation row |

Everything applies instantly and is saved instantly (no Save button). `Esc` or a click outside closes the panel.

## What you can set

| Axis | Values |
|---|---|
| Color | 6 presets (blue / green / amber / red / violet / slate), **any custom color** through the color picker or a hex code (`#8b5cf6`, `#abc`), or none |
| Row tint strength | 8% / **10%** / 12% / 16% / 22% / off — the dark theme automatically uses one step more (+4 points), because the same percentage looks lighter there |
| Dot | right end / left of the title / both / none |
| Title size | keep as is, or 12 / 13 / 14 / 15 / 16 px (weight 400 / 500 / 600) |

![The mark panel](docs/verify-light-panel.png)

## Install

Pick whichever spec your setup allows:

```sh
# from a git repository (recommended for sharing)
dsh plugin --profile web add github:QIN-SMART/dsh-sidebar-marks

# from a local checkout
dsh plugin --profile web add "link:/absolute/path/to/dsh-sidebar-marks"

# from npm, once published
dsh plugin --profile web add dsh-sidebar-marks
```

> **Within 24 hours of a release**: pnpm 11 defaults to `minimumReleaseAge=1440` minutes and
> skips versions that young, so `add dsh-sidebar-marks` can fail with `No matching version found`.
> Pin the version instead - pnpm then records it in the profile's `minimumReleaseAgeExclude`
> and installs it: `dsh plugin --profile web add dsh-sidebar-marks@0.1.0`.

Then reload the browser page. No host restart is needed for a package the running host has already resolved; a plugin that is new to the process is picked up when the profile recomposes, and their client bundle loads on the next page load.

Uninstall with `dsh plugin --profile web remove dsh-sidebar-marks`.

## Platform support

The plugin is browser-side only: one injected stylesheet, a few `data-*` attributes on sidebar rows, two slot components and a small panel. Nothing in it is platform specific.

- **macOS / Windows / Linux**: the shortcut hint follows the platform (`⌘⇧M` vs `Ctrl+Shift+M`); the handler itself accepts either modifier.
- **Light and dark**: both themes are covered by CSS (`body[data-ds-dark-theme]`), color pairs are written per row.
- **Language**: panel and menu copy follow DSH's own `<html lang>` (中文 / English).
- CI runs the self test on ubuntu, windows and macos with Node 22 and 24, and the suite now reloads the real bundle with `navigator.platform = 'Win32'` to exercise the Windows branch (Ctrl+Shift+M path, platform-specific hint, IME guard).
- The panel and its backdrop declare `-webkit-app-region: no-drag`: on the Windows/macOS desktop builds the caption band is a window drag region, and without it clicks in that strip would drag the window instead.

Windows users: the same commands work in PowerShell (`dsh plugin --profile web add "link:C:\path\to\dsh-sidebar-marks"` — keep the quotes). Nothing in the plugin touches the filesystem, so drive letters, backslashes and case-insensitive paths never come into play.

## Verify

```sh
node --test test/verify.mjs          # the whole suite, no dependencies
```

The suite loads the **real** `lib/client.js` through the real `window.__ModuleLoader__.load` path on a minimal DOM stub and covers: module shape, slot registration, style tagging, row annotation idempotence and cleanup, untouched rows, archived/running degradation, hotkey and right-click, panel lifecycle, persistence round-trips, dropping foreign and legacy data, cross-tab sync, disposing everything, the "no hashed class names" CSS rule, custom colors and the zh/en copy switch.

In a browser: open `demo/plugin-harness.html` (`?theme=dark`, `?panel=1`) — it loads the real bundle into a DSH-shaped DOM and prints 13 assertions. `demo/sidebar-marks-lab.html` is an interactive playground (light + dark side by side).

In the running app, `window.__dshSidebarMarks` gives you `marks`, `set(id, mark)`, `clear(id)`, `open(id)`, `rescan()`.

## How it works

- The dot in front of the title goes into the official slot `sidebar.session.row.leading`; the tint and the title size cannot be expressed as a slot, so the plugin annotates the row element through the stable hook `div[role="treeitem"][data-row-key="session:<id>"]` — no CSS-module hashed class name is ever used.
- The tint is `background-image: linear-gradient(var(--dshmk-fill), var(--dshmk-fill)) !important`. DSH's hover/selected rule uses the `background` shorthand (which resets `background-image`), so the `!important` is what keeps the tint alive; `background-color` is untouched, so hover still darkens it.
- The dot at the row's end is painted with a `radial-gradient`, plus 20px of reserved right padding — it takes no layout space, cannot be eaten by hover, and does not disturb React.
- Colors are written per row as `--dshmk-color-light` / `--dshmk-color-dark`, so presets and custom hex codes take the same path and the theme switch is pure CSS.
- Marks live in `localStorage['dsh.sidebar-marks.v1']`, the same approach as the official sidebar-right pane, and sync across tabs through the `storage` event.

## License

MIT — see [LICENSE](LICENSE).
