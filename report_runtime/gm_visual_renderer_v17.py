#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GrandMastrolog V17 - Kanonik Dinamik Görsel Renderer

Kanonik entrypoint:
    python report_runtime/gm_visual_renderer_v17.py pdf <verified_input.json> <output.pdf>
    python report_runtime/gm_visual_renderer_v17.py elements <verified_input.json> <output.png>

ANA SÖZLEŞME
-------------
- Renderer astroloji hesaplamaz.
- Yerleşimler, ev cusp'ları, açılar, element yüzdeleri ve visual_scale kabul edilmiş
  ASTRO DATA olarak dışarıdan gelir.
- Page_1_CANONICAL.png / Page_2_CANONICAL.png ve
  4_element_opening.png / 4_element_report.png yalnız layout/tasarım referansıdır.
  Hiçbiri yeni raporda raster background olarak kullanılmaz.
- Örnek kişi, derece, ev, açı, yüzde ve metin runtime default'u değildir.
- Burç görselleri yalnız report_runtime/assets/zodiac altındaki 12 kanonik assetten gelir.
- Eksik zorunlu veri/asset varsa fail-closed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageOps
from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


# ============================================================================
# Runtime yolları
# ============================================================================

HERE = Path(__file__).resolve().parent
ASSET = HERE / "assets"
ZODIAC_DIR = ASSET / "zodiac"
ELEMENT_DIR = ASSET / "elements"
OPENING_ELEMENT_DIR = ASSET / "elements_opening"
FONT_DIR = ASSET / "fonts"
REFERENCE_DIR = HERE / "reference"

PAGE1_REFERENCE = REFERENCE_DIR / "Page_1_CANONICAL.png"
PAGE2_REFERENCE = REFERENCE_DIR / "Page_2_CANONICAL.png"
OPENING_ELEMENT_REFERENCE = REFERENCE_DIR / "4_element_opening.png"
REPORT_ELEMENT_REFERENCE = REFERENCE_DIR / "4_element_report.png"


# ============================================================================
# Kanonik adlar
# ============================================================================

SIGNS = [
    "Koç", "Boğa", "İkizler", "Yengeç", "Aslan", "Başak",
    "Terazi", "Akrep", "Yay", "Oğlak", "Kova", "Balık",
]

SIGN_GLYPHS = {
    "Koç": "♈", "Boğa": "♉", "İkizler": "♊", "Yengeç": "♋",
    "Aslan": "♌", "Başak": "♍", "Terazi": "♎", "Akrep": "♏",
    "Yay": "♐", "Oğlak": "♑", "Kova": "♒", "Balık": "♓",
}

BODY_TR_MAP = {
    "Sun": "Güneş", "Moon": "Ay", "Mercury": "Merkür", "Venus": "Venüs",
    "Mars": "Mars", "Jupiter": "Jüpiter", "Saturn": "Satürn",
    "Uranus": "Uranüs", "Neptune": "Neptün", "Pluto": "Plüton",
    "True Node": "Kuzey Ay Düğümü", "North Node": "Kuzey Ay Düğümü",
    "Ascendant": "ASC Yükselen", "ASC": "ASC Yükselen", "MC": "MC",
}

BODY_GLYPHS = {
    "Güneş": "☉", "Ay": "☽", "Merkür": "☿", "Venüs": "♀",
    "Mars": "♂", "Jüpiter": "♃", "Satürn": "♄", "Uranüs": "♅",
    "Neptün": "♆", "Plüton": "♇", "Kuzey Ay Düğümü": "☊",
    "ASC Yükselen": "ASC", "Yükselen": "ASC", "MC": "MC",
}

ELEMENT_KEYS = ["Ateş", "Toprak", "Hava", "Su"]
ELEMENT_API_KEYS = {
    "Ateş": "fire",
    "Toprak": "earth",
    "Hava": "air",
    "Su": "water",
}
ELEMENT_FILES = {
    "Ateş": "ates.png",
    "Toprak": "toprak.png",
    "Hava": "hava.png",
    "Su": "su.png",
}
ZODIAC_FILES = {s: f"{s} burcu.png" for s in SIGNS}

SIGN_TO_ELEMENT = {
    "Koç": "Ateş", "Aslan": "Ateş", "Yay": "Ateş",
    "Boğa": "Toprak", "Başak": "Toprak", "Oğlak": "Toprak",
    "İkizler": "Hava", "Terazi": "Hava", "Kova": "Hava",
    "Yengeç": "Su", "Akrep": "Su", "Balık": "Su",
}


# ============================================================================
# Görsel kanon
# ============================================================================

DARK = HexColor("#030b0f")
DARK_2 = HexColor("#071419")
DARK_3 = HexColor("#09191f")
GOLD = HexColor("#d9a52d")
GOLD_LIGHT = HexColor("#f0cd74")
PALE_GOLD = HexColor("#f4d58a")
INK = HexColor("#ead7a5")
INK_SOFT = HexColor("#cbb88d")
MUTED = HexColor("#917f63")
BLUE = HexColor("#4bbff5")
ORANGE = HexColor("#f1862d")
GREEN = HexColor("#97b75a")
SILVER = HexColor("#d6e2e8")
PURPLE = HexColor("#8b6bd6")

ELEMENT_HEX = {
    "Ateş": "#ff8a22",
    "Toprak": "#9ab75d",
    "Hava": "#d3e4ed",
    "Su": "#76c7ff",
}

SIGN_AURA = {
    "Ateş": ("#5f2805", "#d66c0d", "#ffb84a", "#ffd77c"),
    "Toprak": ("#314514", "#73933a", "#b7cc68", "#e0dc85"),
    "Hava": ("#29414a", "#668e9e", "#b8d8e6", "#edf7fb"),
    "Su": ("#0c3152", "#1f6fa5", "#63c8ff", "#9b8df0"),
}


class RendererUnavailable(RuntimeError):
    pass


# ============================================================================
# Yardımcılar / doğrulama
# ============================================================================

