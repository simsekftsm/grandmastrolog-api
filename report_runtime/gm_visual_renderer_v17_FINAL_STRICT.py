#!/usr/bin/env python3
"""
GrandMastrolog v17 canonical renderer — FINAL STRICT VERSION

Bu sürümün tek ilkesi:
- kanonik görsel sanatını yeniden üretme YASAK,
- yalnız izinli dinamik alanlar değişir,
- Page 1 için temiz master veya temiz patch yoksa fail-closed.

KULLANIM
--------
python gm_visual_renderer_v17.py pdf input.json output.pdf
python gm_visual_renderer_v17.py elements input.json output.png
"""

from __future__ import annotations

import argparse
import json
import math
import unicodedata
from pathlib import Path
from typing import Any, Iterable

from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

HERE = Path(__file__).resolve().parent
ASSETS_DIR = HERE / "assets"
REFERENCE_DIR = HERE / "reference"
FONT_DIR = HERE / "fonts"

ZODIAC_DIR = ASSETS_DIR / "zodiac"
ELEMENT_DIR = ASSETS_DIR / "elements"
ELEMENT_OPENING_DIR = ASSETS_DIR / "elements_opening"

# Preferred assets
PAGE1_CLEAN_CANDIDATES = [
    REFERENCE_DIR / "Page_1_CANONICAL_CLEAN.png",
    REFERENCE_DIR / "Page_1_CANONICAL.clean.png",
    REFERENCE_DIR / "Page_1_CANONICAL_clean.png",
]
PAGE1_BASE_CANDIDATES = [
    REFERENCE_DIR / "Page_1_CANONICAL.png",
]
PAGE2_CANDIDATES = [
    REFERENCE_DIR / "Page_2_CANONICAL.png",
]
PAGE3_CANDIDATES = [
    REFERENCE_DIR / "Page_3_CANONICAL.png",
]
ELEMENT_OPENING_CANDIDATES = [
    REFERENCE_DIR / "4_element_opening.png",
    REFERENCE_DIR / "4_element.png",
]

# Optional exact clean patches for Page 1 if a fully clean master is not available.
PAGE1_PATCHES = {
    "birth_values": {
        "file": "page1_birth_values_clean.png",
        "box": (300, 334, 498, 594),
    },
    "senin_yolun": {
        "file": "page1_senin_yolun_clean.png",
        "box": (78, 846, 492, 1084),
    },
    "synergy_title": {
        "file": "page1_synergy_title_clean.png",
        "box": (78, 1141, 492, 1183),
    },
    "synergy_body": {
        "file": "page1_synergy_body_clean.png",
        "box": (78, 1198, 492, 1382),
    },
    "motto": {
        "file": "page1_motto_clean.png",
        "box": (196, 1456, 836, 1490),
    },
    "asc_slot": {
        "file": "page1_asc_slot_clean.png",
        "box": (650, 430, 1010, 910),
    },
    "sun_slot": {
        "file": "page1_sun_slot_clean.png",
        "box": (635, 930, 1010, 1385),
    },
}

REF_W = 1024
REF_H = 1535

A4_W, A4_H = A4

# ---------------------------------------------------------------------------
# Canonical palette
# ---------------------------------------------------------------------------

GOLD = HexColor("#d9a52d")
PALE_GOLD = HexColor("#e4c272")
INK = HexColor("#f3e7c8")
SOFT_INK = HexColor("#dcc79a")

ELEMENT_COLORS = {
    "Ateş": "#ff8412",
    "Toprak": "#c5dd1c",
    "Hava": "#cde2ee",
    "Su": "#96d8ff",
}

SIGNS = [
    "Koç", "Boğa", "İkizler", "Yengeç", "Aslan", "Başak",
    "Terazi", "Akrep", "Yay", "Oğlak", "Kova", "Balık",
]

