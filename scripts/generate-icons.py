from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"

SRC_APP_ACTIVE = ASSETS / "source-app-active-color-1024.png"
SRC_APP_INACTIVE = ASSETS / "source-app-inactive-color-1024.png"
SRC_TRAY_ACTIVE = ASSETS / "source-tray-active-color-1024.png"
SRC_TRAY_INACTIVE = ASSETS / "source-tray-inactive-color-1024.png"
SRC_MENU_ACTIVE = ASSETS / "source-menu-active-16.png"
SRC_MENU_INACTIVE = ASSETS / "source-menu-inactive-16.png"

OUT_ICON_ACTIVE_PNG = ASSETS / "icon.png"
OUT_ICON_APP_INACTIVE_PNG = ASSETS / "icon-app-inactive.png"
OUT_ICON_ACTIVE_ICO = ASSETS / "icon.ico"
OUT_ICON_ACTIVE_ICNS = ASSETS / "icon.icns"
OUT_TRAY_ACTIVE_PNG = ASSETS / "icon-tray-active.png"
OUT_TRAY_INACTIVE_PNG = ASSETS / "icon-tray-inactive.png"
OUT_MENU_ACTIVE = ASSETS / "ShutterQueue-IconMenu.png"
OUT_MENU_INACTIVE = ASSETS / "ShutterQueue-IconMenu-Inactive.png"
OUT_MENU_ACTIVE_2X = ASSETS / "ShutterQueue-IconMenu@2x.png"
OUT_MENU_INACTIVE_2X = ASSETS / "ShutterQueue-IconMenu-Inactive@2x.png"


ICO_SIZES = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
ICNS_SIZES = [(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)]
APP_PNG_SIZE = 512
TRAY_PNG_SIZE = 256



def ensure_exists(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(f"Missing required source file: {path}")



def save_resized_png(src: Path, out: Path, size: int) -> None:
    with Image.open(src).convert("RGBA") as im:
        resized = im.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(out, format="PNG", optimize=True)



def save_menu_png(src: Path, out_1x: Path, out_2x: Path) -> None:
    # macOS template icons should be black glyph + transparency only.
    # If the source has no alpha, interpret dark pixels as glyph and light pixels as transparent background.
    with Image.open(src).convert("RGBA") as im:
        alpha = im.getchannel("A")
        alpha_min, alpha_max = alpha.getextrema()

        if alpha_min == 255 and alpha_max == 255:
            # Opaque source (e.g., black icon on white background): derive alpha from inverted luminance.
            luminance = ImageOps.grayscale(im)
            alpha = ImageOps.invert(luminance)

        template = Image.new("RGBA", im.size, (0, 0, 0, 0))
        template.putalpha(alpha)

        # App currently loads a single filename for menu-bar icons.
        # We keep 1x at 22x22 to match current assets, and also emit @2x files for macOS retina use.
        one_x = template.resize((22, 22), Image.Resampling.LANCZOS)
        two_x = template.resize((44, 44), Image.Resampling.LANCZOS)
        one_x.save(out_1x, format="PNG", optimize=True)
        two_x.save(out_2x, format="PNG", optimize=True)



def save_ico(src: Path, out: Path) -> None:
    with Image.open(src).convert("RGBA") as im:
        im.save(out, format="ICO", sizes=ICO_SIZES)



def save_icns(src: Path, out: Path) -> None:
    with Image.open(src).convert("RGBA") as im:
        im.save(out, format="ICNS", sizes=ICNS_SIZES)



def main() -> None:
    for p in (SRC_APP_ACTIVE, SRC_APP_INACTIVE, SRC_TRAY_ACTIVE, SRC_TRAY_INACTIVE, SRC_MENU_ACTIVE, SRC_MENU_INACTIVE):
        ensure_exists(p)

    save_resized_png(SRC_APP_ACTIVE, OUT_ICON_ACTIVE_PNG, APP_PNG_SIZE)
    save_resized_png(SRC_APP_INACTIVE, OUT_ICON_APP_INACTIVE_PNG, APP_PNG_SIZE)
    save_resized_png(SRC_TRAY_ACTIVE, OUT_TRAY_ACTIVE_PNG, TRAY_PNG_SIZE)
    save_resized_png(SRC_TRAY_INACTIVE, OUT_TRAY_INACTIVE_PNG, TRAY_PNG_SIZE)

    save_ico(SRC_APP_ACTIVE, OUT_ICON_ACTIVE_ICO)

    save_icns(SRC_APP_ACTIVE, OUT_ICON_ACTIVE_ICNS)

    save_menu_png(SRC_MENU_ACTIVE, OUT_MENU_ACTIVE, OUT_MENU_ACTIVE_2X)
    save_menu_png(SRC_MENU_INACTIVE, OUT_MENU_INACTIVE, OUT_MENU_INACTIVE_2X)

    print("Generated icon assets:")
    for p in (
        OUT_ICON_ACTIVE_PNG,
        OUT_ICON_APP_INACTIVE_PNG,
        OUT_ICON_ACTIVE_ICO,
        OUT_ICON_ACTIVE_ICNS,
        OUT_TRAY_ACTIVE_PNG,
        OUT_TRAY_INACTIVE_PNG,
        OUT_MENU_ACTIVE,
        OUT_MENU_INACTIVE,
        OUT_MENU_ACTIVE_2X,
        OUT_MENU_INACTIVE_2X,
    ):
        print(f"- {p}")


if __name__ == "__main__":
    main()