def load_json(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _need(obj: dict[str, Any], key: str) -> Any:
    if key not in obj or obj[key] in (None, ""):
        raise RendererUnavailable(f"missing required field: {key}")
    return obj[key]


def _normalize_labels(data: dict[str, Any]) -> None:
    for p in data.get("placements", []) or []:
        if isinstance(p, dict) and isinstance(p.get("body"), str):
            p["body"] = BODY_TR_MAP.get(p["body"], p["body"])
    for a in data.get("aspects", []) or []:
        if not isinstance(a, dict):
            continue
        for k in ("a", "b"):
            if isinstance(a.get(k), str):
                a[k] = BODY_TR_MAP.get(a[k], a[k])


def _font_candidates(name: str) -> list[Path]:
    packaged = {
        "regular": [
            FONT_DIR / "CormorantGaramond-Regular.ttf",
            FONT_DIR / "EBGaramond-Regular.ttf",
            FONT_DIR / "DejaVuSerif.ttf",
        ],
        "bold": [
            FONT_DIR / "CormorantGaramond-Bold.ttf",
            FONT_DIR / "EBGaramond-Bold.ttf",
            FONT_DIR / "DejaVuSerif-Bold.ttf",
        ],
        "italic": [
            FONT_DIR / "CormorantGaramond-Italic.ttf",
            FONT_DIR / "EBGaramond-Italic.ttf",
            FONT_DIR / "DejaVuSerif-Italic.ttf",
        ],
        "symbol": [
            FONT_DIR / "DejaVuSans.ttf",
        ],
    }
    host = {
        "regular": [
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"),
            Path("/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf"),
        ],
        "bold": [
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"),
            Path("/usr/share/fonts/truetype/liberation2/LiberationSerif-Bold.ttf"),
        ],
        "italic": [
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf"),
            Path("/usr/share/fonts/truetype/liberation2/LiberationSerif-Italic.ttf"),
        ],
        "symbol": [
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"),
        ],
    }
    return packaged[name] + host[name]


def _first_font(kind: str) -> Path:
    for p in _font_candidates(kind):
        if p.exists():
            return p
    raise RendererUnavailable(f"font unavailable: {kind}")


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont("GMSerif", str(_first_font("regular"))))
    pdfmetrics.registerFont(TTFont("GMSerifBold", str(_first_font("bold"))))
    pdfmetrics.registerFont(TTFont("GMSerifItalic", str(_first_font("italic"))))
    pdfmetrics.registerFont(TTFont("GMSymbol", str(_first_font("symbol"))))


def _pil_font(size: int, kind: str = "regular") -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(_first_font(kind)), size=max(8, int(size)))


def _reference_dimensions(path: Path, fallback: tuple[int, int]) -> tuple[int, int]:
    # Referans burada sadece layout boyutu olarak okunur; raster background yapılmaz.
    if not path.exists():
        return fallback
    with Image.open(path) as im:
        if im.width > 0 and im.height > 0:
            return (im.width, im.height)
    return fallback


def _element_payload(data: dict[str, Any]) -> tuple[dict[str, float], dict[str, float]]:
    e = _need(data, "elements")
    if not isinstance(e, dict):
        raise RendererUnavailable("elements must be object")

    vals: dict[str, float] = {}
    scales: dict[str, float] = {}

    if isinstance(e.get("percent"), dict):
        percent = e["percent"]
        visual = e.get("visual_scale")
        if not isinstance(visual, dict):
            raise RendererUnavailable("elements.visual_scale is required")
        if e.get("status") not in (None, "calculated"):
            raise RendererUnavailable(f"elements unavailable: {e.get('status')}")
        for tr in ELEMENT_KEYS:
            api = ELEMENT_API_KEYS[tr]
            if api not in percent and tr not in percent:
                raise RendererUnavailable(f"elements.percent missing {api}")
            vals[tr] = float(percent.get(api, percent.get(tr)))
            if api not in visual and tr not in visual:
                raise RendererUnavailable(f"elements.visual_scale missing {api}")
            scales[tr] = float(visual.get(api, visual.get(tr)))
    else:
        # Legacy/synthetic compatibility only.
        for tr in ELEMENT_KEYS:
            if tr not in e:
                raise RendererUnavailable(f"elements missing {tr}")
            vals[tr] = float(e[tr])
            scales[tr] = max(0.82, min(1.18, 1.0 + (vals[tr] - 25.0) * 0.012))

    if any(v < 0 for v in vals.values()):
        raise RendererUnavailable("negative element percentage")
    if not (99.9 <= sum(vals.values()) <= 100.1):
        raise RendererUnavailable("element percentages must sum to 100")
    for tr, s in scales.items():
        if not (0.70 <= s <= 1.30):
            raise RendererUnavailable(f"visual_scale out of range: {tr}")
    return vals, scales


def validate(data: dict[str, Any], for_pdf: bool = True) -> None:
    _normalize_labels(data)

    profile = _need(data, "profile")
    for k in ("birth_date", "birth_time", "birth_place", "report_date"):
        _need(profile, k)

    sun = _need(data, "sun_sign")
    asc = _need(data, "asc_sign")
    if sun not in SIGNS or asc not in SIGNS:
        raise RendererUnavailable("sun_sign/asc_sign must use canonical Turkish names")

    placements = _need(data, "placements")
    if not isinstance(placements, list) or len(placements) < 10:
        raise RendererUnavailable("placements must contain >=10 verified records")

    for p in placements:
        if not isinstance(p, dict):
            raise RendererUnavailable("placement must be object")
        for k in ("body", "sign", "degree", "longitude"):
            _need(p, k)
        if p["sign"] not in SIGNS:
            raise RendererUnavailable(f"unknown placement sign: {p['sign']}")
        lon = float(p["longitude"])
        if not 0 <= lon < 360:
            raise RendererUnavailable(f"longitude out of range: {lon}")

    if for_pdf:
        cusps = _need(data, "house_cusps")
        if not isinstance(cusps, list) or len(cusps) != 12:
            raise RendererUnavailable("house_cusps must contain exactly 12 longitudes")
        for lon in cusps:
            if not 0 <= float(lon) < 360:
                raise RendererUnavailable("house cusp longitude out of range")
        _need(data, "senin_yolun")
        _need(data, "synergy_text")
        _need(data, "motto")

    _element_payload(data)

    for sign in SIGNS:
        p = ZODIAC_DIR / ZODIAC_FILES[sign]
        if not p.exists():
            raise RendererUnavailable(f"missing canonical zodiac asset: {p.name}")

    for tr in ELEMENT_KEYS:
        report_asset = ELEMENT_DIR / ELEMENT_FILES[tr]
        opening_asset = OPENING_ELEMENT_DIR / ELEMENT_FILES[tr]
        if not report_asset.exists():
            raise RendererUnavailable(f"missing report element asset: {report_asset.name}")
        if not opening_asset.exists():
            raise RendererUnavailable(f"missing opening element asset: {opening_asset.name}")

    # Layout refs zorunlu; çizimde background olarak kullanılmazlar.
    for ref in [PAGE1_REFERENCE, PAGE2_REFERENCE, OPENING_ELEMENT_REFERENCE, REPORT_ELEMENT_REFERENCE]:
        if not ref.exists():
            raise RendererUnavailable(f"missing canonical layout reference: {ref.name}")


