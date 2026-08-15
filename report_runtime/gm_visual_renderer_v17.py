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
REPORT_ELEMENT_REFERENCE = REFERENCE_DIR / "4_element_report.png"
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
        for ref in (PAGE1_REFERENCE, PAGE2_REFERENCE, PAGE3_REFERENCE, REPORT_ELEMENT_REFERENCE):
            if not ref.exists():
                raise ValueError(f"missing canonical report reference: {ref.name}")
    vals,_scales=_element_payload(data)
    if any(v<0 for v in vals.values()): raise ValueError("negative element percentage")
    if not (99.9 <= sum(vals.values()) <= 100.1): raise ValueError("element percentages must sum to 100")
    for s in {sun,asc,*[p["sign"] for p in placements]}:
        if not (ZODIAC_DIR/ZODIAC_FILES[s]).exists(): raise ValueError(f"missing zodiac asset for {s}")
    for k in ELEMENT_KEYS:
        if not (ELEMENT_DIR/ELEMENT_FILES[k]).exists(): raise ValueError(f"missing report element asset for {k}")
        if not (OPENING_ELEMENT_DIR/ELEMENT_FILES[k]).exists(): raise ValueError(f"missing opening element asset for {k}")


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
    """PDF page 3: approved 4_element_report.png visual base + verified live data.

    Example percentages and example medallion sizes embedded in the reference
    are never treated as user data. Only those dynamic pixels are replaced.
    """
    validate(data, for_pdf=False)
    vals,scales=_element_payload(data)
    if not REPORT_ELEMENT_REFERENCE.exists():
        raise ValueError(f"missing canonical 4 Element reference: {REPORT_ELEMENT_REFERENCE.name}")

    im=Image.open(REPORT_ELEMENT_REFERENCE).convert("RGBA")
    W,H=im.size
    d=ImageDraw.Draw(im,"RGBA")
    cx,cy=W/2,760
    bg=(3,10,12,255)
    gold=(217,165,45,255)
    pale=(246,215,145,255)

    # Remove baked example medallions; live canonical element art is placed next.
    pos={"Ateş":(cx,455),"Toprak":(205,790),"Hava":(W-205,790),"Su":(cx,1085)}
    clear_r={"Ateş":174,"Toprak":179,"Hava":179,"Su":162}
    for k,(x,y) in pos.items():
        rr=clear_r[k]
        d.ellipse((x-rr,y-rr,x+rr,y+rr),fill=bg)

    # Restore the main wheel lines across sanitized medallion zones.
    for rradius,alpha,wid in [(410,205,2),(392,125,1),(335,95,1)]:
        d.ellipse((cx-rradius,cy-rradius,cx+rradius,cy+rradius),
                  outline=(217,165,45,alpha),width=wid)

    # Live medallions from the packaged canonical element artwork.
    base={"Ateş":286,"Toprak":282,"Hava":282,"Su":260}
    for k in ELEMENT_KEYS:
        target=int(base[k]*scales[k])
        _paste_element_art(im,k,pos[k],target,silver_air=True)

    # Replace the example outer labels/percentages after medallion sanitization.
    outer_boxes={
        "Ateş":(405,205,680,315),
        "Toprak":(28,575,285,700),
        "Hava":(800,575,1057,700),
        "Su":(405,1190,680,1315),
    }
    for box in outer_boxes.values():
        d.rounded_rectangle(box,radius=9,fill=(3,10,12,246),outline=(217,165,45,150),width=2)

    label_colors={"Ateş":(255,132,18,255),"Toprak":(197,221,28,255),
                  "Hava":(205,226,238,255),"Su":(150,216,255,255)}
    outer_pos={"Ateş":(cx,220),"Toprak":(151,600),"Hava":(W-151,600),"Su":(cx,1210)}
    f_lab=_font_pil(31,True); f_pct=_font_pil(40,False)
    for k,(x,y) in outer_pos.items():
        name=k.upper(); pct=f"%{vals[k]:g}"
        bb=d.textbbox((0,0),name,font=f_lab)
        d.text((x-(bb[2]-bb[0])/2,y),name,font=f_lab,fill=label_colors[k])
        bb=d.textbbox((0,0),pct,font=f_pct)
        d.text((x-(bb[2]-bb[0])/2,y+40),pct,font=f_pct,fill=label_colors[k])

    # Center title/names/icons stay from the approved reference. Replace only
    # the example percentage column.
    center_pct_zone=(575,676,738,902)
    d.rounded_rectangle(center_pct_zone,radius=10,fill=(2,11,13,250))
    center_rows={"Ateş":700,"Toprak":752,"Hava":804,"Su":856}
    fp=_font_pil(27,True)
    for k,y in center_rows.items():
        pct=f"%{vals[k]:g}"
        bb=d.textbbox((0,0),pct,font=fp)
        d.text((700-(bb[2]-bb[0]),y),pct,font=fp,fill=pale)

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

