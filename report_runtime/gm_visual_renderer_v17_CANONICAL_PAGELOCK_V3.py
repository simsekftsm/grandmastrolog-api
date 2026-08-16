#!/usr/bin/env python3
"""GrandMastrolog v17 dynamic visual renderer.

Renderer only. It MUST NOT calculate astrological placements, houses, transits or
aspect validity. All astrology comes from already-accepted ASTRO DATA.

Commands:
  python gm_visual_renderer_v17.py elements input.json output.png
  python gm_visual_renderer_v17.py pdf input.json output.pdf
"""
from __future__ import annotations
import argparse, hashlib, json, math, os, random, sys, tempfile
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from reportlab.lib.colors import Color, HexColor

HERE = Path(__file__).resolve().parent
ASSET = HERE / "assets"
ZODIAC_DIR = ASSET / "zodiac"
ELEMENT_DIR = ASSET / "elements"
OPENING_ELEMENT_DIR = ASSET / "elements_opening"
REFERENCE_DIR = HERE / "reference"
OPENING_ELEMENT_REFERENCE = REFERENCE_DIR / "4_element_opening.png"
PAGE1_REFERENCE = REFERENCE_DIR / "Page_1_CANONICAL.png"
PAGE2_REFERENCE = REFERENCE_DIR / "Page_2_CANONICAL.png"
PAGE3_REFERENCE = REFERENCE_DIR / "Page_3_CANONICAL.png"

SIGNS = ["Koç","Boğa","İkizler","Yengeç","Aslan","Başak","Terazi","Akrep","Yay","Oğlak","Kova","Balık"]
SIGN_GLYPHS = {"Koç":"♈","Boğa":"♉","İkizler":"♊","Yengeç":"♋","Aslan":"♌","Başak":"♍","Terazi":"♎","Akrep":"♏","Yay":"♐","Oğlak":"♑","Kova":"♒","Balık":"♓"}
BODY_GLYPHS = {"Güneş":"☉","Ay":"☽","Merkür":"☿","Venüs":"♀","Mars":"♂","Jüpiter":"♃","Satürn":"♄","Uranüs":"♅","Neptün":"♆","Plüton":"♇","Kuzey Ay Düğümü":"☊","ASC Yükselen":"ASC","Yükselen":"ASC","MC":"MC"}
BODY_TR_MAP = {
    "Sun":"Güneş","Moon":"Ay","Mercury":"Merkür","Venus":"Venüs","Mars":"Mars",
    "Jupiter":"Jüpiter","Saturn":"Satürn","Uranus":"Uranüs","Neptune":"Neptün",
    "Pluto":"Plüton","True Node":"Kuzey Ay Düğümü","North Node":"Kuzey Ay Düğümü",
    "Ascendant":"ASC Yükselen","ASC":"ASC Yükselen","MC":"MC",
}
ELEMENT_KEYS = ["Ateş","Toprak","Hava","Su"]
ELEMENT_FILES = {"Ateş":"ates.png","Toprak":"toprak.png","Hava":"hava.png","Su":"su.png"}
ELEMENT_API_KEYS = {"Ateş":"fire","Toprak":"earth","Hava":"air","Su":"water"}
ZODIAC_FILES = {s: f"{s} burcu.png" for s in SIGNS}

GOLD = HexColor("#d9a52d")
PALE_GOLD = HexColor("#f4d58a")
DARK = HexColor("#05080a")
INK = HexColor("#e9d6a5")
MUTED = HexColor("#9c8d6f")
BLUE = HexColor("#2e9ee6")
ORANGE = HexColor("#f5782d")

SIGN_TO_ELEMENT = {
    "Koç":"Ateş","Aslan":"Ateş","Yay":"Ateş",
    "Boğa":"Toprak","Başak":"Toprak","Oğlak":"Toprak",
    "İkizler":"Hava","Terazi":"Hava","Kova":"Hava",
    "Yengeç":"Su","Akrep":"Su","Balık":"Su",
}
SIGN_THEME_COLOR = {
    "Ateş": HexColor("#ff8412"),
    "Toprak": HexColor("#c5dd1c"),
    "Hava": HexColor("#cde2ee"),
    "Su": HexColor("#96d8ff"),
}


def _find_font() -> tuple[str, str, str]:
    candidates = [
        ("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf","/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf","/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf"),
        ("/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf","/usr/share/fonts/truetype/liberation2/LiberationSerif-Bold.ttf","/usr/share/fonts/truetype/liberation2/LiberationSerif-Italic.ttf"),
    ]
    for trio in candidates:
        if all(Path(x).exists() for x in trio): return trio
    raise RuntimeError("Turkish-capable serif font not found in runtime")


def register_fonts() -> tuple[str,str,str]:
    reg,bold,italic=_find_font()
    pdfmetrics.registerFont(TTFont("GMSerif",reg))
    pdfmetrics.registerFont(TTFont("GMSerifBold",bold))
    pdfmetrics.registerFont(TTFont("GMSerifItalic",italic))
    symbol="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    if not Path(symbol).exists():
        raise RuntimeError("symbol-capable font not found in runtime")
    pdfmetrics.registerFont(TTFont("GMSymbol",symbol))
    return reg,bold,italic