# ============================================================================
# Metin / tarih
# ============================================================================

def _human_date_tr(value: Any) -> str:
    s = str(value or "").strip()
    months = [
        "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
        "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
    ]
    for sep in ("-", ".", "/"):
        parts = s.split(sep)
        if len(parts) == 3 and all(x.strip().isdigit() for x in parts):
            a, b, c = [int(x) for x in parts]
            if len(parts[0]) == 4:
                year, month, day = a, b, c
            else:
                day, month, year = a, b, c
            if 1 <= month <= 12:
                return f"{day} {months[month - 1]} {year}"
    return s


def _wrap(c: canvas.Canvas, text: str, font: str, size: float, width: float) -> list[str]:
    paras = str(text or "").replace("\r", "").split("\n")
    out: list[str] = []
    for para in paras:
        words = para.split()
        if not words:
            out.append("")
            continue
        cur = words[0]
        for word in words[1:]:
            trial = cur + " " + word
            if c.stringWidth(trial, font, size) <= width:
                cur = trial
            else:
                out.append(cur)
                cur = word
        out.append(cur)
    return out


def _fit_text(
    c: canvas.Canvas,
    text: Any,
    x: float,
    y: float,
    width: float,
    height: float,
    font: str = "GMSerif",
    size: float = 12.0,
    min_size: float = 8.5,
    leading: float = 16.0,
    color=INK,
) -> float:
    actual = float(size)
    lines: list[str] = []
    while actual >= min_size:
        lines = _wrap(c, str(text or ""), font, actual, width)
        line_h = leading * (actual / size)
        if len(lines) * line_h <= height:
            break
        actual -= 0.35
    c.setFillColor(color)
    c.setFont(font, actual)
    line_h = leading * (actual / size)
    yy = y
    for line in lines:
        if yy < y - height:
            break
        c.drawString(x, yy, line)
        yy -= line_h
    return actual


def _center_fit(
    c: canvas.Canvas,
    text: str,
    cx: float,
    y: float,
    max_width: float,
    font: str,
    size: float,
    min_size: float,
    color,
) -> float:
    actual = float(size)
    while actual > min_size and c.stringWidth(text, font, actual) > max_width:
        actual -= 0.25
    c.setFont(font, actual)
    c.setFillColor(color)
    c.drawCentredString(cx, y, text)
    return actual


# ============================================================================
# Premium kozmik zemin / çerçeve
# ============================================================================

def _seed_from(data: dict[str, Any], page: int, extra: str = "") -> int:
    p = data.get("profile", {})
    raw = f"{p.get('name','')}|{p.get('birth_date','')}|{page}|{extra}"
    return int(hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16], 16)


def _gradient_bg(c: canvas.Canvas, w: float, h: float, data: dict[str, Any], page: int) -> None:
    steps = 42
    for i in range(steps):
        t = i / max(1, steps - 1)
        r = 0.008 + 0.010 * (1 - t)
        g = 0.020 + 0.030 * (1 - t)
        b = 0.028 + 0.045 * (1 - t)
        c.setFillColor(Color(r, g, b))
        y = h * i / steps
        c.rect(0, y, w, h / steps + 1, fill=1, stroke=0)

    rr = random.Random(_seed_from(data, page, "stars"))
    for _ in range(460):
        x = rr.uniform(18, w - 18)
        y = rr.uniform(18, h - 18)
        rad = rr.choice([0.22, 0.28, 0.35, 0.45, 0.58, 0.8])
        warm = rr.random()
        if warm > 0.72:
            col = Color(1, 0.78 + rr.random() * .18, 0.34 + rr.random() * .28, alpha=0.28 + rr.random() * .36)
        else:
            col = Color(0.72, 0.86, 1, alpha=0.16 + rr.random() * .26)
        c.setFillColor(col)
        c.circle(x, y, rad, fill=1, stroke=0)

    halos = [
        (w * .78, h * .70, w * .20, Color(.20, .09, .33, alpha=.16)),
        (w * .72, h * .38, w * .24, Color(.04, .25, .42, alpha=.15)),
        (w * .27, h * .58, w * .18, Color(.37, .22, .04, alpha=.08)),
    ]
    for hx, hy, hr, col in halos:
        for i in range(12, 0, -1):
            c.setFillColor(Color(col.red, col.green, col.blue, alpha=col.alpha * (i / 12) * .30))
            c.circle(hx, hy, hr * (i / 12), fill=1, stroke=0)


def _ornate_frame(c: canvas.Canvas, w: float, h: float) -> None:
    c.saveState()
    c.setStrokeColor(GOLD)
    c.setLineWidth(1.25)
    c.rect(18, 18, w - 36, h - 36, stroke=1, fill=0)
    c.setStrokeColor(Color(.95, .78, .34, alpha=.55))
    c.setLineWidth(.45)
    c.rect(25, 25, w - 50, h - 50, stroke=1, fill=0)

    for x, y, sx, sy in [
        (28, 28, 1, 1),
        (w - 28, 28, -1, 1),
        (28, h - 28, 1, -1),
        (w - 28, h - 28, -1, -1),
    ]:
        c.setStrokeColor(GOLD_LIGHT)
        c.setLineWidth(.75)
        c.line(x, y, x + sx * 48, y)
        c.line(x, y, x, y + sy * 48)
        c.circle(x + sx * 9, y + sy * 9, 2.6, stroke=1, fill=0)
        c.circle(x + sx * 17, y + sy * 17, 1.2, stroke=1, fill=0)
    c.restoreState()


