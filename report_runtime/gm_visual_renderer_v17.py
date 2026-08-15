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

SIGNS = ["Koç","Boğa","İkizler","Yengeç","Aslan","Başak","Terazi","Akrep","Yay","Oğlak","Kova","Balık"]
SIGN_GLYPHS = {"Koç":"♈","Boğa":"♉","İkizler":"♊","Yengeç":"♋","Aslan":"♌","Başak":"♍","Terazi":"♎","Akrep":"♏","Yay":"♐","Oğlak":"♑","Kova":"♒","Balık":"♓"}
BODY_GLYPHS = {"Güneş":"☉","Ay":"☽","Merkür":"☿","Venüs":"♀","Mars":"♂","Jüpiter":"♃","Satürn":"♄","Uranüs":"♅","Neptün":"♆","Plüton":"♇","Kuzey Ay Düğümü":"☊","ASC Yükselen":"ASC","Yükselen":"ASC","MC":"MC"}
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


def validate(data: dict[str,Any], for_pdf: bool=True) -> None:
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
    """PDF page-3 visual locked to 4_element_report.png composition family."""
    validate(data, for_pdf=False)
    vals,scales=_element_payload(data)
    W,H=_reference_size(REPORT_ELEMENT_REFERENCE,(1085,1450))
    bg=(3,10,12,255); gold=(217,165,45,255); pale=(246,215,145,255)
    im=Image.new("RGBA",(W,H),bg)
    prof=data.get("profile",{})
    seed=f"{prof.get('name','')}|{prof.get('birth_date','')}|elements|report"
    d=_draw_cosmic_background(im,seed,star_count=1200)
    _draw_frame(d,W,H)

    fsmall=_font_pil(27,True); ftitle=_font_pil(52,False); fsub=_font_pil(27,False)
    top="GRANDMASTROLOG ELEMENT ANALİZİ"
    bb=d.textbbox((0,0),top,font=fsmall); d.text(((W-(bb[2]-bb[0]))/2,58),top,font=fsmall,fill=gold)
    title="4 ELEMENT DAĞILIMI"; bb=d.textbbox((0,0),title,font=ftitle)
    d.text(((W-(bb[2]-bb[0]))/2,112),title,font=ftitle,fill=pale)
    sub="Doğum haritandaki element dengesinin görselleştirilmiş özeti"; bb=d.textbbox((0,0),sub,font=fsub)
    d.text(((W-(bb[2]-bb[0]))/2,186),sub,font=fsub,fill=(235,204,133,240))
    d.line((250,235,W-250,235),fill=(217,165,45,170),width=2)

    cx,cy=W/2,760; R=410
    for rradius,alpha,wid in [(R,220,2),(R-18,150,1),(R-75,120,1),(R-160,105,1)]:
        d.ellipse((cx-rradius,cy-rradius,cx+rradius,cy+rradius),outline=(217,165,45,alpha),width=wid)
    symfont=_font_symbol_pil(30)
    for i,s in enumerate(SIGNS):
        a=math.radians(-90+i*30)
        x1=cx+(R-18)*math.cos(a); y1=cy+(R-18)*math.sin(a)
        x2=cx+R*math.cos(a); y2=cy+R*math.sin(a)
        d.line((x1,y1,x2,y2),fill=(217,165,45,130),width=1)
        a2=math.radians(-75+i*30); tx=cx+(R-43)*math.cos(a2); ty=cy+(R-43)*math.sin(a2)
        g=SIGN_GLYPHS[s]; bb=d.textbbox((0,0),g,font=symfont)
        d.text((tx-(bb[2]-bb[0])/2,ty-(bb[3]-bb[1])/2),g,font=symfont,fill=(226,177,54,225))

    pos={"Ateş":(cx,455),"Toprak":(205,790),"Hava":(W-205,790),"Su":(cx,1085)}
    base={"Ateş":286,"Toprak":282,"Hava":282,"Su":260}
    for k in ELEMENT_KEYS:
        target=int(base[k]*scales[k])
        _paste_element_art(im,k,pos[k],target,silver_air=True)

    label_colors={"Ateş":(255,132,18,255),"Toprak":(197,221,28,255),"Hava":(205,226,238,255),"Su":(150,216,255,255)}
    label_pos={"Ateş":(cx,210),"Toprak":(128,610),"Hava":(W-128,610),"Su":(cx,1222)}
    f_lab=_font_pil(31,True); f_pct=_font_pil(40,False)
    for k in ELEMENT_KEYS:
        x,y=label_pos[k]
        for j,t in enumerate((k.upper(),f"%{vals[k]:g}")):
            f=f_lab if j==0 else f_pct; bb=d.textbbox((0,0),t,font=f)
            d.text((x-(bb[2]-bb[0])/2,y+j*38),t,font=f,fill=label_colors[k])

    cr=178
    d.ellipse((cx-cr,cy-cr,cx+cr,cy+cr),fill=(2,11,13,244),outline=gold,width=3)
    d.ellipse((cx-cr+10,cy-cr+10,cx+cr-10,cy+cr-10),outline=(238,199,98,125),width=1)
    ft=_font_pil(25,True); t="4 ELEMENT DAĞILIMI"; bb=d.textbbox((0,0),t,font=ft)
    d.text((cx-(bb[2]-bb[0])/2,cy-cr+42),t,font=ft,fill=pale)
    d.line((cx-112,cy-cr+80,cx+112,cy-cr+80),fill=(217,165,45,125),width=1)
    fy=cy-cr+105; fr=_font_pil(26,False); fp=_font_pil(27,True)
    for k in ELEMENT_KEYS:
        d.text((cx-118,fy),k.upper(),font=fr,fill=label_colors[k])
        pct=f"%{vals[k]:g}"; bb=d.textbbox((0,0),pct,font=fp)
        d.text((cx+116-(bb[2]-bb[0]),fy),pct,font=fp,fill=pale)
        fy+=50

    bx1,bx2=120,W-120; by1,by2=1310,1391
    d.rounded_rectangle((bx1,by1,bx2,by2),radius=16,fill=(3,12,14,230),outline=gold,width=2)
    footer="Elementlerin oranı, doğum haritandaki doğal enerjilerin nasıl dağıldığını gösterir."
    ff=_font_pil(22,False); bb=d.textbbox((0,0),footer,font=ff)
    d.text(((W-(bb[2]-bb[0]))/2,by1+27),footer,font=ff,fill=(235,207,151,255))
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


