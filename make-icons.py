#!/usr/bin/env python3
"""
Creates every icon Setlist needs and keeps the app in sync with them.

  python3 make-icons.py                      draw the default equalizer icon
  python3 make-icons.py --logo my-logo.png   build the icons from your own logo
  python3 make-icons.py --bg "#111111" --accent "#00C2A8"   change the colours

Run it from the setlist/ folder. It will:
  1. write icons/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
  2. check that index.html, manifest.webmanifest and sw.js all point at those files
  3. bump VERSION in sw.js so phones download the new icons (skip with --no-bump)

Needs Pillow:  pip install pillow
"""
import argparse
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
ICON_DIR = ROOT / "icons"

# name -> (pixel size, fraction of the square the artwork may fill)
# Maskable icons get extra padding because Android crops them into a circle or squircle.
TARGETS = {
    "icon-192.png": (192, 0.60),
    "icon-512.png": (512, 0.60),
    "icon-maskable-512.png": (512, 0.46),
    "apple-touch-icon.png": (180, 0.60),
}


def hex_to_rgb(value: str):
    value = value.lstrip("#")
    if len(value) == 3:
        value = "".join(c * 2 for c in value)
    if len(value) != 6:
        sys.exit(f"Colour must look like #2438E0, got: {value}")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def draw_bars(size, fill, bg, fg, accent):
    """The default icon: five rounded equalizer bars."""
    scale = 4  # draw big, shrink for smooth edges
    s = size * scale
    img = Image.new("RGB", (s, s), bg)
    d = ImageDraw.Draw(img)
    zone = s * fill
    x0 = (s - zone) / 2
    y0 = (s - zone) / 2
    heights = [0.45, 0.80, 0.60, 1.00, 0.70]
    colours = [fg, accent, fg, accent, fg]
    gap = zone * 0.06
    bar_w = (zone - gap * (len(heights) - 1)) / len(heights)
    for i, (h, c) in enumerate(zip(heights, colours)):
        bar_h = zone * h
        x = x0 + i * (bar_w + gap)
        y = y0 + (zone - bar_h)
        d.rounded_rectangle([x, y, x + bar_w, y + bar_h], radius=bar_w / 2, fill=c)
    return img.resize((size, size), Image.LANCZOS)


def logo_on_square(size, fill, bg, logo):
    """Place the user's logo in the middle of a solid square, keeping its proportions."""
    canvas = Image.new("RGB", (size, size), bg)
    box = int(size * fill)
    art = logo.copy()
    art.thumbnail((box, box), Image.LANCZOS)
    x = (size - art.width) // 2
    y = (size - art.height) // 2
    canvas.paste(art, (x, y), art)  # uses the logo's own transparency
    return canvas


def check_wiring():
    """Warn if any file that should mention the icons does not."""
    problems = []
    checks = {
        "index.html": ["icons/icon-192.png", "icons/apple-touch-icon.png", "manifest.webmanifest"],
        "manifest.webmanifest": ["icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"],
        "sw.js": ["./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png"],
    }
    for filename, needles in checks.items():
        path = ROOT / filename
        if not path.exists():
            problems.append(f"{filename} is missing")
            continue
        text = path.read_text(encoding="utf-8")
        for needle in needles:
            if needle not in text:
                problems.append(f"{filename} does not mention {needle}")
    return problems


def bump_service_worker():
    path = ROOT / "sw.js"
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    match = re.search(r"const VERSION = 'setlist-shell-v(\d+)'", text)
    if not match:
        return None
    new = int(match.group(1)) + 1
    text = text.replace(match.group(0), f"const VERSION = 'setlist-shell-v{new}'")
    path.write_text(text, encoding="utf-8")
    return new


def main():
    ap = argparse.ArgumentParser(description="Create Setlist app icons.")
    ap.add_argument("--logo", help="path to your own logo (PNG with a transparent background works best)")
    ap.add_argument("--bg", default="#2438E0", help="background colour (default #2438E0)")
    ap.add_argument("--fg", default="#F6F4FF", help="main bar colour for the default icon")
    ap.add_argument("--accent", default="#FF8A3D", help="accent bar colour for the default icon")
    ap.add_argument("--no-bump", action="store_true", help="do not change the service worker version")
    args = ap.parse_args()

    bg, fg, accent = hex_to_rgb(args.bg), hex_to_rgb(args.fg), hex_to_rgb(args.accent)

    logo = None
    if args.logo:
        logo_path = Path(args.logo)
        if not logo_path.exists():
            sys.exit(f"Could not find {logo_path}")
        logo = Image.open(logo_path).convert("RGBA")
        if min(logo.size) < 256:
            print("Note: your logo is small. A 512x512 or larger image will look sharper.")

    ICON_DIR.mkdir(exist_ok=True)
    for name, (size, fill) in TARGETS.items():
        img = logo_on_square(size, fill, bg, logo) if logo else draw_bars(size, fill, bg, fg, accent)
        img.save(ICON_DIR / name)
        print(f"wrote icons/{name} ({size}x{size})")

    problems = check_wiring()
    if problems:
        print("\nThese files need attention:")
        for p in problems:
            print(f"  - {p}")
    else:
        print("\nindex.html, manifest.webmanifest and sw.js all point at the icons.")

    if not args.no_bump:
        new = bump_service_worker()
        if new:
            print(f"Bumped sw.js to setlist-shell-v{new}, so phones will fetch the new icons.")

    print("\nDone. Redeploy, then remove and reinstall the app on your phone to see the new icon.")


if __name__ == "__main__":
    main()