def _header(c: canvas.Canvas, w: float, h: float, page: int) -> None:
    c.setFillColor(GOLD_LIGHT)
    c.setFont("GMSerifBold", 10.2)
    c.drawCentredString(w / 2, h - 40, "ŞAHSİ GRANDMASTROLOG  |  DANIŞMANLIK RAPORU")
    c.setStrokeColor(Color(.85, .65, .20, alpha=.50))
    c.setLineWidth(.5)
    c.line(50, h - 49, w - 50, h - 49)

    x, y = w - 46, h - 41
    for rr, alpha, lw in [(15, .30, 3.5), (12.5, .85, 1.1)]:
        c.setStrokeColor(Color(.95, .70, .25, alpha=alpha))
        c.setLineWidth(lw)
        c.circle(x, y, rr, stroke=1, fill=0)
    c.setFillColor(PALE_GOLD)
    c.setFont("GMSerifBold", 8.5)
    c.drawCentredString(x, y - 3, str(page))


def _section_panel(
    c: canvas.Canvas,
    x: float,
    y: float,
    width: float,
    height: float,
    title: str | None = None,
    title_size: float = 11.0,
) -> None:
    c.setFillColor(Color(.005, .019, .025, alpha=.46))
    c.setStrokeColor(Color(.84, .63, .19, alpha=.72))
    c.setLineWidth(.65)
    c.roundRect(x, y, width, height, 7, fill=1, stroke=1)
    if title:
        c.setFillColor(GOLD_LIGHT)
        c.setFont("GMSerifBold", title_size)
        c.drawString(x + 12, y + height - 21, title.upper())
        c.setStrokeColor(Color(.84, .63, .19, alpha=.36))
        c.line(x + 12, y + height - 28, x + width - 12, y + height - 28)


# ============================================================================
# Burç assetleri
# ============================================================================

_ZODIAC_CACHE: dict[str, ImageReader] = {}


def _zodiac_img(sign: str) -> ImageReader:
    if sign not in SIGNS:
        raise RendererUnavailable(f"unknown zodiac sign: {sign}")
    if sign in _ZODIAC_CACHE:
        return _ZODIAC_CACHE[sign]

    path = ZODIAC_DIR / ZODIAC_FILES[sign]
    if not path.exists():
        raise RendererUnavailable(f"missing zodiac asset: {path.name}")

    im = Image.open(path).convert("RGBA")
    px = im.load()
    for yy in range(im.height):
        for xx in range(im.width):
            r, g, b, a = px[xx, yy]
            chroma = max(r, g, b) - min(r, g, b)
            avg = (r + g + b) / 3
            if a == 0:
                continue
            if chroma <= 8 and avg >= 45:
                na = 0
            elif chroma < 24 and avg >= 60:
                na = int(a * (chroma - 8) / 16)
            else:
                na = a
            px[xx, yy] = (r, g, b, max(0, min(255, na)))

    _ZODIAC_CACHE[sign] = ImageReader(im)
    return _ZODIAC_CACHE[sign]


def _rgba(hex_string: str, alpha: float) -> Color:
    base = HexColor(hex_string)
    return Color(base.red, base.green, base.blue, alpha=alpha)


def _premium_sign_medallion(
    c: canvas.Canvas,
    sign: str,
    cx: float,
    cy: float,
    radius: float,
    scale: float = 1.0,
) -> None:
    elem = SIGN_TO_ELEMENT[sign]
    palette = SIGN_AURA[elem]
    r = radius * scale

    c.saveState()
    rings = [
        (r * 1.18, palette[0], .18, 9.0),
        (r * 1.10, palette[1], .32, 5.5),
        (r * 1.04, palette[2], .64, 2.2),
        (r * .98, palette[3], .92, 1.0),
    ]
    for rr, col, alpha, lw in rings:
        c.setStrokeColor(_rgba(col, alpha))
        c.setLineWidth(lw)
        c.circle(cx, cy, rr, stroke=1, fill=0)

    c.setFillColor(Color(.003, .012, .016, alpha=.86))
    c.circle(cx, cy, r * .94, fill=1, stroke=0)

    sz = r * 1.77
    c.drawImage(
        _zodiac_img(sign),
        cx - sz / 2,
        cy - sz / 2,
        sz,
        sz,
        mask="auto",
    )
    c.restoreState()


# ============================================================================
# Sayfa 1
# ============================================================================