def _page1(c,data,w,h):
    """Page 1: canonical reference locked as visual base; only personal zones are dynamic."""
    prof=data["profile"]
    ref_size=(1024,1535)
    _draw_reference_page(c,PAGE1_REFERENCE,w,h)

    # The reference contains example personal data. Hide ONLY those fields.
    # Borders, cosmic texture, ornaments and approved composition stay untouched.
    for box in [
        (292,326,520,603),     # data values column
        (62,833,505,1099),     # Senin Yolun body
        (62,1191,505,1394),    # Sinerji body
        (188,1450,846,1493),   # motto/footer text
    ]:
        _ref_box(c,ref_size,w,h,*box,fill=Color(.008,.014,.016,alpha=1.0),radius=2)

    # Reference art is Mustafa's approved Aslan/Balık pair. For other pairs,
    # sanitize the example medallions and rebuild them from packaged zodiac assets.
    approved_pair=(data["asc_sign"]=="Aslan" and data["sun_sign"]=="Balık")
    if not approved_pair:
        for box in [
            (650,430,1010,910),   # ASC label + medallion
            (635,930,1010,1385),  # Sun label + medallion
        ]:
            _ref_box(c,ref_size,w,h,*box,fill=Color(.004,.012,.014,alpha=1.0),radius=6)

    # Birth data — same coordinates and typographic hierarchy as reference.
    values=[
        _human_date_tr(prof["birth_date"]),
        str(prof["birth_time"]),
        str(prof["birth_place"]),
        _human_date_tr(prof["report_date"]),
    ]
    value_x,value_ys=310,[361,431,501,568]
    for value,yy in zip(values,value_ys):
        x,y=_ref_xy(ref_size,w,h,value_x,yy)
        c.setFillColor(PALE_GOLD); c.setFont("GMSerif",13.3)
        c.drawString(x,y,value)

    # Senin Yolun
    st=data.get("senin_yolun","")
    if isinstance(st,list): st=" ".join(st)
    x,y=_ref_xy(ref_size,w,h,65,858)
    _fit_text(c,st,x,y,415/ref_size[0]*w,font="GMSerif",size=13.0,leading=18.0,max_lines=10,color=INK)

    # Güneş + Yükselen sinerjisi
    syn=data.get("synergy_text","")
    if isinstance(syn,list): syn=" ".join(syn)
    x,y=_ref_xy(ref_size,w,h,65,1217)
    _fit_text(c,syn,x,y,415/ref_size[0]*w,font="GMSerifItalic",size=12.6,leading=18.5,max_lines=8,color=INK)

    if not approved_pair:
        # Dynamic premium medallions for any other sign pair.
        ax,ay=_ref_xy(ref_size,w,h,790,695)
        sx,sy=_ref_xy(ref_size,w,h,785,1163)
        ar=124/ref_size[0]*w
        sr=124/ref_size[0]*w
        _draw_premium_zodiac_medallion(c,data["asc_sign"],ax,ay,ar,"gold")
        _draw_premium_zodiac_medallion(c,data["sun_sign"],sx,sy,sr,"blue")

        # Labels
        for label,sign,xx,yy in [
            ("YÜKSELEN",data["asc_sign"],790,466),
            ("GÜNEŞ",data["sun_sign"],785,952),
        ]:
            x,y=_ref_xy(ref_size,w,h,xx,yy)
            c.setFillColor(GOLD); c.setFont("GMSerifBold",15)
            c.drawCentredString(x,y,label)
            c.setFont("GMSerifBold",30)
            c.drawCentredString(x,y-29,sign.upper())

    motto=str(data.get("motto","") or "")
    if motto:
        x,y=_ref_xy(ref_size,w,h,512,1478)
        c.setFillColor(PALE_GOLD); c.setFont("GMSerifBold",10.4)
        c.drawCentredString(x,y,motto)


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
    """Page 2: canonical style background with all sample-data zones sanitized."""
    prof=data["profile"]
    ref_size=(1055,1491)
    _draw_reference_page(c,PAGE2_REFERENCE,w,h)

    # Hide the reference's example chart/tables while preserving frame, title,
    # outer galaxy texture and decorative composition.
    _ref_box(c,ref_size,w,h,22,205,702,1375,fill=Color(.003,.012,.014,alpha=1.0),radius=5)
    _ref_box(c,ref_size,w,h,704,210,1030,1332,fill=Color(.003,.012,.014,alpha=1.0),radius=5)

    # Return subtle texture to the sanitized zones without reintroducing sample data.
    _stars_region(c,f"{prof.get('name','')}|{prof['birth_date']}|p2-left",14,90,w*.64,h*.68,190)
    _stars_region(c,f"{prof.get('name','')}|{prof['birth_date']}|p2-right",w*.675,95,w*.30,h*.69,90)

    cx=w*.34; cy=h*.50; R=w*.25

    # Decorative wheel halo closer to the canonical reference.
    c.saveState()
    for rr,alpha,lw in [(R*1.10,.14,9),(R*1.04,.30,4),(R,.90,1.0)]:
        try: c.setStrokeAlpha(alpha)
        except Exception: pass
        c.setStrokeColor(GOLD); c.setLineWidth(lw); c.circle(cx,cy,rr,stroke=1,fill=0)
    try: c.setStrokeAlpha(1)
    except Exception: pass
    c.restoreState()
    _draw_wheel(c,data,cx,cy,R)

    # Dynamic badges around the wheel.
    priority=["Güneş","MC","Merkür","Venüs","Mars","Satürn","Plüton","Jüpiter","Ay","ASC Yükselen","Yükselen"]
    selected=[]
    for k in priority:
        p=next((q for q in data["placements"] if q["body"]==k),None)
        if p and p not in selected: selected.append(p)
        if len(selected)>=10: break
    slots=[(55,h*.70),(w*.33,h*.79),(w*.51,h*.70),(w*.58,h*.54),(w*.54,h*.39),(w*.43,h*.26),(w*.31,h*.19),(w*.17,h*.22),(55,h*.37),(55,h*.55)]
    for p,(x,y) in zip(selected,slots):
        side="left" if x>w*.48 else "right"
        _badge(c,p,x,y,50,label_side=side)

    # Right-side live tables.
    tx=w*.68; tw=w*.29; top=h*.76
    c.setFillColor(Color(.003,.012,.014,alpha=.82))
    c.setStrokeColor(GOLD); c.setLineWidth(.8); c.roundRect(tx,top-230,tw,230,6,stroke=1,fill=1)
    c.setFillColor(GOLD); c.setFont("GMSerifBold",12); c.drawCentredString(tx+tw/2,top-18,"NATAL YERLEŞİMLER")
    col_body=tx+8; col_sign=tx+tw*.43; col_deg=tx+tw*.69; col_house=tx+tw*.92
    c.setFont("GMSerifBold",6.7); c.drawString(col_body,top-38,"GÖSTERGE"); c.drawString(col_sign,top-38,"BURÇ"); c.drawString(col_deg,top-38,"DERECE"); c.drawString(col_house,top-38,"EV")
    rows=data["placements"][:10]
    yy=top-54; c.setFont("GMSerif",7.0); c.setFillColor(INK)
    label_map={"Kuzey Ay Düğümü":"Kuzey Düğüm","ASC Yükselen":"ASC Yükselen"}
    for p in rows:
        body=label_map.get(p["body"],p["body"])[:15]
        deg=str(p["degree"])[:9]
        c.drawString(col_body,yy,body); c.drawString(col_sign,yy,p["sign"]); c.drawString(col_deg,yy,deg); c.drawString(col_house,yy,str(p.get("house","")))
        yy-=16

    at=top-255; ah=210
    c.setFillColor(Color(.003,.012,.014,alpha=.82))
    c.setStrokeColor(GOLD); c.roundRect(tx,at-ah,tw,ah,6,stroke=1,fill=1)
    c.setFillColor(GOLD); c.setFont("GMSerifBold",12); c.drawCentredString(tx+tw/2,at-18,"ANA AÇI DESENLERİ")
    c.setFont("GMSerifBold",7.2); c.drawString(tx+8,at-38,"AÇI"); c.drawString(tx+tw*.34,at-38,"GÖSTERGELER"); c.drawString(tx+tw*.84,at-38,"ORB")
    aspects=sorted(data.get("aspects",[]),key=lambda a:(-(a.get("strength") or 0),float(a.get("orb",99))))[:7]
    yy=at-55; c.setFont("GMSerif",7.6); c.setFillColor(INK)
    for a in aspects:
        c.drawString(tx+8,yy,str(a.get("type",""))[:12]); c.drawString(tx+tw*.34,yy,f"{a.get('a','')} - {a.get('b','')}"[:28]); c.drawString(tx+tw*.85,yy,f"{a.get('orb','')}°")
        yy-=18

    st=at-ah-24; sh=88
    c.setFillColor(Color(.003,.012,.014,alpha=.82))
    c.setStrokeColor(GOLD); c.roundRect(tx,st-sh,tw,sh,6,stroke=1,fill=1)
    c.setFillColor(GOLD); c.setFont("GMSerifBold",11); c.drawCentredString(tx+tw/2,st-18,"AÇI GÜÇLERİ")
    strengths=[float(a["strength"]) for a in data.get("aspects",[]) if a.get("strength") is not None]
    if strengths:
        avg=sum(strengths)/len(strengths); x0=tx+12; y0=st-52; barw=tw-24
        c.setFillColor(HexColor("#1d4d6a")); c.rect(x0,y0,barw,10,fill=1,stroke=0)
        c.setFillColor(HexColor("#f5a13a")); c.rect(x0,y0,barw*max(0,min(1,avg)),10,fill=1,stroke=0)
        c.setFont("GMSerif",7); c.setFillColor(INK); c.drawString(x0,y0-12,"ZAYIF"); c.drawRightString(x0+barw,y0-12,"GÜÇLÜ")
    else:
        c.setFont("GMSerifItalic",7.5); c.setFillColor(MUTED); c.drawCentredString(tx+tw/2,st-53,"Doğrulanmış güç verisi yoksa ölçek üretilmez.")
    c.setFillColor(GOLD); c.setFont("GMSerif",9); c.drawCentredString(w/2,20,"GrandMastrolog Özel Danışmanlık Raporu")


def _page3(c,data,w,h) -> None:
    # Page 3 uses the report-only element composition. Opening/chat and PDF
    # references are intentionally separate canonical assets.
    with tempfile.TemporaryDirectory(prefix="gmv17_page3_") as td:
        png=Path(td)/"elements_report.png"
        render_elements_report(data,str(png))
        im=Image.open(png)
        iw,ih=im.size
        scale=min(w/iw,h/ih)
        dw,dh=iw*scale,ih*scale
        c.setFillColor(DARK); c.rect(0,0,w,h,fill=1,stroke=0)
        c.drawImage(ImageReader(im), (w-dw)/2, (h-dh)/2, dw, dh, mask='auto')

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