def _page1(c,data,w,h):
    prof=data["profile"]; seed=f"{prof.get('name','')}{prof['birth_date']}p1"
    _stars(c,seed,w,h,520); _ornate_border(c,w,h)
    c.setFillColor(GOLD); c.setFont("GMSerifBold",11); c.drawCentredString(w/2,h-34,"ŞAHSİ GRANDMASTROLOG  |  DOĞUM HARİTASI RAPORU")
    c.setFont("GMSerifBold",27); c.drawString(34,h-92,"ŞAHSİ")
    c.setFont("GMSerifBold",40); c.drawString(34,h-130,"GRANDMASTROLOG")
    c.setFont("GMSerifItalic",24); c.drawString(34,h-165,"Doğum Haritası Raporu")
    # data card
    x=34; y=h-205; bw=w*.47; rh=33
    c.setStrokeColor(GOLD); c.setLineWidth(.7); c.roundRect(x,y-rh*4,bw,rh*4,7,stroke=1,fill=0)
    rows=[("Doğum tarihi",prof["birth_date"]),("Doğum saati",prof["birth_time"]),("Doğum yeri",prof["birth_place"]),("Rapor tarihi",prof["report_date"])]
    c.setFont("GMSerif",12)
    for i,(k,v) in enumerate(rows):
        yy=y-rh*i-21; c.setFillColor(INK); c.drawString(x+12,yy,k); c.setFillColor(PALE_GOLD); c.drawString(x+bw*.53,yy,str(v))
        if i<3: c.setStrokeColor(Color(.85,.65,.2,alpha=.45)); c.line(x,y-rh*(i+1),x+bw,y-rh*(i+1))
    # text boxes
    boxy=y-rh*4-40; boxh=164
    c.setStrokeColor(GOLD); c.roundRect(34,boxy-boxh,bw,boxh,7,stroke=1,fill=0)
    c.setFillColor(GOLD); c.setFont("GMSerifBold",17); c.drawCentredString(34+bw/2,boxy-24,"SENİN YOLUN")
    st=data.get("senin_yolun","")
    if isinstance(st,list): st=" ".join(st)
    _fit_text(c,st,46,boxy-52,bw-24,size=12,leading=17,max_lines=6)
    syy=boxy-boxh-26; syh=155
    c.setStrokeColor(GOLD); c.roundRect(34,syy-syh,bw,syh,7,stroke=1,fill=0)
    title=f"{data['sun_sign'].upper()} + {data['asc_sign'].upper()} SİNERJİSİ"
    c.setFillColor(GOLD); c.setFont("GMSerifBold",15); c.drawCentredString(34+bw/2,syy-24,title)
    syn=data.get("synergy_text","")
    if isinstance(syn,list): syn=" ".join(syn)
    _fit_text(c,syn,46,syy-50,bw-24,font="GMSerifItalic",size=12,leading=18,max_lines=5)
    # right medallions
    rx=w*.68; imsz=132
    for label,sign,cyy in [("YÜKSELEN",data["asc_sign"],h*.59),("GÜNEŞ",data["sun_sign"],h*.29)]:
        c.setStrokeColor(GOLD); c.setLineWidth(1.0); c.circle(rx,cyy,imsz*.53,stroke=1,fill=0)
        c.drawImage(_zodiac_img(sign),rx-imsz/2,cyy-imsz/2,imsz,imsz,mask='auto')
        c.setFillColor(GOLD); c.setFont("GMSerifBold",13); c.drawCentredString(rx,cyy+imsz*.65,label)
        c.setFont("GMSerifBold",26); c.drawCentredString(rx,cyy+imsz*.48,sign.upper())
    motto=data.get("motto","")
    if motto:
        c.setStrokeColor(Color(.85,.65,.2,alpha=.55)); c.line(34,40,w-34,40)
        c.setFillColor(PALE_GOLD); c.setFont("GMSerifBold",10.5); c.drawCentredString(w/2,25,motto)


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
    sign=p["sign"]; c.setStrokeColor(GOLD); c.circle(x,y,sz*.52,stroke=1,fill=0)
    c.drawImage(_zodiac_img(sign),x-sz/2,y-sz/2,sz,sz,mask='auto')
    body=p["body"].replace("ASC Yükselen","YÜKSELEN").upper()
    txt=str(p.get("degree",""))
    if p.get("house") not in (None,""): txt+=f"  {p['house']}. Ev"
    c.setFillColor(INK)
    if label_side=="left":
        lx=x-sz*.62
        c.setFont("GMSerifBold",8.5); c.drawRightString(lx,y+12,body)
        c.setFont("GMSerif",8); c.drawRightString(lx,y-1,sign.upper()); c.drawRightString(lx,y-14,txt)
    else:
        lx=x+sz*.62
        c.setFont("GMSerifBold",8.5); c.drawString(lx,y+12,body)
        c.setFont("GMSerif",8); c.drawString(lx,y-1,sign.upper()); c.drawString(lx,y-14,txt)