def _page1(c: canvas.Canvas, data: dict[str, Any], w: float, h: float) -> None:
    prof = data["profile"]
    sun = data["sun_sign"]
    asc = data["asc_sign"]

    _gradient_bg(c, w, h, data, 1)
    _ornate_frame(c, w, h)
    _header(c, w, h, 1)

    left_x = 48
    left_w = w * .48
    right_x = w * .60
    right_w = w - right_x - 45

    c.setFillColor(GOLD_LIGHT)
    c.setFont("GMSerifBold", 10.5)
    c.drawString(left_x, h - 92, "ŞAHSİ")
    c.setFont("GMSerifBold", 27)
    c.drawString(left_x, h - 122, "GRANDMASTROLOG")
    c.setFont("GMSerifItalic", 12.5)
    c.setFillColor(PALE_GOLD)
    c.drawString(left_x, h - 142, "Doğum Haritası Raporu")

    info_y = h - 332
    info_h = 165
    _section_panel(c, left_x, info_y, left_w, info_h, None)
    rows = [
        ("Doğum tarihi", _human_date_tr(prof["birth_date"])),
        ("Doğum saati", str(prof["birth_time"])),
        ("Doğum yeri", str(prof["birth_place"])),
        ("Rapor tarihi", _human_date_tr(prof["report_date"])),
    ]
    row_h = info_h / 4
    for i, (label, value) in enumerate(rows):
        yy = info_y + info_h - (i + .72) * row_h
        if i:
            c.setStrokeColor(Color(.80, .60, .20, alpha=.25))
            c.line(left_x + 12, info_y + info_h - i * row_h, left_x + left_w - 12, info_y + info_h - i * row_h)
        c.setFillColor(INK_SOFT)
        c.setFont("GMSerif", 8.4)
        c.drawString(left_x + 14, yy, label)
        _center_fit(
            c, value,
            left_x + left_w * .69,
            yy,
            left_w * .55,
            "GMSerifBold", 8.9, 6.8, PALE_GOLD
        )

    path_y = h - 560
    path_h = 195
    _section_panel(c, left_x, path_y, left_w, path_h, "Senin Yolun", 11.5)
    _fit_text(
        c, data.get("senin_yolun", ""),
        left_x + 13, path_y + path_h - 47,
        left_w - 26, path_h - 60,
        "GMSerif", 10.8, 8.6, 15.4, INK
    )

    syn_y = 92
    syn_h = 215
    syn_title = f"{sun} + {asc} Sinerjisi"
    _section_panel(c, left_x, syn_y, left_w, syn_h, syn_title, 10.4)
    _fit_text(
        c, data.get("synergy_text", ""),
        left_x + 13, syn_y + syn_h - 47,
        left_w - 26, syn_h - 60,
        "GMSerifItalic", 10.4, 8.2, 14.8, INK
    )

    asc_cx = right_x + right_w * .52
    asc_cy = h * .64
    asc_r = min(right_w, h * .21) * .42
    c.setFillColor(GOLD_LIGHT)
    c.setFont("GMSerifBold", 10.5)
    c.drawCentredString(asc_cx, h * .83, "YÜKSELEN")
    c.setFont("GMSerifBold", 22)
    c.drawCentredString(asc_cx, h * .795, asc.upper())
    _premium_sign_medallion(c, asc, asc_cx, asc_cy, asc_r, scale=1.15)

    sun_cx = right_x + right_w * .50
    sun_cy = h * .28
    sun_r = min(right_w, h * .21) * .42
    c.setFillColor(GOLD_LIGHT)
    c.setFont("GMSerifBold", 10.5)
    c.drawCentredString(sun_cx, h * .47, "GÜNEŞ")
    c.setFont("GMSerifBold", 22)
    c.drawCentredString(sun_cx, h * .435, sun.upper())
    _premium_sign_medallion(c, sun, sun_cx, sun_cy, sun_r, scale=1.0)

    c.saveState()
    c.setStrokeColor(Color(.70, .56, .22, alpha=.16))
    c.setLineWidth(.45)
    for rr in [right_w * .36, right_w * .44, right_w * .52]:
        c.circle(right_x + right_w * .52, h * .47, rr, stroke=1, fill=0)
    c.restoreState()

    motto = str(data.get("motto", "") or "").strip()
    if motto:
        _center_fit(
            c, motto,
            w / 2, 46,
            w - 130,
            "GMSerifItalic", 9.7, 7.2, PALE_GOLD
        )


# ============================================================================
# Sayfa 2 - natal wheel + yerleşimler + açılar
# ============================================================================

def _polar(lon: float, cx: float, cy: float, r: float) -> tuple[float, float]:
    a = math.radians(90 - float(lon))
    return cx + r * math.cos(a), cy + r * math.sin(a)


def _aspect_color(kind: str, alpha: float) -> Color:
    k = str(kind or "").lower()
    if any(x in k for x in ["üçgen", "sekstil", "trine", "sextile"]):
        return Color(.24, .67, .98, alpha=alpha)
    if any(x in k for x in ["kare", "karşıt", "opposition", "square"]):
        return Color(.96, .41, .20, alpha=alpha)
    return Color(.90, .72, .25, alpha=alpha)


def _draw_wheel(c: canvas.Canvas, data: dict[str, Any], cx: float, cy: float, R: float) -> None:
    for rr, lw, alpha in [
        (R * 1.04, 5.0, .11),
        (R, 1.15, .92),
        (R * .88, .75, .62),
        (R * .61, .65, .48),
        (R * .26, .55, .30),
    ]:
        c.setStrokeColor(Color(.86, .66, .23, alpha=alpha))
        c.setLineWidth(lw)
        c.circle(cx, cy, rr, stroke=1, fill=0)

    for i, sign in enumerate(SIGNS):
        lon = i * 30.0
        x1, y1 = _polar(lon, cx, cy, R * .88)
        x2, y2 = _polar(lon, cx, cy, R)
        c.setStrokeColor(Color(.88, .69, .26, alpha=.42))
        c.setLineWidth(.55)
        c.line(x1, y1, x2, y2)

        gx, gy = _polar(lon + 15, cx, cy, R * .94)
        c.setFillColor(PALE_GOLD)
        c.setFont("GMSymbol", 10.5)
        c.drawCentredString(gx, gy - 3.5, SIGN_GLYPHS[sign])

    for deg in range(0, 360, 5):
        r1 = R * (.84 if deg % 30 == 0 else .865)
        r2 = R * .88
        x1, y1 = _polar(deg, cx, cy, r1)
        x2, y2 = _polar(deg, cx, cy, r2)
        c.setStrokeColor(Color(.82, .67, .30, alpha=.24 if deg % 30 else .45))
        c.setLineWidth(.35 if deg % 30 else .55)
        c.line(x1, y1, x2, y2)

    for idx, lon in enumerate(data["house_cusps"], start=1):
        x1, y1 = _polar(float(lon), cx, cy, R * .22)
        x2, y2 = _polar(float(lon), cx, cy, R * .83)
        c.setStrokeColor(Color(.75, .67, .49, alpha=.42))
        c.setLineWidth(.45)
        c.line(x1, y1, x2, y2)

        next_lon = float(data["house_cusps"][idx % 12])
        a = float(lon)
        b = next_lon
        if b <= a:
            b += 360
        mid = (a + b) / 2 % 360
        hx, hy = _polar(mid, cx, cy, R * .49)
        c.setFillColor(Color(.86, .78, .61, alpha=.75))
        c.setFont("GMSerifBold", 6.7)
        c.drawCentredString(hx, hy - 2.2, str(idx))

    pl = {p["body"]: p for p in data["placements"]}

    for a in data.get("aspects", []) or []:
        pa = pl.get(a.get("a"))
        pb = pl.get(a.get("b"))
        if not pa or not pb:
            continue
        x1, y1 = _polar(float(pa["longitude"]), cx, cy, R * .56)
        x2, y2 = _polar(float(pb["longitude"]), cx, cy, R * .56)
        strength = a.get("strength")
        if strength is None:
            alpha, lw = .26, .55
        else:
            s = max(0.0, min(1.0, float(strength)))
            alpha, lw = .18 + .54 * s, .45 + 1.05 * s
        c.setStrokeColor(_aspect_color(str(a.get("type", "")), alpha))
        c.setLineWidth(lw)
        c.line(x1, y1, x2, y2)

    for p in data["placements"]:
        if p["body"] in ("ASC Yükselen", "Yükselen", "MC"):
            continue
        x, y = _polar(float(p["longitude"]), cx, cy, R * .70)
        c.setFillColor(DARK)
        c.setStrokeColor(PALE_GOLD)
        c.setLineWidth(.65)
        c.circle(x, y, 7.0, fill=1, stroke=1)
        c.setFillColor(PALE_GOLD)
        c.setFont("GMSymbol", 6.9)
        c.drawCentredString(x, y - 2.4, BODY_GLYPHS.get(p["body"], p["body"][:2]))

    for rr, col, alpha, lw in [
        (R * .17, GOLD, .35, 4.0),
        (R * .12, GOLD_LIGHT, .72, 1.0),
    ]:
        c.setStrokeColor(Color(col.red, col.green, col.blue, alpha=alpha))
        c.setLineWidth(lw)
        c.circle(cx, cy, rr, stroke=1, fill=0)


