# PDF CANONICAL ENTRYPOINT

GrandMastrolog üç sayfalık Doğum Haritası PDF'si için yalnız şu komutu/işlevi kullanır:

`python report_runtime/gm_visual_renderer_v17.py pdf <verified_input.json> <output.pdf>`

Girdi yalnız oturum kullanıcısı + doğrulanmış ASTRO DATA'dan oluşturulur. Renderer astroloji hesaplamaz.

## HARD RED
- web_search / browser / internet asset lookup,
- başka PDF generator ile hızlı ikame,
- düz beyaz tablo raporu,
- referans rapor PNG'sini statik background yapma,
- örnek kullanıcı değerlerini input'a kopyalama.

Renderer veya gerekli asset erişilemiyorsa PDF üretme. `PDF_RUNTIME_UNAVAILABLE` iç statüsüyle fail-closed ol; kullanıcıya teknik proses dökmeden Yıllık akışına devam et.