def load_json(path: str) -> dict[str,Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _need(obj: dict, key: str):
    if key not in obj or obj[key] in (None, ""):
        raise ValueError(f"missing required field: {key}")
    return obj[key]


def _canonical_scale_from_percent(value: float) -> float:
    """Same bounded visual scale policy as ASTRO DATA `gm_elements_v17_1`."""
    return max(0.82, min(1.18, 1.0 + (float(value) - 25.0) * 0.012))


def _element_payload(data: dict[str,Any]) -> tuple[dict[str,float], dict[str,float]]:
    """Accept either legacy flat Turkish percentages or the API element packet.

    Preferred live format:
      elements = {
        "status": "calculated",
        "policy_id": "gm_elements_v17_1",
        "percent": {"fire":..., "earth":..., "air":..., "water":...},
        "visual_scale": {"fire":..., "earth":..., "air":..., "water":...}
      }

    Legacy synthetic tests may still pass:
      elements = {"Ateş":..., "Toprak":..., "Hava":..., "Su":...}
    """
    elements=_need(data,"elements")
    if not isinstance(elements,dict):
        raise ValueError("elements must be an object")

    if all(k in elements for k in ELEMENT_KEYS):
        vals={k:float(elements[k]) for k in ELEMENT_KEYS}
        scales={k:_canonical_scale_from_percent(vals[k]) for k in ELEMENT_KEYS}
        return vals,scales

    if elements.get("status") not in (None,"calculated"):
        raise ValueError(f"element data unavailable: {elements.get('reason') or elements.get('status')}")

    percent=elements.get("percent")
    if not isinstance(percent,dict):
        raise ValueError("elements.percent is required for API element packet")

    vals={}
    for tr_key in ELEMENT_KEYS:
        api_key=ELEMENT_API_KEYS[tr_key]
        if api_key in percent:
            vals[tr_key]=float(percent[api_key])
        elif tr_key in percent:
            vals[tr_key]=float(percent[tr_key])
        else:
            raise ValueError(f"elements.percent missing {api_key}")

    visual=elements.get("visual_scale") or {}
    scales={}
    for tr_key in ELEMENT_KEYS:
        api_key=ELEMENT_API_KEYS[tr_key]
        raw = visual.get(api_key, visual.get(tr_key))
        scales[tr_key]=float(raw) if raw is not None else _canonical_scale_from_percent(vals[tr_key])
        if not (0.70 <= scales[tr_key] <= 1.30):
            raise ValueError(f"element visual scale out of safe range for {tr_key}")

    return vals,scales


def _normalize_render_labels(data: dict[str,Any]) -> None:
    """Normalize API English body labels to the renderer's canonical Turkish labels.

    This is a presentation adapter only; longitudes/degrees/houses are untouched.
    """
    placements=data.get("placements")
    if isinstance(placements,list):
        for p in placements:
            if isinstance(p,dict) and isinstance(p.get("body"),str):
                p["body"]=BODY_TR_MAP.get(p["body"],p["body"])
    aspects=data.get("aspects")
    if isinstance(aspects,list):
        for a in aspects:
            if not isinstance(a,dict):
                continue
            for key in ("a","b"):
                if isinstance(a.get(key),str):
                    a[key]=BODY_TR_MAP.get(a[key],a[key])


def validate(data: dict[str,Any], for_pdf: bool=True) -> None:
    _normalize_render_labels(data)
    profile=_need(data,"profile")
    for k in ["birth_date","birth_time","birth_place","report_date"]: _need(profile,k)
    sun=_need(data,"sun_sign"); asc=_need(data,"asc_sign")
    if sun not in SIGNS or asc not in SIGNS: raise ValueError("sun_sign/asc_sign must be Turkish zodiac names")
    placements=_need(data,"placements")
    if not isinstance(placements,list) or len(placements)<10: raise ValueError("placements must contain >=10 verified records")
    for p in placements:
        for k in ["body","sign","degree","longitude"]: _need(p,k)
        if p["sign"] not in SIGNS: raise ValueError(f"unknown sign: {p['sign']}")
        lon=float(p["longitude"])
        if not (0<=lon<360): raise ValueError(f"longitude out of range: {lon}")
    if for_pdf:
        cusps=_need(data,"house_cusps")
        if not isinstance(cusps,list) or len(cusps)!=12: raise ValueError("house_cusps must be 12 verified longitudes")
        for x in cusps:
            if not (0<=float(x)<360): raise ValueError("house_cusps longitude out of range")
        for ref in (PAGE1_REFERENCE, PAGE2_REFERENCE, PAGE3_REFERENCE):
            if not ref.exists():
                raise ValueError(f"missing canonical report reference: {ref.name}")
        _need(data,"motto")
    vals,_scales=_element_payload(data)
    if any(v<0 for v in vals.values()): raise ValueError("negative element percentage")
    if not (99.9 <= sum(vals.values()) <= 100.1): raise ValueError("element percentages must sum to 100")
    for k in ELEMENT_KEYS:
        asset_dir = ELEMENT_DIR if for_pdf else OPENING_ELEMENT_DIR
        asset_kind = "report" if for_pdf else "opening"
        if not (asset_dir/ELEMENT_FILES[k]).exists():
            raise ValueError(f"missing {asset_kind} element asset for {k}")


def _font_pil(size:int, bold=False):
    reg,bld,_=_find_font()
    return ImageFont.truetype(bld if bold else reg,size=size)

def _font_symbol_pil(size:int):
    path="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    if not Path(path).exists(): raise RuntimeError("symbol-capable font not found in runtime")
    return ImageFont.truetype(path,size=size)


def _alpha_crop(path: Path) -> Image.Image:
    im=Image.open(path).convert("RGBA")
    bbox=im.getbbox()
    return im.crop(bbox) if bbox else im


def _reference_size(path: Path, fallback: tuple[int,int]) -> tuple[int,int]:
    if not path.exists():
        raise ValueError(f"missing canonical 4 Element reference: {path.name}")
    with Image.open(path) as im:
        return im.size if im.width > 0 and im.height > 0 else fallback


def _draw_cosmic_background(im: Image.Image, seed: str, star_count: int=1200) -> ImageDraw.ImageDraw:
    W,H=im.size
    d=ImageDraw.Draw(im,"RGBA")
    rr=random.Random(int(hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16],16))
    margin=max(20,int(min(W,H)*0.02))
    for _ in range(star_count):
        x=rr.randrange(margin,W-margin); y=rr.randrange(margin,H-margin)
        r=rr.choice([1,1,1,1,2,2,3]); a=rr.randrange(55,210)
        col=(255,196+rr.randrange(0,45),105+rr.randrange(0,90),a)
        d.ellipse((x-r,y-r,x+r,y+r),fill=col)
        if r>=3:
            d.line((x-7,y,x+7,y),fill=(255,205,105,90),width=1)
            d.line((x,y-7,x,y+7),fill=(255,205,105,90),width=1)
    return d


