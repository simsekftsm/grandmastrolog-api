# GrandMastrolog v17 — Dinamik Görsel ve 3 Sayfalık PDF Renderer Sözleşmesi

## Amaç
Bu katman astroloji hesaplamaz. Yalnız kabul edilmiş ASTRO DATA çıktısını, kullanıcıya ait doğrulanmış profil verisini ve o oturumda üretilmiş kişisel metni görselleştirir.

Kullanıcının sağladığı Sayfa 1 / Sayfa 2 görselleri, açılım içi `4_element_opening.png` ve PDF Sayfa 3 için `4_element_report.png` dosyaları `report_runtime/reference/` altında kanonik tasarım/layout referansıdır. İçlerindeki örnek kişi, tarih, derece, ev, açı, yüzde ve metin hiçbir koşulda runtime verisi değildir.

## Çalıştırma

```bash
python report_runtime/gm_visual_renderer_v17.py elements report_input.json element_panel.png
python report_runtime/gm_visual_renderer_v17.py pdf report_input.json grandmastrolog_report.pdf
```

`elements` komutu açılım içi `4_element_opening.png` tasarım ailesini; `pdf` komutunun üçüncü sayfası `4_element_report.png` tasarım ailesini kullanır.

Custom GPT/Code Interpreter ortamında dosya yolu farklıysa aynı script içerik olarak yürütülebilir. Script bulunamadığında model görsel/PDF üretimini başarmış gibi gösteremez.

## Minimum veri şeması

```json
{
  "profile": {
    "name": "isteğe bağlı",
    "birth_date": "dinamik",
    "birth_time": "dinamik",
    "birth_place": "dinamik",
    "report_date": "dinamik"
  },
  "sun_sign": "Koç|Boğa|İkizler|Yengeç|Aslan|Başak|Terazi|Akrep|Yay|Oğlak|Kova|Balık",
  "asc_sign": "...",
  "senin_yolun": "oturuma özel metin",
  "synergy_text": "oturuma özel gerçek sinerji",
  "motto": "tek kişisel mühür cümlesi",
  "elements": {
    "status": "calculated",
    "policy_id": "gm_elements_v17_1",
    "percent": {"fire": 25, "earth": 25, "air": 25, "water": 25},
    "visual_scale": {"fire": 1.0, "earth": 1.0, "air": 1.0, "water": 1.0}
  },
  "house_cusps": [0.0, 30.0, "... toplam 12 doğrulanmış longitude"],
  "placements": [
    {
      "body": "Güneş",
      "sign": "Koç",
      "degree": "10°00′",
      "house": 1,
      "longitude": 10.0,
      "retrograde": false
    }
  ],
  "aspects": [
    {
      "type": "Kavuşum|Karşıtlık|Kare|Üçgen|Sekstil",
      "a": "Güneş",
      "b": "Merkür",
      "orb": 2.4,
      "strength": 0.76
    }
  ]
}
```

`house_cusps`, `longitude`, `aspects`, `strength` değerleri renderer tarafından hesaplanmaz. ASTRO DATA sağlamıyorsa ilgili dinamik görsel alan fail-closed olur. Özellikle `strength` yoksa Açı Güçleri için sahte skor üretilmez.

## Sayfa 1
- koyu kozmik arka plan + altın çerçeve;
- doğum tarihi/saat/yer/rapor tarihi dinamik;
- yükselen ve Güneş burcu kanonik 12 asset içinden seçilir;
- `Senin Yolun` dinamik;
- başlık `<Güneş> + <Yükselen> Sinerjisi` dinamik;
- sinerji iki burcu ayrı ayrı anlatan metin değildir;
- motto dinamik ve tek kişisel cümledir.

## Sayfa 2
- koyu kozmik arka plan + altın çerçeve;
- natal wheel gerçek ekliptik boylam ve doğrulanmış house cusp verisinden çizilir;
- gerçek aspect listesi wheel üzerinde çizilir;
- çevresel burç medalyonları 12 kanonik asset içinden dinamik seçilir;
- Natal Yerleşimler tablosu ASTRO DATA’dan;
- Ana Açı Desenleri gerçek majör açılardan;
- Açı Güçleri yalnız doğrulanmış `strength` verisi varsa.

## Açılım içi 4 Element görseli
Sohbet/açılım sırasında `4_element_opening.png` kanonik tasarım ailesi kullanılır. Runtime çıktısı 1254x1254 kare kompozisyondur. Dört element medalyonu mevcut şeffaf assetlerden çizilir; oranlar ve büyüklükler yalnız ASTRO DATA `elements.percent` ve `elements.visual_scale` alanlarından gelir. Referans görseldeki örnek yüzdeler okunmaz.

## Sayfa 3 — 4 Element görseli
Raporun üçüncü sayfası yalnız `4_element_report.png` tasarım ailesini kullanır. Runtime çıktısı referansın 1085x1450 dikey kompozisyonunu korur ve doğrulanmış `elements` paketiyle dinamik üretilir. Hava medalyonu kaynak asset değiştirilmeden yalnız rapor sayfası için in-memory silver görünümde türetilir.

Görsel büyüklüğü API'nin `gm_elements_v17_1` politikasıyla ürettiği `visual_scale` değerini kullanır; renderer yüzdeyi yeniden hesaplamaz. `visual_scale` yoksa yalnız geriye dönük sentetik test uyumluluğu için aynı kanonik bounded formül uygulanabilir. En yüksek oran en büyük, en düşük oran en küçük medalyon olarak görünür; konum, çizim ailesi ve renk ailesi korunur.

## Kanonik burç assetleri
`report_runtime/assets/zodiac/` altındaki 12 dosya kullanıcı tarafından sağlanan `burclar_500x500` paketinden byte-exact alınmıştır; Türkçe dosya adları UTF-8 olarak korunur. Runtime’da başka bir burç ikon stiliyle karıştırılmaz.

## Sızıntı yasağı
- Sayfa referansları raster background olarak kullanılmaz.
- Örnek natal wheel yeni rapora taşınmaz.
- Örnek kişi adı/tarih/yer/derece/ev/açı/metin/yüzde runtime default değildir.
- Eksik veri uydurulmaz.

## Canlı kabul
Paket içi renderer smoke testinde iki farklı kullanıcı için 3 sayfalık rapor üretilir; Sayfa 1/2 önceki renderer çıktısıyla piksel-regresyon açısından korunur, Sayfa 3 dinamik farklılaşır. Custom GPT Builder Preview + Code Interpreter + gerçek ASTRO DATA ile doğrulanmadan canlı runtime PASS verilemez.