def _placement_for(data: dict[str, Any], names: list[str]) -> dict[str, Any] | None:
    for name in names:
        for p in data["placements"]:
            if p["body"] == name:
                return p
    return None


def _badge(
    c: canvas.Canvas,
    p: dict[str, Any],
    x: float,
    y: float,
    sz: float = 45,
    label_side: str = "right",
) -> None:
    sign = p["sign"]
    _premium_sign_medallion(c, sign, x, y, sz * .50, scale=1.0)

    body = str(p["body"]).replace("ASC Yükselen", "YÜKSELEN").upper()
    deg = str(p.get("degree", ""))
    house = p.get("house")
    detail = deg + (f"  {house}. Ev" if house not in (None, "") else "")

    c.setFillColor(INK)
    if label_side == "left":
        lx = x - sz * .66
        c.setFont("GMSerifBold", 7.2)
        c.drawRightString(lx, y + 10, body)
        c.setFont("GMSerif", 6.8)
        c.drawRightString(lx, y - 1, sign.upper())
        c.drawRightString(lx, y - 12, detail)
    else:
        lx = x + sz * .66
        c.setFont("GMSerifBold", 7.2)
        c.drawString(lx, y + 10, body)
        c.setFont("GMSerif", 6.8)
        c.drawString(lx, y - 1, sign.upper())
        c.drawString(lx, y - 12, detail)


def _aspect_short(a: dict[str, Any]) -> str:
    return f"{a.get('a','')} - {a.get('b','')}  {a.get('type','')}  {a.get('orb','')}"


def _page2(c: canvas.Canvas, data: dict[str, Any], w: float, h: float) -> None:
    _gradient_bg(c, w, h, data, 2)
    _ornate_frame(c, w, h)
    _header(c, w, h, 2)

    c.setFillColor(GOLD_LIGHT)
    c.setFont("GMSerifBold", 23)
    c.drawString(44, h - 92, "DOĞUM HARİTASI GÖRSELİ")
    c.setFillColor(INK_SOFT)
    c.setFont("GMSerifItalic", 8.8)
    c.drawString(46, h - 108, "Gezegenlerin burç yerleşimlerinin görselleştirilmiş sistemi")

    cx = w * .34
    cy = h * .50
    R = w * .255
    _draw_wheel(c, data, cx, cy, R)

    priority = [
        ["Güneş"], ["MC"], ["Merkür"], ["Venüs"], ["Mars"],
        ["Satürn"], ["Plüton"], ["Jüpiter"], ["Ay"], ["ASC Yükselen", "Yükselen"],
    ]
    selected = []
    for names in priority:
        p = _placement_for(data, names)
        if p:
            selected.append(p)

    slots = [
        (w * .13, h * .72, "right"),
        (w * .34, h * .82, "right"),
        (w * .52, h * .72, "left"),
        (w * .59, h * .57, "left"),
        (w * .57, h * .42, "left"),
        (w * .49, h * .29, "left"),
        (w * .35, h * .21, "right"),
        (w * .20, h * .23, "right"),
        (w * .11, h * .38, "right"),
        (w * .10, h * .57, "right"),
    ]
    for p, (x, y, side) in zip(selected, slots):
        _badge(c, p, x, y, 44, side)

    tx = w * .68
    tw = w * .285

    py = h * .51
    ph = h * .29
    _section_panel(c, tx, py, tw, ph, "Natal Yerleşimler", 10.1)

    cols = [tx + 9, tx + tw * .40, tx + tw * .66, tx + tw * .84]
    headers = ["GÖVDE", "BURÇ", "DERECE", "EV"]
    c.setFillColor(INK_SOFT)
    c.setFont("GMSerifBold", 5.7)
    for xx, hh in zip(cols, headers):
        c.drawString(xx, py + ph - 43, hh)

    y = py + ph - 59
    rows = data["placements"][:13]
    for p in rows:
        c.setFillColor(INK)
        c.setFont("GMSerif", 5.9)
        c.drawString(cols[0], y, str(p["body"])[:19])
        c.drawString(cols[1], y, str(p["sign"]))
        c.drawString(cols[2], y, str(p["degree"]))
        house = p.get("house")
        c.drawString(cols[3], y, "-" if house in (None, "") else str(house))
        y -= 12.0
        if y < py + 10:
            break

    ay = h * .25
    ah = h * .235
    _section_panel(c, tx, ay, tw, ah, "Ana Açı Desenleri", 9.7)
    y = ay + ah - 45
    c.setFont("GMSerif", 5.8)
    aspects = data.get("aspects", []) or []
    for a in aspects[:12]:
        text = _aspect_short(a)
        if c.stringWidth(text, "GMSerif", 5.8) > tw - 18:
            text = f"{a.get('a','')} / {a.get('b','')}  {a.get('type','')}"
        c.setFillColor(INK)
        c.drawString(tx + 9, y, text[:50])
        y -= 12
        if y < ay + 10:
            break

    sy = 70
    sh = h * .14
    _section_panel(c, tx, sy, tw, sh, "Açı Güçleri", 9.7)
    strengths = [
        float(a["strength"])
        for a in aspects
        if a.get("strength") is not None
    ]
    if strengths:
        avg = max(0, min(1, sum(strengths) / len(strengths)))
        x0 = tx + 13
        y0 = sy + sh * .43
        barw = tw - 26
        c.setFillColor(HexColor("#183f57"))
        c.rect(x0, y0, barw, 8, fill=1, stroke=0)
        c.setFillColor(ORANGE)
        c.rect(x0, y0, barw * avg, 8, fill=1, stroke=0)
        c.setFillColor(INK_SOFT)
        c.setFont("GMSerif", 5.8)
        c.drawString(x0, y0 - 11, "ZAYIF")
        c.drawRightString(x0 + barw, y0 - 11, "GÜÇLÜ")
    else:
        c.setFillColor(MUTED)
        c.setFont("GMSerifItalic", 6.4)
        c.drawCentredString(tx + tw / 2, sy + sh * .42, "Doğrulanmış strength yoksa ölçek üretilmez.")

    c.setFillColor(GOLD)
    c.setFont("GMSerif", 7.5)
    c.drawCentredString(w / 2, 34, "GrandMastrolog Özel Danışmanlık Raporu")