def _draw_frame(d: ImageDraw.ImageDraw, W:int, H:int) -> None:
    gold=(217,165,45,255); pale=(246,215,145,255)
    for off,wid,alpha in [(18,3,255),(29,1,180)]:
        d.rectangle((off,off,W-off-1,H-off-1),outline=(217,165,45,alpha),width=wid)
    for x,y,sx,sy in [(30,30,1,1),(W-30,30,-1,1),(30,H-30,1,-1),(W-30,H-30,-1,-1)]:
        d.line((x,y,x+sx*62,y),fill=gold,width=2); d.line((x,y,x,y+sy*62),fill=gold,width=2)
        d.ellipse((x-6,y-6,x+6,y+6),outline=pale,width=2)


def _paste_element_art(im: Image.Image, key:str, center:tuple[float,float], target:int, silver_air:bool=False, opening_style:bool=False) -> None:
    asset_dir = OPENING_ELEMENT_DIR if opening_style else ELEMENT_DIR
    art=_alpha_crop(asset_dir/ELEMENT_FILES[key])
    if silver_air and key=="Hava":
        alpha=art.getchannel("A")
        g=art.convert("L")
        art=Image.merge("RGBA",(g,g,g,alpha))
    ratio=target/max(art.size)
    art=art.resize((max(1,int(art.width*ratio)),max(1,int(art.height*ratio))),Image.Resampling.LANCZOS)
    x,y=center
    im.alpha_composite(art,(int(x-art.width/2),int(y-art.height/2)))

def _pil_alpha_overlay(im: Image.Image, box: tuple[int,int,int,int], fill: tuple[int,int,int,int],
                       *, ellipse: bool=False, radius: int=0) -> None:
    """Blend a genuinely translucent dark veil over a canonical reference zone."""
    layer=Image.new("RGBA",im.size,(0,0,0,0))
    d=ImageDraw.Draw(layer,"RGBA")
    if ellipse:
        d.ellipse(box,fill=fill)
    elif radius:
        d.rounded_rectangle(box,radius=radius,fill=fill)
    else:
        d.rectangle(box,fill=fill)
    im.alpha_composite(layer)



def render_elements_opening(data: dict[str,Any], out_path: str) -> None:
    """Conversation/opening visual locked to 4_element_opening.png composition family."""
    validate(data, for_pdf=False)
    vals,scales=_element_payload(data)
    W,H=_reference_size(OPENING_ELEMENT_REFERENCE,(1254,1254))
    cream=(246,238,229,255)
    ink=(129,90,33,255)
    gold=(166,111,35,230)
    pale=(199,160,90,210)
    im=Image.new("RGBA",(W,H),cream)
    d=ImageDraw.Draw(im,"RGBA")

    # Subtle paper texture derived deterministically; no external asset/network.
    prof=data.get("profile",{})
    seed=f"{prof.get('name','')}|{prof.get('birth_date','')}|elements|opening"
    rr=random.Random(int(hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16],16))
    for _ in range(2600):
        x=rr.randrange(W); y=rr.randrange(H)
        tone=rr.choice([-4,-3,-2,-1,1,2,3,4])
        base=cream[:3]
        col=tuple(max(0,min(255,c+tone)) for c in base)+(rr.randrange(12,38),)
        d.point((x,y),fill=col)

    cx,cy=W/2,H/2
    R=min(W,H)*0.47

    # Large zodiac ring and inner geometry, matching the light opening canon.
    d.ellipse((cx-R,cy-R,cx+R,cy+R),outline=(147,101,39,215),width=2)
    d.ellipse((cx-R+7,cy-R+7,cx+R-7,cy+R-7),outline=(183,138,75,155),width=1)
    d.ellipse((cx-R+28,cy-R+28,cx+R-28,cy+R-28),outline=(188,150,91,135),width=1)

    symfont=_font_symbol_pil(max(25,int(H*0.027)))
    for i,s in enumerate(SIGNS):
        a=math.radians(-90+i*30)
        # radial sector line
        x1=cx+(R-175)*math.cos(a); y1=cy+(R-175)*math.sin(a)
        x2=cx+(R-38)*math.cos(a); y2=cy+(R-38)*math.sin(a)
        d.line((x1,y1,x2,y2),fill=(161,120,62,120),width=1)
        # glyph between major marks
        a2=math.radians(-75+i*30)
        tx=cx+(R-45)*math.cos(a2); ty=cy+(R-45)*math.sin(a2)
        glyph=SIGN_GLYPHS[s]
        bb=d.textbbox((0,0),glyph,font=symfont)
        d.text((tx-(bb[2]-bb[0])/2,ty-(bb[3]-bb[1])/2),glyph,font=symfont,fill=ink)

    # Fine tick marks.
    for i in range(120):
        a=math.radians(-90+i*3)
        outer=R-10
        inner=R-(23 if i%10 else 34)
        x1=cx+inner*math.cos(a); y1=cy+inner*math.sin(a)
        x2=cx+outer*math.cos(a); y2=cy+outer*math.sin(a)
        d.line((x1,y1,x2,y2),fill=(150,110,54,120),width=1)

    # Four dynamic medallions. Scale comes from ASTRO DATA.
    pos={
        "Ateş":(cx,H*0.255),
        "Toprak":(W*0.225,H*0.515),
        "Hava":(W*0.775,H*0.515),
        "Su":(cx,H*0.765),
    }
    base={"Ateş":310,"Toprak":270,"Hava":270,"Su":265}
    for k in ELEMENT_KEYS:
        target=int(base[k]*scales[k])
        _paste_element_art(im,k,pos[k],target,opening_style=True)

    # Central summary medallion.
    cr=min(W,H)*0.145
    d.ellipse((cx-cr,cy-cr,cx+cr,cy+cr),fill=(247,239,231,250),outline=(163,112,45,235),width=3)
    d.ellipse((cx-cr+8,cy-cr+8,cx+cr-8,cy+cr-8),outline=(191,151,92,155),width=1)
    ft=_font_pil(max(18,int(H*0.019)),True)
    t="4 ELEMENT DAĞILIMI"; bb=d.textbbox((0,0),t,font=ft)
    d.text((cx-(bb[2]-bb[0])/2,cy-cr+36),t,font=ft,fill=(36,34,31,255))
    d.line((cx-cr*0.30,cy-cr+72,cx+cr*0.30,cy-cr+72),fill=(110,98,83,150),width=1)

    label_colors={
        "Ateş":(211,86,18,255),
        "Toprak":(86,112,42,255),
        "Hava":(37,117,173,255),
        "Su":(22,139,176,255),
    }
    fy=cy-cr+94
    fr=_font_pil(max(18,int(H*0.019)),False)
    fp=_font_pil(max(18,int(H*0.019)),True)
    for k in ELEMENT_KEYS:
        d.text((cx-cr*0.58,fy),k.upper(),font=fr,fill=label_colors[k])
        pct=f"%{vals[k]:g}"; bb=d.textbbox((0,0),pct,font=fp)
        d.text((cx+cr*0.58-(bb[2]-bb[0]),fy),pct,font=fp,fill=(40,38,35,255))
        fy+=max(34,int(H*0.034))

    # External labels positioned like the approved opening reference.
    flab=_font_pil(max(24,int(H*0.025)),False)
    fpct=_font_pil(max(27,int(H*0.029)),False)
    outer_label_pos={
        "Ateş":(cx,H*0.085),
        "Toprak":(W*0.22,H*0.63),
        "Hava":(W*0.78,H*0.63),
        "Su":(cx,H*0.88),
    }
    for k,(x,y) in outer_label_pos.items():
        name=k.upper(); pct=f"%{vals[k]:g}"
        bb=d.textbbox((0,0),name,font=flab)
        d.text((x-(bb[2]-bb[0])/2,y),name,font=flab,fill=label_colors[k])
        bb=d.textbbox((0,0),pct,font=fpct)
        d.text((x-(bb[2]-bb[0])/2,y+40),pct,font=fpct,fill=label_colors[k])

    im.convert("RGB").save(out_path,quality=96)