def _page2(c,data,w,h):
    prof=data["profile"]; _stars(c,f"{prof.get('name','')}{prof['birth_date']}p2",w,h,650); _ornate_border(c,w,h)
    c.setFillColor(GOLD); c.setFont("GMSerifBold",11); c.drawCentredString(w/2,h-30,"ŞAHSİ GRANDMASTROLOG  |  DANIŞMANLIK RAPORU")
    c.setFont("GMSerifBold",29); c.drawString(34,h-78,"DOĞUM HARİTASI GÖRSELİ")
    c.setFont("GMSerifItalic",11); c.drawString(36,h-100,"Gezegenlerin burç yerleşimlerinin görselleştirilmiş sistemi")
    cx=w*.34; cy=h*.50; R=w*.25
    _draw_wheel(c,data,cx,cy,R)
    # dynamic badges around wheel
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
    # right tables
    tx=w*.68; tw=w*.29; top=h*.76
    c.setStrokeColor(GOLD); c.roundRect(tx,top-230,tw,230,6,stroke=1,fill=0)
    c.setFillColor(GOLD); c.setFont("GMSerifBold",12); c.drawCentredString(tx+tw/2,top-18,"NATAL YERLEŞİMLER")
    # Fixed column ownership: prevent long Turkish labels/degrees from colliding.
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
    c.setStrokeColor(GOLD); c.roundRect(tx,at-ah,tw,ah,6,stroke=1,fill=0); c.setFillColor(GOLD); c.setFont("GMSerifBold",12); c.drawCentredString(tx+tw/2,at-18,"ANA AÇI DESENLERİ")
    c.setFont("GMSerifBold",7.2); c.drawString(tx+8,at-38,"AÇI"); c.drawString(tx+tw*.34,at-38,"GÖSTERGELER"); c.drawString(tx+tw*.84,at-38,"ORB")
    aspects=sorted(data.get("aspects",[]),key=lambda a:(-(a.get("strength") or 0),float(a.get("orb",99))))[:7]
    yy=at-55; c.setFont("GMSerif",7.6); c.setFillColor(INK)
    for a in aspects:
        c.drawString(tx+8,yy,str(a.get("type",""))[:12]); c.drawString(tx+tw*.34,yy,f"{a.get('a','')} - {a.get('b','')}"[:28]); c.drawString(tx+tw*.85,yy,f"{a.get('orb','')}°")
        yy-=18
    # strength panel only if supplied
    st=at-ah-24; sh=88
    c.setStrokeColor(GOLD); c.roundRect(tx,st-sh,tw,sh,6,stroke=1,fill=0); c.setFillColor(GOLD); c.setFont("GMSerifBold",11); c.drawCentredString(tx+tw/2,st-18,"AÇI GÜÇLERİ")
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