# ============================================================================
# 4 Element dinamik görselleri
# ============================================================================

def _alpha_crop(path: Path) -> Image.Image:
    im = Image.open(path).convert("RGBA")
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def _paste_element_art(
    canvas_im: Image.Image,
    path: Path,
    center: tuple[float, float],
    target_px: int,
    silver: bool = False,
) -> None:
    art = _alpha_crop(path)

    if silver:
        alpha = art.getchannel("A")
        g = ImageOps.grayscale(art.convert("RGB"))
        silver_rgb = Image.merge("RGB", (
            g.point(lambda v: min(255, int(v * 1.08 + 12))),
            g.point(lambda v: min(255, int(v * 1.12 + 18))),
            g.point(lambda v: min(255, int(v * 1.18 + 25))),
        ))
        art = silver_rgb.convert("RGBA")
        art.putalpha(alpha)

    ratio = target_px / max(1, max(art.size))
    size = (
        max(1, int(round(art.width * ratio))),
        max(1, int(round(art.height * ratio))),
    )
    art = art.resize(size, Image.Resampling.LANCZOS)
    x, y = center
    canvas_im.alpha_composite(
        art,
        (int(round(x - art.width / 2)), int(round(y - art.height / 2))),
    )


def _pil_cosmic_background(W: int, H: int, seed: str) -> Image.Image:
    im = Image.new("RGBA", (W, H), (3, 10, 13, 255))
    d = ImageDraw.Draw(im, "RGBA")
    rr = random.Random(int(hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16], 16))

    for y in range(H):
        t = y / max(1, H - 1)
        col = (
            int(4 + 3 * (1 - t)),
            int(11 + 12 * (1 - t)),
            int(15 + 20 * (1 - t)),
            255,
        )
        d.line((0, y, W, y), fill=col)

    for _ in range(max(900, int(W * H / 1500))):
        x = rr.randrange(15, max(16, W - 15))
        y = rr.randrange(15, max(16, H - 15))
        r = rr.choice([1, 1, 1, 1, 2, 2, 3])
        if rr.random() < .60:
            col = (255, rr.randrange(195, 245), rr.randrange(95, 185), rr.randrange(45, 155))
        else:
            col = (170, 220, 255, rr.randrange(28, 100))
        d.ellipse((x-r, y-r, x+r, y+r), fill=col)

    margin = max(18, int(min(W, H) * .018))
    d.rectangle((margin, margin, W-margin, H-margin), outline=(217, 165, 45, 245), width=max(2, int(W * .002)))
    d.rectangle((margin+10, margin+10, W-margin-10, H-margin-10), outline=(235, 205, 120, 110), width=1)
    return im


def _draw_element_wheel(d: ImageDraw.ImageDraw, cx: float, cy: float, radius: float) -> None:
    for rr, alpha, width in [
        (radius, 210, 2),
        (radius * .96, 125, 1),
        (radius * .82, 85, 1),
    ]:
        d.ellipse(
            (cx-rr, cy-rr, cx+rr, cy+rr),
            outline=(217, 165, 45, alpha),
            width=width,
        )
    for deg in range(0, 360, 30):
        a = math.radians(deg - 90)
        x1 = cx + radius * .82 * math.cos(a)
        y1 = cy + radius * .82 * math.sin(a)
        x2 = cx + radius * .96 * math.cos(a)
        y2 = cy + radius * .96 * math.sin(a)
        d.line((x1, y1, x2, y2), fill=(217,165,45,105), width=1)


def render_elements_opening(data: dict[str, Any], out_path: str) -> None:
    validate(data, for_pdf=False)
    vals, scales = _element_payload(data)
    W, H = _reference_dimensions(OPENING_ELEMENT_REFERENCE, (1254, 1254))
    prof = data.get("profile", {})
    im = _pil_cosmic_background(W, H, f"{prof.get('birth_date','')}|opening")
    d = ImageDraw.Draw(im, "RGBA")
    cx, cy = W / 2, H / 2
    R = min(W, H) * .42
    _draw_element_wheel(d, cx, cy, R)

    title = _pil_font(max(22, int(H * .027)), "bold")
    sub = _pil_font(max(15, int(H * .017)), "regular")
    label = _pil_font(max(18, int(H * .020)), "bold")
    pctf = _pil_font(max(20, int(H * .024)), "bold")

    t = "GRANDMASTROLOG ELEMENT ANALİZİ"
    bb = d.textbbox((0,0), t, font=title)
    d.text((cx-(bb[2]-bb[0])/2, H*.055), t, font=title, fill=(242,211,135,255))
    st = "4 ELEMENT DAĞILIMI"
    bb = d.textbbox((0,0), st, font=sub)
    d.text((cx-(bb[2]-bb[0])/2, H*.10), st, font=sub, fill=(202,177,126,235))

    pos = {
        "Ateş": (cx, H * .28),
        "Toprak": (W * .25, H * .54),
        "Hava": (W * .75, H * .54),
        "Su": (cx, H * .80),
    }
    base = {"Ateş": .23, "Toprak": .21, "Hava": .21, "Su": .205}

    for k in ELEMENT_KEYS:
        target = int(min(W, H) * base[k] * scales[k])
        _paste_element_art(
            im,
            OPENING_ELEMENT_DIR / ELEMENT_FILES[k],
            pos[k],
            target,
            silver=False,
        )
        x, y = pos[k]
        label_y = y + target * .48
        name = k.upper()
        pct = f"%{vals[k]:g}"
        color = ELEMENT_HEX[k]
        bb = d.textbbox((0,0), name, font=label)
        d.text((x-(bb[2]-bb[0])/2, label_y), name, font=label, fill=color)
        bb = d.textbbox((0,0), pct, font=pctf)
        d.text((x-(bb[2]-bb[0])/2, label_y+28), pct, font=pctf, fill=color)

    im.convert("RGB").save(out_path, quality=96)