def render_elements_report(data: dict[str,Any], out_path: str) -> None:
    """PDF page 3: Page_3_CANONICAL.png is the full-page visual lock.

    The renderer does not rebuild the page frame, panels, headings or zodiac wheel.
    It replaces only the dynamic element medallions and percentage values with
    verified API data. Panel masks are translucent overlays, never opaque black.
    """
    elements=_need(data,"elements")
    if isinstance(elements,dict) and not all(k in elements for k in ELEMENT_KEYS):
        visual=elements.get("visual_scale")
        if not isinstance(visual,dict):
            raise ValueError("elements.visual_scale is required for canonical PDF page 3")
        for tr_key in ELEMENT_KEYS:
            api_key=ELEMENT_API_KEYS[tr_key]
            if api_key not in visual and tr_key not in visual:
                raise ValueError(f"elements.visual_scale missing {api_key}")
    vals,scales=_element_payload(data)
    if not PAGE3_REFERENCE.exists():
        raise ValueError(f"missing canonical report reference: {PAGE3_REFERENCE.name}")

    im=Image.open(PAGE3_REFERENCE).convert("RGBA")
    W,H=im.size

    base_w,base_h=1024.0,1535.0
    sx,sy=W/base_w,H/base_h
    ss=min(sx,sy)
    def pt(x: float,y: float) -> tuple[int,int]:
        return int(round(x*sx)),int(round(y*sy))
    def box(x1: float,y1: float,x2: float,y2: float) -> tuple[int,int,int,int]:
        a,b=pt(x1,y1); c,e=pt(x2,y2)
        return a,b,c,e

    pale=(246,215,145,255)
    label_colors={
        "Ateş":(255,132,18,255),
        "Toprak":(197,221,28,255),
        "Hava":(205,226,238,255),
        "Su":(150,216,255,255),
    }

    pos_base={"Ateş":(512,454),"Toprak":(194,792),"Hava":(830,792),"Su":(512,1095)}
    clear_r={"Ateş":166,"Toprak":172,"Hava":172,"Su":154}
    positions={k:pt(*xy) for k,xy in pos_base.items()}
    for k,(x,y) in positions.items():
        rr=int(round(clear_r[k]*ss))
        _pil_alpha_overlay(im,(x-rr,y-rr,x+rr,y+rr),(2,9,12,235),ellipse=True)

    base={"Ateş":278,"Toprak":274,"Hava":274,"Su":252}
    for k in ELEMENT_KEYS:
        target=max(1,int(round(base[k]*scales[k]*ss)))
        _paste_element_art(im,k,positions[k],target,silver_air=True)

    outer_pct_boxes={
        "Ateş":(438,228,586,288),
        "Toprak":(36,626,162,686),
        "Hava":(861,626,987,686),
        "Su":(456,1250,568,1332),
    }
    for raw in outer_pct_boxes.values():
        _pil_alpha_overlay(im,box(*raw),(2,9,12,208),radius=max(2,int(round(10*ss))))

    d=ImageDraw.Draw(im,"RGBA")
    f_outer=_font_pil(max(18,int(round(38*ss))),False)
    pct_centers={"Ateş":(512,240),"Toprak":(98,636),"Hava":(926,636),"Su":(512,1312)}
    for k,(bx,by) in pct_centers.items():
        x,y=pt(bx,by)
        pct=_fmt_pct(vals[k])
        bb=d.textbbox((0,0),pct,font=f_outer)
        d.text((x-(bb[2]-bb[0])/2,y),pct,font=f_outer,fill=label_colors[k])

    _pil_alpha_overlay(im,box(404,657,620,929),(2,9,12,202),radius=max(2,int(round(18*ss))))
    d=ImageDraw.Draw(im,"RGBA")
    f_title=_font_pil(max(13,int(round(20*ss))),True)
    f_row=_font_pil(max(14,int(round(24*ss))),True)
    f_pct=_font_pil(max(14,int(round(23*ss))),True)
    cx,cy=pt(512,705)
    title="4 ELEMENT DAĞILIMI"
    bb=d.textbbox((0,0),title,font=f_title)
    d.text((cx-(bb[2]-bb[0])/2,cy),title,font=f_title,fill=pale)
    x1,y1=pt(448,736); x2,_=pt(576,736)
    d.line((x1,y1,x2,y1),fill=(214,181,103,155),width=max(1,int(round(1.5*ss))))
    row_y={"Ateş":770,"Toprak":822,"Hava":874,"Su":926}
    label_x,_=pt(438,0)
    right_x,_=pt(585,0)
    for k,by in row_y.items():
        _,y=pt(0,by)
        d.text((label_x,y),k.upper(),font=f_row,fill=label_colors[k])
        pct=_fmt_pct(vals[k])
        bb=d.textbbox((0,0),pct,font=f_pct)
        d.text((right_x-(bb[2]-bb[0]),y),pct,font=f_pct,fill=pale)

    im.convert("RGB").save(out_path,quality=96)