SIGN_ALIASES = {
    "Koc": "Koç",
    "Boga": "Boğa",
    "Ikizler": "İkizler",
    "Yengec": "Yengeç",
    "Basak": "Başak",
    "Oglaq": "Oğlak",
    "Oglak": "Oğlak",
}
ELEMENT_API_KEYS = {
    "Ateş": "fire",
    "Toprak": "earth",
    "Hava": "air",
    "Su": "water",
}
ELEMENT_FILE_CANDIDATES = {
    "Ateş": ["ates.png", "fire.png"],
    "Toprak": ["toprak.png", "earth.png"],
    "Hava": ["hava.png", "air.png"],
    "Su": ["su.png", "water.png"],
}


class RendererError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def choose_existing(candidates: Iterable[Path], label: str) -> Path:
    for p in candidates:
        if p.exists():
            return p
    raise RendererError(f"missing required {label}: {[str(c) for c in candidates]}")


def optional_existing(candidates: Iterable[Path]) -> Path | None:
    for p in candidates:
        if p.exists():
            return p
    return None


def normalize_sign(value: Any) -> str:
    s = str(value or "").strip()
    if not s:
        raise RendererError("missing zodiac sign name")
    if s in SIGN_ALIASES:
        return SIGN_ALIASES[s]
    return s


def strip_accents_lower(value: str) -> str:
    return ''.join(
        ch for ch in unicodedata.normalize('NFKD', value)
        if not unicodedata.combining(ch)
    ).lower()


def zodiac_asset(sign: str) -> Path:
    sign = normalize_sign(sign)
    candidates = [
        ZODIAC_DIR / f"{sign} burcu.png",
        ZODIAC_DIR / f"{sign}.png",
        ZODIAC_DIR / f"{strip_accents_lower(sign)}_burcu.png",
        ZODIAC_DIR / f"{strip_accents_lower(sign)}.png",
    ]
    # also scan directory robustly
    if ZODIAC_DIR.exists():
        want = strip_accents_lower(sign)
        for p in ZODIAC_DIR.glob("*.png"):
            stem = strip_accents_lower(p.stem.replace("_", " ").replace("-", " "))
            if want in stem:
                candidates.insert(0, p)
    for c in candidates:
        if c.exists():
            return c
    raise RendererError(f"missing zodiac asset for sign: {sign}")


def element_asset(name_tr: str) -> Path:
    candidates = [ELEMENT_DIR / n for n in ELEMENT_FILE_CANDIDATES[name_tr]]
    return choose_existing(candidates, f"element asset for {name_tr}")


def _need(obj: dict[str, Any], key: str) -> Any:
    if key not in obj or obj[key] in ("", None):
        raise RendererError(f"missing required field: {key}")
    return obj[key]