def render_elements_report(data: dict[str, Any], out_path: str) -> None:
    validate(data, for_pdf=False)
    vals, scales = _element_payload(data)
    W, H = _reference_dimensions(REPORT_ELEMENT_REFERENCE, (1085, 1450))
    prof = data.get("profile", {})
    im = _pil_cosmic_background(W, H, f"{prof.get('birth_date','')}|report-element")
    d = ImageDraw.Draw(im, "RGBA")
    cx, cy = W / 2, H * .52
    R = min(W * .44, H * .33)
    _draw_element_wheel(d, cx, cy, R)

    title = _pil_font(max(25, int(H * .027)), "bold")
    sub = _pil_font(max(16, int(H * .016)), "regular")
    label = _pil_font(max(18, int(H * .018)), "bold")
    pctf = _pil_font(max(22, int(H * .022)), "bold")
    center_font = _pil_font(max(15, int(H * .014)), "bold")

    t = "GRANDMASTROLOG ELEMENT ANALİZİ"
    bb = d.textbbox((0,0), t, font=title)
    d.text((cx-(bb[2]-bb[0])/2, H*.055), t, font=title, fill=(242,211,135,255))
    st = "DOĞRULANMIŞ 4 ELEMENT DAĞILIMI"
    bb = d.textbbox((0,0), st, font=sub)
    d.text((cx-(bb[2]-bb[0])/2, H*.10), st, font=sub, fill=(202,177,126,235))

    pos = {
        "Ateş": (cx, H * .315),
        "Toprak": (W * .22, H * .545),
        "Hava": (W * .78, H * .545),
        "Su": (cx, H * .765),
    }
    base = {"Ateş": .255, "Toprak": .245, "Hava": .245, "Su": .225}

    for k in ELEMENT_KEYS:
        target = int(min(W, H) * base[k] * scales[k])
        _paste_element_art(
            im,
            ELEMENT_DIR / ELEMENT_FILES[k],
            pos[k],
            target,
            silver=(k == "Hava"),
        )
        x, y = pos[k]
        if k == "Ateş":
            label_y = y - target * .61
        else:
            label_y = y + target * .52
        name = k.upper()
        pct = f"%{vals[k]:g}"
        color = ELEMENT_HEX[k]
        bb = d.textbbox((0,0), name, font=label)
        d.text((x-(bb[2]-bb[0])/2, label_y), name, font=label, fill=color)
        bb = d.textbbox((0,0), pct, font=pctf)
        d.text((x-(bb[2]-bb[0])/2, label_y+30), pct, font=pctf, fill=color)

    cr = min(W, H) * .140
    d.ellipse((cx-cr, cy-cr, cx+cr, cy+cr), fill=(5,15,19,238), outline=(217,165,45,220), width=2)
    y0 = cy - cr * .55
    for k in ELEMENT_KEYS:
        name = k.upper()
        pct = f"%{vals[k]:g}"
        d.text((cx-cr*.72, y0), name, font=center_font, fill=ELEMENT_HEX[k])
        bb = d.textbbox((0,0), pct, font=center_font)
        d.text((cx+cr*.72-(bb[2]-bb[0]), y0), pct, font=center_font, fill=(242,213,145,255))
        y0 += max(30, int(H*.027))

    panel = (int(W*.11), int(H*.895), int(W*.89), int(H*.958))
    d.rounded_rectangle(panel, radius=10, fill=(4,14,18,205), outline=(217,165,45,125), width=1)
    note = "Oran ve ölçekler doğrulanmış ASTRO DATA'dan gelir."
    note_font = _pil_font(max(13, int(H*.013)), "italic")
    bb = d.textbbox((0,0), note, font=note_font)
    nx = max(panel[0]+16, cx-(bb[2]-bb[0])/2)
    d.text((nx, panel[1]+17), note, font=note_font, fill=(221,202,159,235))

    im.convert("RGB").save(out_path, quality=96)


def render_elements(data: dict[str, Any], out_path: str) -> None:
    render_elements_opening(data, out_path)


# ============================================================================
# Sayfa 3
# ============================================================================

def _page3(c: canvas.Canvas, data: dict[str, Any], w: float, h: float) -> None:
    with tempfile.TemporaryDirectory(prefix="gmv17_page3_") as td:
        png = Path(td) / "element_report.png"
        render_elements_report(data, str(png))
        with Image.open(png) as im:
            iw, ih = im.size
        scale = min(w / iw, h / ih)
        dw, dh = iw * scale, ih * scale
        c.setFillColor(DARK)
        c.rect(0, 0, w, h, fill=1, stroke=0)
        c.drawImage(
            ImageReader(str(png)),
            (w - dw) / 2,
            (h - dh) / 2,
            dw,
            dh,
            mask="auto",
        )


# ============================================================================
# PDF / CLI
# ============================================================================

def render_pdf(data: dict[str, Any], out_path: str) -> None:
    validate(data, for_pdf=True)
    register_fonts()

    c = canvas.Canvas(out_path, pagesize=A4)
    w, h = A4

    _page1(c, data, w, h)
    c.showPage()

    _page2(c, data, w, h)
    c.showPage()

    _page3(c, data, w, h)
    c.showPage()

    c.save()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["elements", "pdf"])
    ap.add_argument("input_json")
    ap.add_argument("output")
    args = ap.parse_args()

    data = load_json(args.input_json)
    if args.mode == "elements":
        render_elements(data, args.output)
    else:
        render_pdf(data, args.output)
    print(args.output)


if __name__ == "__main__":
    main()