def render_elements(data: dict[str,Any], out_path: str) -> None:
    """Public element command: opening/chat visual only."""
    render_elements_opening(data,out_path)

def _stars(c: canvas.Canvas, seed: str, w:float,h:float,n:int=420):
    r=random.Random(int(hashlib.sha256(seed.encode()).hexdigest()[:16],16))
    c.setFillColor(DARK); c.rect(0,0,w,h,fill=1,stroke=0)
    for _ in range(n):
        x=r.random()*w; y=r.random()*h; rad=r.choice([.35,.45,.6,.8,1.1])
        a=r.uniform(.25,.9); c.setFillColor(Color(1,.82,.42,alpha=a)); c.circle(x,y,rad,fill=1,stroke=0)


def _ornate_border(c,w,h):
    c.setStrokeColor(GOLD); c.setLineWidth(1.0); c.rect(12,12,w-24,h-24,fill=0,stroke=1)
    c.setStrokeColor(PALE_GOLD); c.setLineWidth(.3); c.rect(17,17,w-34,h-34,fill=0,stroke=1)
    for x,y,sx,sy in [(20,h-20,1,-1),(w-20,h-20,-1,-1),(20,20,1,1),(w-20,20,-1,1)]:
        c.setStrokeColor(GOLD); c.setLineWidth(.8)
        c.line(x,y,x+sx*25,y); c.line(x,y,x,y+sy*25)
        c.circle(x+sx*5,y+sy*5,4,fill=0,stroke=1)


def _fit_text(c,text,x,y,width,font="GMSerif",size=12,leading=16,max_lines=6,color=INK):
    words=str(text).split(); lines=[]; cur=""
    for word in words:
        trial=(cur+" "+word).strip()
        if c.stringWidth(trial,font,size)<=width: cur=trial
        else:
            if cur: lines.append(cur)
            cur=word
    if cur: lines.append(cur)
    if len(lines)>max_lines:
        lines=lines[:max_lines]; lines[-1]=lines[-1].rstrip(" .")+"…"
    c.setFont(font,size); c.setFillColor(color)
    yy=y
    for line in lines:
        c.drawString(x,yy,line); yy-=leading
    return yy

def _draw_centred_fit(c: canvas.Canvas, text: str, x: float, y: float, max_width: float,
                       font: str, size: float, min_size: float, color=INK) -> float:
    """Draw one centered line, shrinking only as much as needed to fit its locked zone."""
    text=str(text or "")
    actual=float(size)
    while actual>min_size and c.stringWidth(text,font,actual)>max_width:
        actual=max(min_size,actual-.25)
    c.setFillColor(color); c.setFont(font,actual); c.drawCentredString(x,y,text)
    return actual



_ZODIAC_RENDER_CACHE: dict[str, ImageReader] = {}

def _zodiac_img(sign):
    """Return a render-safe derived view of the exact canonical RAR asset.

    The supplied 500x500 source files visibly contain a baked neutral
    checkerboard. We keep those files byte-exact as canonical source and remove
    only low-chroma neutral pixels in-memory so the colored zodiac artwork can
    sit on the report's dark background.
    """
    if sign in _ZODIAC_RENDER_CACHE:
        return _ZODIAC_RENDER_CACHE[sign]
    im=Image.open(ZODIAC_DIR/ZODIAC_FILES[sign]).convert("RGBA")
    px=im.load()
    for y in range(im.height):
        for x in range(im.width):
            r,g,b,a=px[x,y]
            chroma=max(r,g,b)-min(r,g,b)
            # Neutral checkerboard/white field -> transparent. Saturated zodiac
            # linework and colored glow remain. Use a soft edge near threshold.
            if chroma <= 10:
                na=0
            elif chroma < 28:
                na=int(a*(chroma-10)/18)
            else:
                na=a
            px[x,y]=(r,g,b,na)
    _ZODIAC_RENDER_CACHE[sign]=ImageReader(im)
    return _ZODIAC_RENDER_CACHE[sign]



