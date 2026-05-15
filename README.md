# GrandMastrolog API

Kontrollü öğrenme / geri bildirim hafızası API'si.

Bu API şunu yapar:
- Öğrenme modunu açar/kapatır.
- Kullanıcı geri bildirimlerini kaydeder.
- Groq ile kısa aktif kalibrasyon notuna dönüştürür.
- ChatGPT Custom GPT veya başka AI istemcilerine `/context` endpoint'iyle güncel bağlam verir.

Bu API şunu yapmaz:
- Gerçek ASI olmaz.
- Ana GM promptunu kendi başına değiştirmez.
- Doğum verisini önceki oturumdan otomatik astrolojik hüküm kaynağı yapmaz.

## Railway Variables

Railway > Variables alanına şunları ekle:

```txt
GROQ_API_KEY=Groq API key
GROQ_MODEL=llama-3.3-70b-versatile
GM_API_SECRET=kendi-uzun-gizli-sifren
NODE_ENV=production
DATABASE_URL=Railway Postgres otomatik verir
```

## Endpoints

- `GET /health`
- `GET /context?user_id=default`
- `POST /feedback`
- `POST /learn`
- `POST /learning/pause`
- `POST /learning/resume`
- `GET /learning/status`
- `DELETE /memory/:id`

Protected endpoint'ler header ister:

```txt
x-gm-secret: GM_API_SECRET
```