def load_json(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def human_date_tr(value: Any) -> str:
    s = str(value or "").strip()
    if not s:
        return ""
    months = [
        "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
        "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
    ]
    for sep in (".", "-", "/"):
        parts = s.split(sep)
        if len(parts) == 3 and all(p.strip().isdigit() for p in parts):
            a, b, c = [int(x) for x in parts]
            # yyyy-mm-dd
            if len(str(a)) == 4:
                yyyy, mm, dd = a, b, c
            else:
                dd, mm, yyyy = a, b, c
            if 1 <= mm <= 12 and 1 <= dd <= 31:
                return f"{dd} {months[mm-1]} {yyyy}"
    return s


def ref_xy(x: float, y: float, w: float, h: float) -> tuple[float, float]:
    return x / REF_W * w, h - (y / REF_H * h)


def ref_rect(x1: float, y1: float, x2: float, y2: float, w: float, h: float) -> tuple[float, float, float, float]:
    left = x1 / REF_W * w
    bottom = h - (y2 / REF_H * h)
    width = (x2 - x1) / REF_W * w
    height = (y2 - y1) / REF_H * h
    return left, bottom, width, height


def register_fonts() -> None:
    serif_candidates = [
        (
            FONT_DIR / "CormorantGaramond-Regular.ttf",
            FONT_DIR / "CormorantGaramond-Bold.ttf",
            FONT_DIR / "CormorantGaramond-Italic.ttf",
        ),
        (
            FONT_DIR / "EBGaramond-Regular.ttf",
            FONT_DIR / "EBGaramond-Bold.ttf",
            FONT_DIR / "EBGaramond-Italic.ttf",
        ),
        (
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf"),
        ),
        (
            Path("/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf"),
            Path("/usr/share/fonts/truetype/liberation2/LiberationSerif-Bold.ttf"),
            Path("/usr/share/fonts/truetype/liberation2/LiberationSerif-Italic.ttf"),
        ),
    ]
    chosen = None
    for trio in serif_candidates:
        if all(p.exists() for p in trio):
            chosen = trio
            break
    if chosen is None:
        raise RendererError("no serif font set found in runtime")
    reg, bold, italic = chosen
    pdfmetrics.registerFont(TTFont("GMSerif", str(reg)))
    pdfmetrics.registerFont(TTFont("GMSerifBold", str(bold)))
    pdfmetrics.registerFont(TTFont("GMSerifItalic", str(italic)))

    sans = None
    for p in [
        FONT_DIR / "DejaVuSans.ttf",
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"),
    ]:
        if p.exists():
            sans = p
            break
    if sans is None:
        raise RendererError("no sans/symbol font found in runtime")
    pdfmetrics.registerFont(TTFont("GMSans", str(sans)))


def validate(data: dict[str, Any], for_pdf: bool = True) -> None:
    profile = _need(data, "profile")
    for k in ["birth_date", "birth_time", "birth_place", "report_date"]:
        _need(profile, k)
    _need(data, "sun_sign")
    _need(data, "asc_sign")
    _need(data, "senin_yolun")
    _need(data, "synergy_text")
    _need(data, "motto")
    _need(data, "elements")
    vals = canonical_element_values(data)
    for _, v in vals.items():
        _ = float(v)
    if for_pdf:
        # strict page-1 contract
        _ = page1_asset_strategy()
        _ = zodiac_asset(normalize_sign(data["asc_sign"]))
        _ = zodiac_asset(normalize_sign(data["sun_sign"]))


# ---------------------------------------------------------------------------
# Text fitting
# ---------------------------------------------------------------------------

def split_words(text: str) -> list[str]:
    text = " ".join(str(text or "").replace("\n", " \n ").split())
    parts: list[str] = []
    for token in text.split(" "):
        if token == r"\n":
            parts.append("\n")
        else:
            parts.append(token)
    return parts


def wrap_lines(c: canvas.Canvas, text: str, font: str, size: float, max_width: float) -> list[str]:
    text = str(text or "").replace("\r", "")
    paragraphs = text.split("\n")
    lines: list[str] = []
    c.setFont(font, size)
    for para in paragraphs:
        words = para.split()
        if not words:
            lines.append("")
            continue
        current = words[0]
        for word in words[1:]:
            trial = current + " " + word
            if c.stringWidth(trial, font, size) <= max_width:
                current = trial
            else:
                lines.append(current)
                current = word
        lines.append(current)
    return lines


def fit_text(c: canvas.Canvas, text: str, x: float, y: float, max_width: float,
             font: str, size: float, min_size: float, leading: float,
             max_lines: int, color) -> tuple[float, int]:
    current = size
    lines: list[str] = []
    while current >= min_size:
        lines = wrap_lines(c, text, font, current, max_width)
        if len(lines) <= max_lines:
            break
        current -= 0.4
    c.setFillColor(color)
    c.setFont(font, current)
    yy = y
    for line in lines[:max_lines]:
        c.drawString(x, yy, line)
        yy -= leading * (current / size)
    return current, len(lines[:max_lines])


def draw_centred_fit(c: canvas.Canvas, text: str, cx: float, cy: float,
                     max_width: float, font: str, size: float,
                     min_size: float, color) -> float:
    current = size
    while current >= min_size and c.stringWidth(text, font, current) > max_width:
        current -= 0.4
    c.setFont(font, current)
    c.setFillColor(color)
    c.drawCentredString(cx, cy, text)
    return current


# ---------------------------------------------------------------------------
# Page 1 asset strategy
# ---------------------------------------------------------------------------

def page1_asset_strategy() -> dict[str, Any]:
    clean = optional_existing(PAGE1_CLEAN_CANDIDATES)
    if clean is not None:
        return {"mode": "clean_master", "base": clean}

    base = optional_existing(PAGE1_BASE_CANDIDATES)
    if base is None:
        raise RendererError("missing Page 1 canonical base")

    patch_dir_candidates = [
        REFERENCE_DIR / "page1_patches",
        HERE / "page1_patches",
        REFERENCE_DIR / "patches",
    ]
    patch_dir = None
    for d in patch_dir_candidates:
        if d.exists():
            patch_dir = d
            break
    if patch_dir is None:
        raise RendererError(
            "Page 1 exact rendering requires Page_1_CANONICAL_CLEAN.png "
            "or a page1_patches directory with all clean patches."
        )

    resolved: dict[str, Any] = {"mode": "patched_base", "base": base, "patch_dir": patch_dir, "patches": {}}
    for key, meta in PAGE1_PATCHES.items():
        path = patch_dir / meta["file"]
        if not path.exists():
            raise RendererError(
                f"missing Page 1 clean patch: {path.name}. "
                "Exact canonical rendering cannot continue."
            )
        resolved["patches"][key] = {"path": path, "box": meta["box"]}
    return resolved


# ---------------------------------------------------------------------------
# PDF drawing
# ---------------------------------------------------------------------------

def draw_reference_page(c: canvas.Canvas, path: Path, w: float, h: float) -> None:
    if not path.exists():
        raise RendererError(f"missing reference image: {path.name}")
    c.drawImage(ImageReader(str(path)), 0, 0, width=w, height=h, mask="auto")


def draw_image_fit(c: canvas.Canvas, img_path: Path, x: float, y: float,
                   width: float, height: float, anchor: str = 'c') -> None:
    c.drawImage(
        ImageReader(str(img_path)),
        x, y,
        width=width, height=height,
        mask="auto",
        preserveAspectRatio=True,
        anchor=anchor,
    )


def draw_patch(c: canvas.Canvas, patch_path: Path, box: tuple[float, float, float, float], w: float, h: float) -> None:
    x, y, bw, bh = ref_rect(*box, w, h)
    c.drawImage(ImageReader(str(patch_path)), x, y, width=bw, height=bh, mask="auto")


def draw_page_number(c: canvas.Canvas, num: int, w: float, h: float) -> None:
    # Page 1 page number stays on the canonical art.
    cx, cy = ref_xy(962, 67, w, h)
    c.setFillColor(PALE_GOLD)
    c.setFont("GMSerifBold", 15.5)
    c.drawCentredString(cx, cy, f"{num:02d}")


def draw_sign_slot(c: canvas.Canvas, sign: str, role: str, w: float, h: float) -> None:
    sign = normalize_sign(sign)
    asset = zodiac_asset(sign)

    # Slot boxes matched to the original approved composition area.
    if role == "asc":
        slot = (650, 430, 1010, 910)
        role_label = "YÜKSELEN"
    elif role == "sun":
        slot = (635, 930, 1010, 1385)
        role_label = "GÜNEŞ"
    else:
        raise RendererError(f"unknown sign slot role: {role}")

    x, y, bw, bh = ref_rect(*slot, w, h)

    # Use only the provided zodiac artwork, no generated ornament/recoloring.
    pad_x = bw * 0.08
    pad_y_top = bh * 0.06
    pad_y_bottom = bh * 0.15
    art_x = x + pad_x
    art_y = y + pad_y_bottom
    art_w = bw - (2 * pad_x)
    art_h = bh - (pad_y_top + pad_y_bottom)

    draw_image_fit(c, asset, art_x, art_y, art_w, art_h, anchor="c")

    label_y = y + 18
    name_y = y + 34
    cx = x + bw / 2

    c.setFillColor(SOFT_INK)
    c.setFont("GMSerifBold", 8.8)
    c.drawCentredString(cx, label_y, role_label)
    c.setFillColor(PALE_GOLD)
    c.setFont("GMSerifBold", 11.4)
    c.drawCentredString(cx, name_y, sign.upper())


def page1(c: canvas.Canvas, data: dict[str, Any], w: float, h: float) -> None:
    strat = page1_asset_strategy()
    prof = data["profile"]

    draw_reference_page(c, strat["base"], w, h)

    if strat["mode"] == "patched_base":
        for key in ["birth_values", "senin_yolun", "synergy_title", "synergy_body", "motto", "asc_slot", "sun_slot"]:
            meta = strat["patches"][key]
            draw_patch(c, meta["path"], meta["box"], w, h)

    # Dynamic zodiac visuals
    draw_sign_slot(c, data["asc_sign"], "asc", w, h)
    draw_sign_slot(c, data["sun_sign"], "sun", w, h)

    # Birth data
    values = [
        human_date_tr(prof["birth_date"]),
        str(prof["birth_time"]),
        str(prof["birth_place"]),
        human_date_tr(prof["report_date"]),
    ]
    value_x = 310
    value_ys = [361, 431, 501, 568]
    c.setFillColor(PALE_GOLD)
    c.setFont("GMSerif", 13.3)
    for value, yy in zip(values, value_ys):
        x, y = ref_xy(value_x, yy, w, h)
        c.drawString(x, y, value)

    # Senin Yolun
    senin_yolun = data.get("senin_yolun", "")
    if isinstance(senin_yolun, list):
        senin_yolun = " ".join(map(str, senin_yolun))
    x, y = ref_xy(65, 858, w, h)
    fit_text(
        c, str(senin_yolun), x, y, 415 / REF_W * w,
        font="GMSerif", size=13.0, min_size=10.4,
        leading=18.0, max_lines=10, color=INK,
    )

    # Dynamic title
    synergy_title = f"{normalize_sign(data['sun_sign'])} + {normalize_sign(data['asc_sign'])} Sinerjisi"
    tx, ty = ref_xy(283, 1169, w, h)
    draw_centred_fit(
        c, synergy_title, tx, ty, 405 / REF_W * w,
        font="GMSerifBold", size=16.0, min_size=11.0, color=GOLD,
    )

    # Synergy body
    synergy_text = data.get("synergy_text", "")
    if isinstance(synergy_text, list):
        synergy_text = " ".join(map(str, synergy_text))
    x, y = ref_xy(65, 1217, w, h)
    fit_text(
        c, str(synergy_text), x, y, 415 / REF_W * w,
        font="GMSerifItalic", size=12.6, min_size=10.0,
        leading=18.5, max_lines=8, color=INK,
    )

    # Motto
    motto = str(data.get("motto", "") or "").strip()
    if motto:
        mx, my = ref_xy(512, 1478, w, h)
        draw_centred_fit(
            c, motto, mx, my, 620 / REF_W * w,
            font="GMSerifBold", size=10.4, min_size=7.2, color=PALE_GOLD,
        )

    # NO: manual frame repair
    # NO: Page 1 page number redraw
    # NO: star field generation
    # NO: dark veils / fake restoration


def page2(c: canvas.Canvas, data: dict[str, Any], w: float, h: float) -> None:
    path = choose_existing(PAGE2_CANDIDATES, "Page 2 reference")
    draw_reference_page(c, path, w, h)
    draw_page_number(c, 2, w, h)


# ---------------------------------------------------------------------------
# Elements mode / Page 3
# ---------------------------------------------------------------------------

def canonical_element_values(data: dict[str, Any]) -> dict[str, float]:
    src = _need(data, "elements")
    vals: dict[str, float] = {}
    for tr_key, api_key in ELEMENT_API_KEYS.items():
        raw = src.get(tr_key, src.get(api_key))
        if raw is None:
            raise RendererError(f"missing element value: {tr_key}")
        vals[tr_key] = round(float(raw), 1)
    return vals


def canonical_scale_from_percent(pct: float) -> float:
    # soft aesthetic spread
    # 0 -> 0.74 / 100 -> 1.28
    return max(0.74, min(1.28, 0.74 + (pct / 100.0) * 0.54))


def _pil_wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    words = str(text or "").split()
    if not words:
        return [""]
    lines = [words[0]]
    for word in words[1:]:
        trial = lines[-1] + " " + word
        bb = draw.textbbox((0, 0), trial, font=font)
        if bb[2] - bb[0] <= max_width:
            lines[-1] = trial
        else:
            lines.append(word)
    return lines


def _font_pt(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        FONT_DIR / ("CormorantGaramond-Bold.ttf" if bold else "CormorantGaramond-Regular.ttf"),
        FONT_DIR / ("EBGaramond-Bold.ttf" if bold else "EBGaramond-Regular.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"),
    ]
    for p in candidates:
        if p.exists():
            return ImageFont.truetype(str(p), size=size)
    return ImageFont.load_default()


def render_elements(data: dict[str, Any], output: str | Path) -> None:
    vals = canonical_element_values(data)
    base = choose_existing(ELEMENT_OPENING_CANDIDATES, "element opening reference")
    im = Image.open(base).convert("RGBA")
    W, H = im.size
    cx = W // 2

    draw = ImageDraw.Draw(im)
    title_font = _font_pt(max(24, int(W * 0.018)), bold=True)
    label_font = _font_pt(max(18, int(W * 0.014)), bold=True)
    pct_font = _font_pt(max(26, int(W * 0.020)), bold=True)

    slots = {
        "Ateş": (cx, int(H * 0.17)),
        "Toprak": (int(W * 0.20), int(H * 0.50)),
        "Hava": (int(W * 0.80), int(H * 0.50)),
        "Su": (cx, int(H * 0.83)),
    }

    for key, (sx, sy) in slots.items():
        icon = Image.open(element_asset(key)).convert("RGBA")
        scale = canonical_scale_from_percent(vals[key])
        target = int(min(W, H) * 0.16 * scale)
        ratio = min(target / icon.width, target / icon.height)
        new_size = (max(1, int(icon.width * ratio)), max(1, int(icon.height * ratio)))
        icon = icon.resize(new_size, Image.Resampling.LANCZOS)
        im.alpha_composite(icon, (int(sx - icon.width / 2), int(sy - icon.height / 2)))

        # label + pct beneath/near icon
        name = key.upper()
        pct = f"%{vals[key]:g}"

        bb = draw.textbbox((0, 0), name, font=label_font)
        nx = sx - (bb[2] - bb[0]) // 2
        ny = sy + icon.height // 2 + 18
        draw.text((nx, ny), name, font=label_font, fill=ELEMENT_COLORS[key])

        bb = draw.textbbox((0, 0), pct, font=pct_font)
        px = sx - (bb[2] - bb[0]) // 2
        py = ny + (bb[3] - bb[1]) + 6
        draw.text((px, py), pct, font=pct_font, fill="#e4c272")

    im.save(output)


def page3(c: canvas.Canvas, data: dict[str, Any], w: float, h: float) -> None:
    path = optional_existing(PAGE3_CANDIDATES)
    if path is not None:
        draw_reference_page(c, path, w, h)
        draw_page_number(c, 3, w, h)
        return

    # Fallback only if Page 3 canonical reference does not exist:
    # generate the canonical element opening image.
    tmp = HERE / "_tmp_elements_runtime.png"
    render_elements(data, tmp)
    c.drawImage(ImageReader(str(tmp)), 0, 0, width=w, height=h, mask="auto")
    try:
        tmp.unlink(missing_ok=True)
    except Exception:
        pass
    draw_page_number(c, 3, w, h)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def render_pdf(data: dict[str, Any], output: str | Path) -> None:
    register_fonts()
    validate(data, for_pdf=True)

    c = canvas.Canvas(str(output), pagesize=A4)
    w, h = A4

    page1(c, data, w, h)
    c.showPage()

    page2(c, data, w, h)
    c.showPage()

    page3(c, data, w, h)
    c.showPage()

    c.save()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["pdf", "elements"])
    parser.add_argument("input")
    parser.add_argument("output")
    args = parser.parse_args()

    data = load_json(args.input)
    if args.mode == "elements":
        render_elements(data, args.output)
    else:
        render_pdf(data, args.output)
    print(args.output)


if __name__ == "__main__":
    main()