def _draw_reference_page(c: canvas.Canvas, reference: Path, w: float, h: float) -> None:
    """Draw the approved canonical reference as the visual base.

    The reference may contain example/sample personal data. Variable zones are
    explicitly sanitized by the page renderer before live ASTRO DATA is drawn.
    """
    if not reference.exists():
        raise ValueError(f"missing canonical report reference: {reference.name}")
    c.drawImage(ImageReader(str(reference)), 0, 0, w, h, mask='auto')


def _ref_box(c: canvas.Canvas, ref_size: tuple[int,int], w: float, h: float,
             x1: float, y1: float, x2: float, y2: float,
             fill=Color(.008,.016,.018,alpha=.97), radius: float=0) -> None:
    """Mask a sample-data zone expressed in top-left reference pixels."""
    rw,rh=ref_size
    px=x1/rw*w
    py=h-(y2/rh*h)
    pw=(x2-x1)/rw*w
    ph=(y2-y1)/rh*h
    c.saveState()
    try:
        c.setFillAlpha(fill.alpha if getattr(fill,"alpha",None) is not None else 1)
    except Exception:
        pass
    c.setFillColor(fill)
    if radius:
        c.roundRect(px,py,pw,ph,radius,fill=1,stroke=0)
    else:
        c.rect(px,py,pw,ph,fill=1,stroke=0)
    c.restoreState()


def _ref_xy(ref_size: tuple[int,int], w: float, h: float, x: float, y: float) -> tuple[float,float]:
    rw,rh=ref_size
    return x/rw*w, h-y/rh*h


def _human_date_tr(value: Any) -> str:
    s=str(value or "").strip()
    months=["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran",
            "Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"]
    for sep in (".","-","/"):
        parts=s.split(sep)
        if len(parts)==3 and all(p.strip().isdigit() for p in parts):
            a,b,c=[int(p) for p in parts]
            if len(parts[0])==4:  # YYYY-MM-DD
                year,month,day=a,b,c
            else:
                day,month,year=a,b,c
            if 1<=month<=12:
                return f"{day} {months[month-1]} {year}"
    return s


def _normalize_body_name(body: Any) -> str:
    raw=str(body or "").strip()
    return BODY_TR_MAP.get(raw, raw)


def _resolved_signs(data: dict[str,Any]) -> tuple[str,str]:
    sun=str(data.get("sun_sign") or "").strip()
    asc=str(data.get("asc_sign") or "").strip()
    for p in data.get("placements",[]) or []:
        body=_normalize_body_name(p.get("body"))
        sign=str(p.get("sign") or "").strip()
        if body=="Güneş" and sign in SIGNS:
            sun=sign
        elif body in ("ASC Yükselen","Yükselen") and sign in SIGNS:
            asc=sign
    if sun not in SIGNS:
        sun=SIGNS[0]
    if asc not in SIGNS:
        asc=SIGNS[0]
    return sun,asc


def _fmt_pct(value: Any) -> str:
    try:
        v=float(value)
    except Exception:
        return str(value)
    if abs(v-round(v)) < 0.05:
        return f"%{int(round(v))}"
    return f"%{v:.1f}".replace(".0","")


def _stars_region(c: canvas.Canvas, seed: str, x: float, y: float, width: float, height: float, n: int=140) -> None:
    """Add restrained canonical-like star texture only inside a sanitized live-data zone."""
    rr=random.Random(int(hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16],16))
    c.saveState()
    for _ in range(n):
        sx=x+rr.random()*width
        sy=y+rr.random()*height
        rad=rr.choice([.25,.35,.45,.6,.8])
        col=Color(1,.80+rr.random()*.15,.38+rr.random()*.25,alpha=.20+rr.random()*.35)
        c.setFillColor(col)
        c.circle(sx,sy,rad,fill=1,stroke=0)
    c.restoreState()


def _draw_premium_zodiac_medallion(c: canvas.Canvas, sign: str, x: float, y: float,
                                   radius: float, accent: str="gold") -> None:
    """Premium report treatment around the exact packaged zodiac asset.

    No zodiac art is invented here: the packaged asset remains the subject.
    Glow/rings only reproduce the canonical report's medallion treatment.
    """
    if accent=="blue":
        glow=[HexColor("#113f63"),HexColor("#176aa7"),HexColor("#55c8ff")]
        core=HexColor("#79d9ff")
    else:
        glow=[HexColor("#5c3205"),HexColor("#b8650b"),HexColor("#ffc04c")]
        core=HexColor("#ffd87b")

    c.saveState()
    # layered halo
    for rr,col,alpha,lw in [
        (radius*1.22,glow[0],.20,8),
        (radius*1.13,glow[1],.34,5),
        (radius*1.05,glow[2],.62,2.4),
        (radius*.98,core,.90,1.2),
    ]:
        try:
            c.setStrokeAlpha(alpha)
        except Exception:
            pass
        c.setStrokeColor(col)
        c.setLineWidth(lw)
        c.circle(x,y,rr,fill=0,stroke=1)
    try:
        c.setStrokeAlpha(1)
    except Exception:
        pass
    c.setFillColor(Color(.003,.008,.01,alpha=.90))
    c.circle(x,y,radius*.94,fill=1,stroke=0)
    sz=radius*1.78
    c.drawImage(_zodiac_img(sign),x-sz/2,y-sz/2,sz,sz,mask='auto')
    c.restoreState()

def _sign_color(sign: str):
    element=SIGN_TO_ELEMENT.get(str(sign or "").strip(), "Ateş")
    return SIGN_THEME_COLOR[element]


def _draw_segmented_centered_text(c: canvas.Canvas, left_text: str, right_text: str,
                                  x: float, y: float, left_color, right_color,
                                  font: str="GMSerifBold", size: float=10.4) -> None:
    c.setFont(font,size)
    left_w=pdfmetrics.stringWidth(left_text,font,size)
    right_w=pdfmetrics.stringWidth(right_text,font,size)
    total=left_w+right_w
    start=x-total/2.0
    c.setFillColor(left_color)
    c.drawString(start,y,left_text)
    c.setFillColor(right_color)
    c.drawString(start+left_w,y,right_text)


