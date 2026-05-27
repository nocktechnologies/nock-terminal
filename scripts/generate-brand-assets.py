#!/usr/bin/env python3
"""Generate Nock Terminal app icons from checked-in brand SVGs."""

from __future__ import annotations

import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
BRAND = ASSETS / "brand"
APP_ICON_SVG = BRAND / "n_terminal_icon_dark.svg"
TRAY_ICON_SVG = BRAND / "n_terminal_icon_glyph_only.svg"

ICONSET_SIZES = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]
ICO_SIZES = [16, 32, 48, 64, 128, 256]


def render_svg(svg_text: str, output_path: Path, size: int) -> None:
    html = f"""
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          html, body {{
            margin: 0;
            width: {size}px;
            height: {size}px;
            overflow: hidden;
            background: transparent;
          }}
          svg {{
            display: block;
            width: {size}px;
            height: {size}px;
          }}
        </style>
      </head>
      <body>{svg_text}</body>
    </html>
    """
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": size, "height": size}, device_scale_factor=1)
        page.set_content(html, wait_until="networkidle")
        page.screenshot(path=str(output_path), omit_background=True, animations="disabled")
        browser.close()


def png_dimensions(png: bytes) -> tuple[int, int]:
    if png[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("ICO inputs must be PNG files")
    return struct.unpack(">II", png[16:24])


def write_ico(png_paths: list[Path], output_path: Path) -> None:
    images = [path.read_bytes() for path in png_paths]
    header = struct.pack("<HHH", 0, 1, len(images))
    directory = bytearray()
    offset = 6 + 16 * len(images)

    for png in images:
        width, height = png_dimensions(png)
        directory.extend(struct.pack(
            "<BBBBHHII",
            0 if width >= 256 else width,
            0 if height >= 256 else height,
            0,
            0,
            1,
            32,
            len(png),
            offset,
        ))
        offset += len(png)

    output_path.write_bytes(header + bytes(directory) + b"".join(images))


def main() -> None:
    if not APP_ICON_SVG.exists():
        raise SystemExit(f"Missing source SVG: {APP_ICON_SVG}")
    if not TRAY_ICON_SVG.exists():
        raise SystemExit(f"Missing source SVG: {TRAY_ICON_SVG}")

    ASSETS.mkdir(exist_ok=True)
    app_svg = APP_ICON_SVG.read_text()
    tray_svg = (
        TRAY_ICON_SVG.read_text()
        .replace('fill="#1A1B22"', 'fill="#000000"')
        .replace('fill="#3F5870"', 'fill="#000000"')
    )

    with tempfile.TemporaryDirectory(prefix="nock-brand-icons-") as temp_name:
        temp = Path(temp_name)
        iconset = temp / "icon.iconset"
        iconset.mkdir()

        render_svg(app_svg, ASSETS / "icon.png", 1024)
        shutil.copyfile(ASSETS / "icon.png", ROOT / "public" / "nock-logo.png")
        render_svg(tray_svg, ASSETS / "tray-template.png", 32)

        for name, size in ICONSET_SIZES:
            render_svg(app_svg, iconset / name, size)

        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(ASSETS / "icon.icns")],
            check=True,
        )

        ico_paths = []
        for size in ICO_SIZES:
            path = temp / f"icon-{size}.png"
            render_svg(app_svg, path, size)
            ico_paths.append(path)
        write_ico(ico_paths, ASSETS / "icon.ico")

    print("Generated:")
    for path in [ASSETS / "icon.png", ASSETS / "icon.icns", ASSETS / "icon.ico", ASSETS / "tray-template.png", ROOT / "public" / "nock-logo.png"]:
        print(path.relative_to(ROOT))


if __name__ == "__main__":
    main()
