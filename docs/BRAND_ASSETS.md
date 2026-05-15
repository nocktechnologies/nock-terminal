# Brand Assets

Nock Terminal uses the core green Nock identity, not the Forge rose variant.

## Source Family

The current app assets were generated from the green Nock export set:

- `nock-icon-1024.png` for the full-color app tile
- `n_icon_glyph_only.svg` for the monochrome tray template source

## App Surfaces

- `assets/icon.icns` - macOS Dock, Finder, package, and app metadata icon.
- `assets/icon.ico` - Windows app and installer icon.
- `assets/icon.png` - Linux app icon and macOS About panel source.
- `assets/tray-template.png` - macOS menu-bar template icon.
- `public/nock-logo.png` - renderer UI logo, favicon, and About/settings branding.

Do not reuse the full-color app tile for the macOS menu-bar/tray icon. macOS expects a monochrome transparent template image so it can tint the icon correctly in light and dark menu bars.