def _draw_page_number(c: canvas.Canvas, ref_size: tuple[int,int], w: float, h: float, number: int) -> None:
    # Replace the baked sample page number with a smaller live one, same on all pages.
    _ref_box(c,ref_size,w,h,930,34,995,85,fill=Color(.008,.014,.016,alpha=.64),radius=3)
    x,y=_ref_xy(ref_size,w,h,963,64)
    c.setFillColor(PALE_GOLD)
    c.setFont("GMSerifBold",10.9)
    c.drawCentredString(x,y,f"{int(number):02d}")


def _page1(c,data,w,h):
    """Page 1: canonical reference is the page; renderer overlays live text only."""
    prof=data["profile"]
    ref_size=(1024,1535)
    _draw_reference_page(c,PAGE1_REFERENCE,w,h)
    sun_sign,asc_sign=_resolved_signs(data)

    veil_soft=Color(.008,.014,.016,alpha=.78)
    veil_body=Color(.008,.014,.016,alpha=.92)

    # Left birth-data value column.
    for row in [(280,332,507,401),(280,404,507,472),(280,475,507,543),(280,546,507,614)]:
        _ref_box(c,ref_size,w,h,*row,fill=veil_soft,radius=2)
    # Right-side baked sample meta around the medallions.
    for row in [
        (650,320,878,366),
        (675,392,835,437),
        (625,451,905,503),
        (690,549,830,592),
    ]:
        _ref_box(c,ref_size,w,h,*row,fill=Color(.008,.014,.016,alpha=.82),radius=2)

    # Senin Yolun / Sinerji / motto zones.
    _ref_box(c,ref_size,w,h,70,825,500,1098,fill=veil_body,radius=3)
    _ref_box(c,ref_size,w,h,70,1128,500,1398,fill=veil_body,radius=3)
    _ref_box(c,ref_size,w,h,150,1447,878,1500,fill=Color(.008,.014,.016,alpha=.78),radius=3)

    values=[
        _human_date_tr(prof["birth_date"]),
        str(prof["birth_time"]),
        str(prof["birth_place"]),
        _human_date_tr(prof["report_date"]),
    ]
    left_value_x=391
    left_value_ys=[364,435,505,575]
    left_width=205/ref_size[0]*w
    for value,yy in zip(values,left_value_ys):
        x,y=_ref_xy(ref_size,w,h,left_value_x,yy)
        _draw_centred_fit(c,value,x,y,left_width,"GMSerif",13.4,10.8,PALE_GOLD)

    right_meta=[
        (_human_date_tr(prof["birth_date"]), 764, 345, 230),
        (str(prof["birth_time"]), 756, 417, 160),
        (str(prof["birth_place"]), 765, 482, 280),
        (_human_date_tr(prof["report_date"]), 758, 571, 170),
    ]
    for value,xx,yy,ww in right_meta:
        x,y=_ref_xy(ref_size,w,h,xx,yy)
        _draw_centred_fit(c,value,x,y,ww/ref_size[0]*w,"GMSerif",11.6,9.1,PALE_GOLD)

    st=data.get("senin_yolun","")
    if isinstance(st,list): st=" ".join(st)
    x,y=_ref_xy(ref_size,w,h,76,872)
    _fit_text(c,st,x,y,398/ref_size[0]*w,font="GMSerifItalic",size=13.1,leading=18.2,max_lines=9,color=PALE_GOLD)

    c.saveState()
    c.setStrokeColor(Color(.85,.65,.20,alpha=.90))
    c.setLineWidth(0.8)
    x1,y1=_ref_xy(ref_size,w,h,500,844)
    x2,y2=_ref_xy(ref_size,w,h,500,1096)
    c.line(x1,y1,x2,y2)
    xb1,yb=_ref_xy(ref_size,w,h,86,1096)
    xb2,_=_ref_xy(ref_size,w,h,500,1096)
    c.line(xb1,yb,xb2,yb)
    sx1,sy1=_ref_xy(ref_size,w,h,500,1136)
    sx2,sy2=_ref_xy(ref_size,w,h,500,1394)
    c.line(sx1,sy1,sx2,sy2)
    sxb1,syb=_ref_xy(ref_size,w,h,86,1394)
    sxb2,_=_ref_xy(ref_size,w,h,500,1394)
    c.line(sxb1,syb,sxb2,syb)
    c.restoreState()

    synergy_title=f"{sun_sign} + {asc_sign} Sinerjisi"
    tx,ty=_ref_xy(ref_size,w,h,283,1168)
    _draw_centred_fit(c,synergy_title,tx,ty,405/ref_size[0]*w,
                      "GMSerifBold",16.0,11.0,PALE_GOLD)

    syn=data.get("synergy_text","")
    if isinstance(syn,list): syn=" ".join(syn)
    x,y=_ref_xy(ref_size,w,h,76,1218)
    _fit_text(c,syn,x,y,398/ref_size[0]*w,font="GMSerifItalic",size=13.1,leading=18.2,max_lines=8,color=PALE_GOLD)

    motto=str(data.get("motto","") or "").strip()
    if motto:
        mx,my=_ref_xy(ref_size,w,h,512,1478)
        if "," in motto:
            left,right=motto.split(",",1)
            left=f"{left.strip()}, "
            right=right.strip()
            _draw_segmented_centered_text(c,left,right,mx,my,
                                          _sign_color(sun_sign),
                                          _sign_color(asc_sign),
                                          font="GMSerifBold",size=10.4)
        else:
            _draw_centred_fit(c,motto,mx,my,620/ref_size[0]*w,
                              "GMSerifBold",10.4,7.2,PALE_GOLD)

    _draw_page_number(c,ref_size,w,h,1)


