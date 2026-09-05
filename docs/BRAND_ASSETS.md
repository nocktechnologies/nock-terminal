# Brand Assets

Nock Terminal uses the terminal-specific `n_` identity from the 2026 brand export set.

## Source Family

The current app assets are generated from checked-in SVG sources under `assets/brand/`:

- `assets/brand/n_terminal_icon_dark.svg` for the full-color app tile.
- `assets/brand/n_terminal_icon_glyph_only.svg` for the macOS menu-bar template source.
- `assets/brand/nock_terminal_lockup_dark.svg` for dark-surface marketing lockups.
- `assets/brand/nock_terminal_lockup_light.svg` for light-surface marketing lockups.

## App Surfaces

- `assets/icon.icns` - macOS Dock, Finder, package, and app metadata icon.
- `assets/icon.ico` - Windows app and installer icon.
- `assets/icon.png` - Linux app icon and macOS About panel source.
- `assets/tray-template.png` - macOS menu-bar template icon.
- `public/nock-logo.png` - renderer UI logo, favicon, and About/settings branding.

Do not reuse the full-color app tile for the macOS menu-bar/tray icon. macOS expects a monochrome transparent template image so it can tint the icon correctly in light and dark menu bars.

## Regeneration

Run the generator after changing source SVGs:

```bash
python3 scripts/generate-brand-assets.py
```

The script regenerates `assets/icon.png`, `assets/icon.icns`, `assets/icon.ico`, `assets/tray-template.png`, and `public/nock-logo.png`.
