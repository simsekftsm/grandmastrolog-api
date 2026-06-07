import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pg from 'pg';
import Groq from 'groq-sdk';

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 3000;
const GM_API_SECRET = process.env.GM_API_SECRET || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    })
  : null;

const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null;

function requireSecret(req, res, next) {
  if (!GM_API_SECRET) {
    return res.status(500).json({ ok: false, error: 'GM_API_SECRET is not configured.' });
  }

  const incoming = req.header('x-gm-secret');

  if (incoming !== GM_API_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: invalid x-gm-secret.' });
  }

  next();
}

async function initDb() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gm_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS gm_feedback (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      message TEXT NOT NULL,
      category TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS gm_memory (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    INSERT INTO gm_settings (key, value)
    VALUES ('learning_enabled', 'true')
    ON CONFLICT (key) DO NOTHING;
  `);
}

async function getSetting(key, fallback) {
  if (!pool) return fallback;

  const result = await pool.query(
    'SELECT value FROM gm_settings WHERE key=$1',
    [key]
  );

  return result.rows[0]?.value ?? fallback;
}

async function setSetting(key, value) {
  if (!pool) throw new Error('DATABASE_URL is not configured.');

  await pool.query(`
    INSERT INTO gm_settings (key, value, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()
  `, [key, value]);
}

async function addMemory({ user_id = 'default', type, content }) {
  if (!pool) throw new Error('DATABASE_URL is not configured.');

  const result = await pool.query(
    `
    INSERT INTO gm_memory (user_id, type, content)
    VALUES ($1, $2, $3)
    RETURNING id, user_id, type, content, enabled, created_at
    `,
    [user_id, type, content]
  );

  return result.rows[0];
}

async function getMemories(user_id = 'default') {
  if (!pool) return [];

  const result = await pool.query(
    `
    SELECT id, user_id, type, content, enabled, created_at
    FROM gm_memory
    WHERE user_id=$1 AND enabled=true
    ORDER BY created_at DESC, id DESC
    LIMIT 30
    `,
    [user_id]
  );

  return result.rows;
}

async function summarizeFeedbackWithGroq({ feedback, user_id = 'default' }) {
  if (!groq) {
    return `Aktif oturum geri bildirimi: ${feedback}`;
  }

  const memories = await getMemories(user_id);
  const memoryText = memories.map(m => `- [${m.type}] ${m.content}`).join('\n');

  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    temperature: 0.2,
    max_tokens: 400,
    messages: [
      {
        role: 'system',
        content: `Sen GrandMastrolog öğrenme özetleyicisisin. Görevin kullanıcı geri bildiriminden kısa, uygulanabilir, güvenli bir aktif oturum kalibrasyon notu çıkarmaktır.

Kurallar:
- Kalıcı öğrenme veya ASI iddiası kurma.
- Doğum verisi, sağlık, hukuk, finans veya hassas kişisel veriyi gereksiz saklama.
- Sadece dil, üslup, tekrar, nokta atışlılık, teknik detay seviyesi, kullanıcı tercihi ve hata onarımı gibi güvenli çalışma notlarını özetle.
- Çıktı tek paragraf ve 700 karakterden kısa olsun.`
      },
      {
        role: 'user',
        content: `Mevcut aktif notlar:
${memoryText || 'Yok'}

Yeni geri bildirim:
${feedback}

Bunu tek kısa aktif kalibrasyon notuna dönüştür.`
      }
    ]
  });

  return completion.choices?.[0]?.message?.content?.trim()
    || `Aktif oturum geri bildirimi: ${feedback}`;
}

app.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    service: 'grandmastrolog-api',
    db: Boolean(pool),
    groq: Boolean(groq)
  });
});

app.get('/learning/status', requireSecret, async (_req, res) => {
  const enabled = (await getSetting('learning_enabled', 'true')) === 'true';

  res.json({
    ok: true,
    learning_enabled: enabled
  });
});

app.post('/learning/pause', requireSecret, async (_req, res) => {
  await setSetting('learning_enabled', 'false');

  res.json({
    ok: true,
    learning_enabled: false,
    message: 'Learning paused.'
  });
});

app.post('/learning/resume', requireSecret, async (_req, res) => {
  await setSetting('learning_enabled', 'true');

  res.json({
    ok: true,
    learning_enabled: true,
    message: 'Learning resumed.'
  });
});

app.get('/context', requireSecret, async (req, res) => {
  if (!pool) {
    return res.status(500).json({
      ok: false,
      error: 'DATABASE_URL is not configured.'
    });
  }

  const user_id = String(req.query.user_id || 'default');

  const limitRaw = Number(req.query.limit || 20);
  const offsetRaw = Number(req.query.offset || 0);

  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 20, 1), 50);
  const offset = Math.max(Number.isFinite(offsetRaw) ? offsetRaw : 0, 0);

  const enabledOnly = String(req.query.enabled_only ?? 'true') !== 'false';
  const summaryOnly = String(req.query.summary_only ?? 'true') !== 'false';
  const typeFilter = req.query.type ? String(req.query.type) : null;

  const enabled = (await getSetting('learning_enabled', 'true')) === 'true';

  if (!enabled) {
    return res.json({
      ok: true,
      learning_enabled: false,
      user_id,
      limit,
      offset,
      count: 0,
      total: 0,
      has_more: false,
      next_offset: null,
      gm_runtime_context: 'Öğrenme modu kapalı veya kayıtlı aktif kalibrasyon yok. Ana GM promptu aynen uygulanır.',
      memories: []
    });
  }

  const where = ['user_id = $1'];
  const params = [user_id];

  if (enabledOnly) {
    params.push(true);
    where.push(`enabled = $${params.length}`);
  }

  if (typeFilter) {
    params.push(typeFilter);
    where.push(`type = $${params.length}`);
  }

  const whereSql = where.join(' AND ');

  const totalResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM gm_memory WHERE ${whereSql}`,
    params
  );

  const total = Number(totalResult.rows[0]?.total || 0);

  const pageParams = [...params, limit, offset];

  const pageResult = await pool.query(
    `
    SELECT id, user_id, type, content, enabled, created_at
    FROM gm_memory
    WHERE ${whereSql}
    ORDER BY created_at DESC, id DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    pageParams
  );

  const memories = pageResult.rows.map(m => {
    const content = String(m.content || '');

    const base = {
      id: String(m.id),
      user_id: String(m.user_id || user_id),
      type: String(m.type || 'manual'),
      enabled: m.enabled !== false,
      created_at: m.created_at || null
    };

    if (summaryOnly) {
      base.content_preview = content.slice(0, 300);
    } else {
      base.content = content.slice(0, 2000);
    }

    return base;
  });

  const instruction = memories.length
    ? memories
        .map(m => `- [${m.id}] ${m.type}: ${m.content_preview || m.content || ''}`)
        .join('\n')
        .slice(0, 3000)
    : 'Öğrenme modu kapalı veya kayıtlı aktif kalibrasyon yok. Ana GM promptu aynen uygulanır.';

  res.json({
    ok: true,
    learning_enabled: enabled,
    user_id,
    limit,
    offset,
    count: memories.length,
    total,
    has_more: offset + memories.length < total,
    next_offset: offset + memories.length < total ? offset + memories.length : null,
    gm_runtime_context: instruction,
    memories
  });
});

app.post('/feedback', requireSecret, async (req, res) => {
  const { user_id = 'default', message, category = 'general' } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({
      ok: false,
      error: 'message is required.'
    });
  }

  if (!pool) {
    return res.status(500).json({
      ok: false,
      error: 'DATABASE_URL is not configured.'
    });
  }

  await pool.query(
    'INSERT INTO gm_feedback (user_id, message, category) VALUES ($1, $2, $3)',
    [user_id, message, category]
  );

  const enabled = (await getSetting('learning_enabled', 'true')) === 'true';

  if (!enabled) {
    return res.json({
      ok: true,
      learning_enabled: false,
      stored_feedback: true,
      learned: false
    });
  }

  const summary = await summarizeFeedbackWithGroq({ feedback: message, user_id });
  const memory = await addMemory({
    user_id,
    type: `feedback:${category}`,
    content: summary
  });

  res.json({
    ok: true,
    learning_enabled: true,
    stored_feedback: true,
    learned: true,
    memory
  });
});

app.post('/learn', requireSecret, async (req, res) => {
  const { user_id = 'default', type = 'manual', content } = req.body || {};

  if (!content || typeof content !== 'string') {
    return res.status(400).json({
      ok: false,
      error: 'content is required.'
    });
  }

  const enabled = (await getSetting('learning_enabled', 'true')) === 'true';

  if (!enabled) {
    return res.json({
      ok: true,
      learning_enabled: false,
      learned: false,
      message: 'Learning is paused.'
    });
  }

  const memory = await addMemory({ user_id, type, content });

  res.json({
    ok: true,
    learning_enabled: true,
    learned: true,
    memory
  });
});

app.delete('/memory/:id', requireSecret, async (req, res) => {
  if (!pool) {
    return res.status(500).json({
      ok: false,
      error: 'DATABASE_URL is not configured.'
    });
  }

  await pool.query(
    'UPDATE gm_memory SET enabled=false WHERE id::text=$1',
    [String(req.params.id)]
  );

  res.json({
    ok: true,
    disabled_memory_id: String(req.params.id)
  });
});

app.post('/memory/bulk-disable', requireSecret, async (req, res) => {
  if (!pool) {
    return res.status(500).json({
      ok: false,
      error: 'DATABASE_URL is not configured.'
    });
  }

  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map(id => String(id).trim()).filter(Boolean)
      : [];

    const uniqueIds = [...new Set(ids)];

    if (!uniqueIds.length) {
      return res.status(400).json({
        ok: false,
        error: 'ids array is required.'
      });
    }

    const result = await pool.query(
      'UPDATE gm_memory SET enabled=false WHERE id::text = ANY($1::text[]) RETURNING id',
      [uniqueIds]
    );

    const disabled_ids = result.rows.map(row => String(row.id));
    const not_found_ids = uniqueIds.filter(id => !disabled_ids.includes(id));

    return res.json({
      ok: true,
      requested_count: uniqueIds.length,
      disabled_count: disabled_ids.length,
      disabled_ids,
      not_found_ids
    });
  } catch (err) {
    console.error('bulk-disable error:', err);

    return res.status(500).json({
      ok: false,
      error: 'Bulk disable failed.',
      detail: err.message
    });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`GrandMastrolog API running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