def _polar(lon,cx,cy,r):
    a=math.radians(90-float(lon)); return cx+r*math.cos(a), cy+r*math.sin(a)


def _draw_wheel(c,data,cx,cy,R):
    c.setStrokeColor(GOLD); c.setLineWidth(1.0); c.circle(cx,cy,R,stroke=1,fill=0); c.circle(cx,cy,R*.82,stroke=1,fill=0); c.circle(cx,cy,R*.55,stroke=1,fill=0)
    # zodiac division
    for i,s in enumerate(SIGNS):
        lon=i*30; x1,y1=_polar(lon,cx,cy,R*.82); x2,y2=_polar(lon,cx,cy,R)
        c.setStrokeColor(Color(.85,.65,.2,alpha=.55)); c.setLineWidth(.5); c.line(x1,y1,x2,y2)
        tx,ty=_polar(lon+15,cx,cy,R*.91); c.setFillColor(PALE_GOLD); c.setFont("GMSymbol",13); c.drawCentredString(tx,ty-4,SIGN_GLYPHS[s])
    # house cusps verified data
    for lon in data["house_cusps"]:
        x1,y1=_polar(lon,cx,cy,R*.25); x2,y2=_polar(lon,cx,cy,R*.82)
        c.setStrokeColor(Color(.75,.65,.48,alpha=.55)); c.setLineWidth(.45); c.line(x1,y1,x2,y2)
    # aspects first
    pl={p["body"]:p for p in data["placements"]}
    for a in data.get("aspects",[]):
        if a.get("a") not in pl or a.get("b") not in pl: continue
        x1,y1=_polar(pl[a["a"]]["longitude"],cx,cy,R*.52); x2,y2=_polar(pl[a["b"]]["longitude"],cx,cy,R*.52)
        strength=a.get("strength")
        alpha=.32 if strength is None else .18+.55*max(0,min(1,float(strength)))
        typ=str(a.get("type","")).lower()
        col=Color(.25,.66,.95,alpha=alpha) if any(x in typ for x in ["üçgen","sekstil","trine","sextile"]) else Color(.95,.45,.25,alpha=alpha)
        c.setStrokeColor(col); c.setLineWidth(.6 if strength is None else .4+1.2*float(strength)); c.line(x1,y1,x2,y2)
    # planet markers
    for p in data["placements"]:
        if p["body"] in ["ASC Yükselen","Yükselen","MC"]: continue
        x,y=_polar(p["longitude"],cx,cy,R*.68)
        c.setFillColor(DARK); c.setStrokeColor(PALE_GOLD); c.circle(x,y,8,fill=1,stroke=1)
        c.setFillColor(PALE_GOLD); c.setFont("GMSymbol",8); c.drawCentredString(x,y-3,BODY_GLYPHS.get(p["body"],p["body"][:2]))


def _badge(c,p,x,y,sz=54,label_side="right"):
    sign=p["sign"]
    c.saveState()
    for rr,alpha,lw,col in [
        (sz*.62,.18,5,HexColor("#8f5e16")),
        (sz*.56,.45,2.2,GOLD),
        (sz*.52,.90,.8,PALE_GOLD),
    ]:
        try: c.setStrokeAlpha(alpha)
        except Exception: pass
        c.setStrokeColor(col); c.setLineWidth(lw); c.circle(x,y,rr,stroke=1,fill=0)
    try: c.setStrokeAlpha(1)
    except Exception: pass
    c.setFillColor(DARK); c.circle(x,y,sz*.48,fill=1,stroke=0)
    c.drawImage(_zodiac_img(sign),x-sz/2,y-sz/2,sz,sz,mask='auto')
    c.restoreState()

    body=p["body"].replace("ASC Yükselen","YÜKSELEN").upper()
    txt=str(p.get("degree",""))
    if p.get("house") not in (None,""): txt+=f"  {p['house']}. Ev"
    c.setFillColor(INK)
    if label_side=="left":
        lx=x-sz*.66
        c.setFont("GMSerifBold",8.5); c.drawRightString(lx,y+12,body)
        c.setFont("GMSerif",8); c.drawRightString(lx,y-1,sign.upper()); c.drawRightString(lx,y-14,txt)
    else:
        lx=x+sz*.66
        c.setFont("GMSerifBold",8.5); c.drawString(lx,y+12,body)
        c.setFont("GMSerif",8); c.drawString(lx,y-1,sign.upper()); c.drawString(lx,y-14,txt)


def _page2(c,data,w,h):
    """Page 2: use the locked premium page as-is; do not reconstruct it."""
    ref_size=(1024,1535)
    _draw_reference_page(c,PAGE2_REFERENCE,w,h)
    _draw_page_number(c,ref_size,w,h,2)


def _page3(c,data,w,h) -> None:
    """Page 3: full-bleed canonical page plus verified dynamic element data."""
    ref_size=(1024,1535)
    with tempfile.TemporaryDirectory(prefix="gmv17_page3_") as td:
        png=Path(td)/"page3_live.png"
        render_elements_report(data,str(png))
        c.drawImage(ImageReader(str(png)),0,0,w,h,mask='auto')
    _draw_page_number(c,ref_size,w,h,3)


def render_pdf(data: dict[str,Any], out_path: str) -> None:
    validate(data,for_pdf=True); register_fonts(); c=canvas.Canvas(out_path,pagesize=A4)
    w,h=A4; _page1(c,data,w,h); c.showPage(); _page2(c,data,w,h); c.showPage(); _page3(c,data,w,h); c.showPage(); c.save()


def main():
    ap=argparse.ArgumentParser(); ap.add_argument("mode",choices=["elements","pdf"]); ap.add_argument("input_json"); ap.add_argument("output")
    args=ap.parse_args(); data=load_json(args.input_json)
    if args.mode=="elements": render_elements(data,args.output)
    else: render_pdf(data,args.output)
    print(args.output)

if __name__=="__main__":
    main()
