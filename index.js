import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pg from 'pg';
import Groq from 'groq-sdk';
import { createRequire } from 'module';
import { DateTime } from 'luxon';

const require = createRequire(import.meta.url);
const swisseph = require('swisseph');

swisseph.swe_set_ephe_path('./ephe');
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
  let swissephOk = false;
  let swissephSunDegree = null;
  let swissephError = null;

  try {
    const jd = swisseph.swe_julday(1990, 3, 10, 13.5, swisseph.SE_GREG_CAL);
    const flag = swisseph.SEFLG_SPEED | swisseph.SEFLG_MOSEPH;

    const sun = swisseph.swe_calc_ut(jd, swisseph.SE_SUN, flag);

    if (!sun?.error) {
      swissephOk = true;
      swissephSunDegree = Array.isArray(sun) ? sun[0] : (sun.longitude ?? sun[0] ?? null);
    } else {
      swissephError = sun.error;
    }
  } catch (err) {
    swissephError = err.message;
  }

  res.json({
    ok: true,
    service: 'grandmastrolog-api',
    db: Boolean(pool),
    groq: Boolean(groq),
    swisseph: {
      ok: swissephOk,
      sun_degree_test: swissephSunDegree,
      error: swissephError
    }
  });
});
const SIGN_NAMES = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'
];

const ASPECTS = [
  { name: 'Conjunction', angle: 0, orb: 2.0 },
  { name: 'Opposition', angle: 180, orb: 2.0 },
  { name: 'Square', angle: 90, orb: 1.8 },
  { name: 'Trine', angle: 120, orb: 1.5 },
  { name: 'Sextile', angle: 60, orb: 1.2 }
];

const ASTEROID_POINTS = [
  { name: 'Chiron', id: swisseph.SE_CHIRON },
  { name: 'Ceres', id: swisseph.SE_CERES },
  { name: 'Pallas', id: swisseph.SE_PALLAS },
  { name: 'Juno', id: swisseph.SE_JUNO },
  { name: 'Vesta', id: swisseph.SE_VESTA },
  { name: 'Lilith', id: swisseph.SE_MEAN_APOG }
];

const NATAL_ASPECT_TARGETS = [
  { name: 'Sun', id: swisseph.SE_SUN },
  { name: 'Moon', id: swisseph.SE_MOON },
  { name: 'Mercury', id: swisseph.SE_MERCURY },
  { name: 'Venus', id: swisseph.SE_VENUS },
  { name: 'Mars', id: swisseph.SE_MARS },
  { name: 'Jupiter', id: swisseph.SE_JUPITER },
  { name: 'Saturn', id: swisseph.SE_SATURN },
  { name: 'Uranus', id: swisseph.SE_URANUS },
  { name: 'Neptune', id: swisseph.SE_NEPTUNE },
  { name: 'Pluto', id: swisseph.SE_PLUTO }
];

const SOLAR_ARC_POINTS = [
  { name: 'Sun', id: swisseph.SE_SUN },
  { name: 'Moon', id: swisseph.SE_MOON },
  { name: 'Mercury', id: swisseph.SE_MERCURY },
  { name: 'Venus', id: swisseph.SE_VENUS },
  { name: 'Mars', id: swisseph.SE_MARS },
  { name: 'Jupiter', id: swisseph.SE_JUPITER },
  { name: 'Saturn', id: swisseph.SE_SATURN },
  { name: 'Uranus', id: swisseph.SE_URANUS },
  { name: 'Neptune', id: swisseph.SE_NEPTUNE },
  { name: 'Pluto', id: swisseph.SE_PLUTO }
];

const PRIMARY_DIRECTION_POINTS = [
  { name: 'Sun', id: swisseph.SE_SUN },
  { name: 'Moon', id: swisseph.SE_MOON },
  { name: 'Mercury', id: swisseph.SE_MERCURY },
  { name: 'Venus', id: swisseph.SE_VENUS },
  { name: 'Mars', id: swisseph.SE_MARS },
  { name: 'Jupiter', id: swisseph.SE_JUPITER },
  { name: 'Saturn', id: swisseph.SE_SATURN },
  { name: 'Uranus', id: swisseph.SE_URANUS },
  { name: 'Neptune', id: swisseph.SE_NEPTUNE },
  { name: 'Pluto', id: swisseph.SE_PLUTO }
];

const PRIMARY_DIRECTION_ASPECT_OFFSETS = [
  { name: 'Conjunction', offsets: [0] },
  { name: 'Opposition', offsets: [180] },
  { name: 'Square', offsets: [90, -90] },
  { name: 'Trine', offsets: [120, -120] },
  { name: 'Sextile', offsets: [60, -60] }
];

const NAIBOD_RATE = 0.98564736;

function normalizeDegree(value) {
  return ((value % 360) + 360) % 360;
}

function degreeToSign(fullDegree) {
  const normalized = normalizeDegree(fullDegree);
  const signIndex = Math.floor(normalized / 30);

  return {
    sign: SIGN_NAMES[signIndex],
    degree: Number((normalized % 30).toFixed(4)),
    full_degree: Number(normalized.toFixed(4))
  };
}

function angularDistance(a, b) {
  const diff = Math.abs(normalizeDegree(a) - normalizeDegree(b));
  return diff > 180 ? 360 - diff : diff;
}

function findAspects(fromDegree, targets) {
  const found = [];

  for (const target of targets) {
    const distance = angularDistance(fromDegree, target.full_degree);

    for (const aspect of ASPECTS) {
      const orb = Math.abs(distance - aspect.angle);

      if (orb <= aspect.orb) {
        found.push({
          to: target.name,
          aspect: aspect.name,
          orb: Number(orb.toFixed(4)),
          strength:
            orb <= 0.3 ? 'very_high' :
            orb <= 0.8 ? 'high' :
            orb <= 1.3 ? 'medium' :
            'low'
        });
      }
    }
  }

  return found.sort((a, b) => a.orb - b.orb);
}

function parseBirthDateTime(birth) {
  if (!birth?.date || !birth?.time || !birth?.timezone) {
    throw new Error('birth.date, birth.time and birth.timezone are required.');
  }

  const dt = DateTime.fromISO(`${birth.date}T${birth.time}`, {
    zone: birth.timezone
  });

  if (!dt.isValid) {
    throw new Error(`Invalid birth date/time/timezone: ${dt.invalidReason}`);
  }

  return dt;
}

function parseBirthToJulianDay(birth) {
  const dt = parseBirthDateTime(birth);
  const utc = dt.toUTC();
  const decimalHour = utc.hour + utc.minute / 60 + utc.second / 3600;

  return swisseph.swe_julday(
    utc.year,
    utc.month,
    utc.day,
    decimalHour,
    swisseph.SE_GREG_CAL
  );
}

function calcPoint(jd, pointId, flags) {
  const result = swisseph.swe_calc_ut(jd, pointId, flags);

  if (result?.error) {
    throw new Error(result.error);
  }

  const longitude = Array.isArray(result)
    ? result[0]
    : result.longitude;

  const speed = Array.isArray(result)
    ? result[3]
    : result.longitudeSpeed;

  return {
    full_degree: normalizeDegree(longitude),
    speed: typeof speed === 'number' ? speed : null,
    retrograde: typeof speed === 'number' ? speed < 0 : false
  };
}

function calculateAsteroidsGate({ birth }) {
  const jd = parseBirthToJulianDay(birth);
  const flags = swisseph.SEFLG_SPEED | swisseph.SEFLG_SWIEPH;

  const natalTargets = NATAL_ASPECT_TARGETS.map(target => {
    const point = calcPoint(jd, target.id, flags);

    return {
      name: target.name,
      full_degree: point.full_degree
    };
  });

  const points = [];

  for (const asteroid of ASTEROID_POINTS) {
    try {
      const point = calcPoint(jd, asteroid.id, flags);
      const signData = degreeToSign(point.full_degree);

      points.push({
        name: asteroid.name,
        sign: signData.sign,
        degree: signData.degree,
        full_degree: signData.full_degree,
        house: null,
        retrograde: point.retrograde,
        speed: point.speed,
        aspects: findAspects(point.full_degree, natalTargets)
      });
    } catch (err) {
      points.push({
        name: asteroid.name,
        error: err.message
      });
    }
  }

  return {
    gate: 'asteroids',
    points
  };
}

function buildScanDates(period, fallbackStartDate) {
  const start = period?.start
    ? DateTime.fromISO(period.start, { zone: 'utc' })
    : fallbackStartDate.setZone('utc');

  const end = period?.end
    ? DateTime.fromISO(period.end, { zone: 'utc' })
    : start.plus({ years: 1 });

  if (!start.isValid || !end.isValid) {
    throw new Error('period.start and period.end must be valid ISO dates.');
  }

  if (end <= start) {
    throw new Error('period.end must be after period.start.');
  }

  const totalDays = Math.ceil(end.diff(start, 'days').days);
  const stepDays = totalDays > 1500 ? 3 : 1;
  const dates = [];

  for (let i = 0; i <= totalDays; i += stepDays) {
    dates.push(start.plus({ days: i }));
  }

  return dates;
}

function getNatalPointTable(jd, flags, pointList) {
  return pointList.map(pointDef => {
    const point = calcPoint(jd, pointDef.id, flags);

    return {
      name: pointDef.name,
      full_degree: point.full_degree
    };
  });
}

function solarArcForDate({ natalJd, natalSunDegree, birthDt, targetDt, flags }) {
  const ageDays = targetDt.diff(birthDt, 'days').days;
  const ageYears = ageDays / 365.2425;
  const progressedJd = natalJd + ageYears;
  const progressedSun = calcPoint(progressedJd, swisseph.SE_SUN, flags);

  return normalizeDegree(progressedSun.full_degree - natalSunDegree);
}

function solarArcTopicsForHit(directedPoint, natalPoint) {
  const joined = `${directedPoint} ${natalPoint}`;
  const topics = new Set();

  if (/Sun|MC|Saturn/i.test(joined)) topics.add('career');
  if (/Sun|Venus|Jupiter|MC/i.test(joined)) topics.add('visibility');
  if (/Moon|Venus|Jupiter|Mercury/i.test(joined)) topics.add('money');
  if (/Venus|Mars|Moon/i.test(joined)) topics.add('relationship');
  if (/Moon|Mars|Saturn/i.test(joined)) topics.add('body');
  if (/Saturn|Pluto|Neptune/i.test(joined)) topics.add('hidden_patterns');

  if (!topics.size) topics.add('general');

  return [...topics];
}

function calculateSolarArcGate({ birth, period }) {
  const birthDt = parseBirthDateTime(birth);
  const natalJd = parseBirthToJulianDay(birth);
  const flags = swisseph.SEFLG_SPEED | swisseph.SEFLG_SWIEPH;

  const natalPoints = getNatalPointTable(natalJd, flags, SOLAR_ARC_POINTS);
  const natalSun = natalPoints.find(p => p.name === 'Sun');

  if (!natalSun) {
    throw new Error('Natal Sun could not be calculated for Solar Arc.');
  }

  const scanDates = buildScanDates(period, birthDt);
  const candidates = new Map();

  for (const targetDt of scanDates) {
    const arc = solarArcForDate({
      natalJd,
      natalSunDegree: natalSun.full_degree,
      birthDt,
      targetDt,
      flags
    });

    const directedPoints = natalPoints.map(point => ({
      name: `SA ${point.name}`,
      natal_name: point.name,
      full_degree: normalizeDegree(point.full_degree + arc)
    }));

    for (const directed of directedPoints) {
      for (const natal of natalPoints) {
        const distance = angularDistance(directed.full_degree, natal.full_degree);

        for (const aspect of ASPECTS) {
          const orb = Math.abs(distance - aspect.angle);

          if (orb <= 0.8) {
            const key = `${directed.name}|${natal.name}|${aspect.name}`;
            const existing = candidates.get(key);

            if (!existing || orb < existing.orb) {
              candidates.set(key, {
                directed_point: directed.name,
                natal_point: natal.name,
                aspect: aspect.name,
                exact_date: targetDt.toISODate(),
                orb: Number(orb.toFixed(4)),
                topics: solarArcTopicsForHit(directed.name, natal.name),
                strength:
                  orb <= 0.1 ? 'very_high' :
                  orb <= 0.25 ? 'high' :
                  orb <= 0.5 ? 'medium' :
                  'low'
              });
            }
          }
        }
      }
    }
  }

  const hits = [...candidates.values()]
    .sort((a, b) => a.orb - b.orb)
    .slice(0, 30);

  return {
    gate: 'solar_arc',
    period: period?.start && period?.end
      ? `${period.start}/${period.end}`
      : 'default_1_year',
    arc_method: 'progressed_sun_arc',
    hits
  };
}

function degToRad(deg) {
  return deg * Math.PI / 180;
}

function radToDeg(rad) {
  return rad * 180 / Math.PI;
}

function obliquityForJulianDay(jd) {
  const t = (jd - 2451545.0) / 36525;
  return 23.43929111 - (0.0130041667 * t);
}

function eclipticLongitudeToRightAscension(longitude, jd) {
  const lambda = degToRad(normalizeDegree(longitude));
  const epsilon = degToRad(obliquityForJulianDay(jd));

  const y = Math.sin(lambda) * Math.cos(epsilon);
  const x = Math.cos(lambda);

  return normalizeDegree(radToDeg(Math.atan2(y, x)));
}

function calcEquatorialPoint(jd, pointId, flags) {
  const result = swisseph.swe_calc_ut(
    jd,
    pointId,
    flags | swisseph.SEFLG_EQUATORIAL
  );

  if (result?.error) {
    throw new Error(result.error);
  }

  const rightAscension = Array.isArray(result)
    ? result[0]
    : (result.rightAscension ?? result.ra ?? result.longitude);

  const declination = Array.isArray(result)
    ? result[1]
    : (result.declination ?? result.latitude);

  if (typeof rightAscension !== 'number') {
    throw new Error('Right Ascension could not be calculated.');
  }

  return {
    ra: normalizeDegree(rightAscension),
    declination: typeof declination === 'number' ? declination : null
  };
}

function tryCalculatePrimaryAngles(jd, birth) {
  const angles = [];

  try {
    if (
      typeof birth?.latitude !== 'number' ||
      typeof birth?.longitude !== 'number'
    ) {
      return angles;
    }

    const houses = swisseph.swe_houses(
      jd,
      Number(birth.latitude),
      Number(birth.longitude),
      'P'
    );

    const asc =
      houses?.ascendant ??
      houses?.asc ??
      houses?.ascmc?.[0] ??
      null;

    const mc =
      houses?.mc ??
      houses?.midheaven ??
      houses?.ascmc?.[1] ??
      null;

    if (typeof asc === 'number') {
      angles.push({
        name: 'Ascendant',
        ra: eclipticLongitudeToRightAscension(asc, jd),
        full_degree: normalizeDegree(asc),
        type: 'angle'
      });
    }

    if (typeof mc === 'number') {
      angles.push({
        name: 'MC',
        ra: eclipticLongitudeToRightAscension(mc, jd),
        full_degree: normalizeDegree(mc),
        type: 'angle'
      });
    }
  } catch (err) {
    console.warn('Primary Direction angles skipped:', err.message);
  }

  return angles;
}

function getPrimaryDirectionPointTable(jd, flags, birth) {
  const planetPoints = PRIMARY_DIRECTION_POINTS.map(pointDef => {
    const ecliptic = calcPoint(jd, pointDef.id, flags);
    const equatorial = calcEquatorialPoint(jd, pointDef.id, flags);

    return {
      name: pointDef.name,
      full_degree: ecliptic.full_degree,
      ra: equatorial.ra,
      declination: equatorial.declination,
      type: 'planet'
    };
  });

  const anglePoints = tryCalculatePrimaryAngles(jd, birth);

  return [...planetPoints, ...anglePoints];
}

function yearsBetweenDateTimes(fromDt, toDt) {
  return toDt.diff(fromDt, 'days').days / 365.2425;
}

function dateFromAgeYears(birthDt, ageYears) {
  return birthDt
    .plus({ days: ageYears * 365.2425 })
    .toISODate();
}

function primaryDirectionTopicsForHit(promissor, significator) {
  const joined = `${promissor} ${significator}`;
  const topics = new Set();

  if (/MC|Sun|Saturn|Jupiter/i.test(joined)) topics.add('career');
  if (/MC|Sun|Venus|Jupiter|Ascendant/i.test(joined)) topics.add('visibility');
  if (/Moon|Venus|Mercury|Jupiter/i.test(joined)) topics.add('money');
  if (/Venus|Mars|Moon|Ascendant/i.test(joined)) topics.add('relationship');
  if (/Moon|Mars|Saturn|Ascendant/i.test(joined)) topics.add('body');
  if (/Saturn|Pluto|Neptune/i.test(joined)) topics.add('hidden_patterns');

  if (!topics.size) topics.add('general');

  return [...topics];
}

function primaryDirectionStrength({ promissor, significator, aspect, age }) {
  let score = 0;

  if (/Ascendant|MC/i.test(significator)) score += 3;
  if (/Sun|Moon/i.test(significator)) score += 2;
  if (/Sun|Moon|Venus|Mars|Saturn|Jupiter/i.test(promissor)) score += 2;
  if (/Conjunction|Opposition|Square/i.test(aspect)) score += 2;
  if (age >= 0 && age <= 90) score += 1;

  if (score >= 7) return 'very_high';
  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

function calculatePrimaryDirectionsGate({ birth, period }) {
  const birthDt = parseBirthDateTime(birth);
  const natalJd = parseBirthToJulianDay(birth);
  const flags = swisseph.SEFLG_SPEED | swisseph.SEFLG_SWIEPH;

  const periodStart = period?.start
    ? DateTime.fromISO(period.start, { zone: birth.timezone })
    : birthDt.plus({ years: 1 });

  const periodEnd = period?.end
    ? DateTime.fromISO(period.end, { zone: birth.timezone })
    : periodStart.plus({ years: 1 });

  if (!periodStart.isValid || !periodEnd.isValid) {
    throw new Error('period.start and period.end must be valid ISO dates.');
  }

  if (periodEnd <= periodStart) {
    throw new Error('period.end must be after period.start.');
  }

  const minAge = Math.max(0, yearsBetweenDateTimes(birthDt, periodStart));
  const maxAge = Math.max(0, yearsBetweenDateTimes(birthDt, periodEnd));

  const points = getPrimaryDirectionPointTable(natalJd, flags, birth);
  const promissors = points.filter(p => p.type === 'planet');
  const significators = points;

  const hits = [];
  const seen = new Set();

  for (const promissor of promissors) {
    for (const significator of significators) {
      if (promissor.name === significator.name) continue;

      for (const aspectDef of PRIMARY_DIRECTION_ASPECT_OFFSETS) {
        for (const offset of aspectDef.offsets) {
          const targetRa = normalizeDegree(significator.ra + offset);

          const directArc = normalizeDegree(targetRa - promissor.ra);
          const directAge = directArc / NAIBOD_RATE;

          if (directAge >= minAge && directAge <= maxAge) {
            const key = `${promissor.name}|${significator.name}|${aspectDef.name}|direct|${offset}`;

            if (!seen.has(key)) {
              seen.add(key);

              hits.push({
                promissor: promissor.name,
                significator: significator.name,
                aspect: aspectDef.name,
                direction: 'direct',
                arc: Number(directArc.toFixed(4)),
                age: Number(directAge.toFixed(4)),
                date_estimate: dateFromAgeYears(birthDt, directAge),
                topics: primaryDirectionTopicsForHit(promissor.name, significator.name),
                strength: primaryDirectionStrength({
                  promissor: promissor.name,
                  significator: significator.name,
                  aspect: aspectDef.name,
                  age: directAge
                })
              });
            }
          }

          const converseArc = normalizeDegree(promissor.ra - targetRa);
          const converseAge = converseArc / NAIBOD_RATE;

          if (converseAge >= minAge && converseAge <= maxAge) {
            const key = `${promissor.name}|${significator.name}|${aspectDef.name}|converse|${offset}`;

            if (!seen.has(key)) {
              seen.add(key);

              hits.push({
                promissor: promissor.name,
                significator: significator.name,
                aspect: aspectDef.name,
                direction: 'converse',
                arc: Number(converseArc.toFixed(4)),
                age: Number(converseAge.toFixed(4)),
                date_estimate: dateFromAgeYears(birthDt, converseAge),
                topics: primaryDirectionTopicsForHit(promissor.name, significator.name),
                strength: primaryDirectionStrength({
                  promissor: promissor.name,
                  significator: significator.name,
                  aspect: aspectDef.name,
                  age: converseAge
                })
              });
            }
          }
        }
      }
    }
  }

  hits.sort((a, b) => {
    const dateCompare = String(a.date_estimate).localeCompare(String(b.date_estimate));
    if (dateCompare !== 0) return dateCompare;

    const strengthRank = { very_high: 4, high: 3, medium: 2, low: 1 };
    return (strengthRank[b.strength] || 0) - (strengthRank[a.strength] || 0);
  });

  return {
    gate: 'primary_directions',
    method: 'equatorial_ra_naibod_direct_converse_v1',
    period: period?.start && period?.end
      ? `${period.start}/${period.end}`
      : 'default_1_year',
    hits: hits.slice(0, 40)
  };
}

app.post('/advanced-gate', requireSecret, async (req, res) => {
  try {
    const body = req.body || {};
    const requestedGates = Array.isArray(body.requested_gates)
      ? body.requested_gates
      : [];

    const gates = {};

    if (requestedGates.includes('asteroids')) {
      gates.asteroids = calculateAsteroidsGate({
        birth: body.birth
      });
    }

    if (requestedGates.includes('solar_arc')) {
      gates.solar_arc = calculateSolarArcGate({
        birth: body.birth,
        period: body.period
      });
    }

    if (requestedGates.includes('primary_directions')) {
      gates.primary_directions = calculatePrimaryDirectionsGate({
        birth: body.birth,
        period: body.period
      });
    }

    return res.json({
      ok: true,
      engine: 'grandmastrolog_advanced_gate_v1',
      received: {
        analysis_type: body.analysis_type || 'advanced_gate',
        requested_gates: requestedGates,
        period: body.period || null,
        focus: body.focus || []
      },
      advanced_gate_packet: {
        status: 'calculated',
        message: 'Advanced Gate endpoint çalışıyor. Asteroid Kapısı, Solar Arc ve Primary Direction gerçek hesap verisiyle döndü. Electional sonraki adımda bağlanacak.',
        gates,
        integrity: {
          asteroids_calculated: Boolean(gates.asteroids),
          solar_arc_calculated: Boolean(gates.solar_arc),
          primary_directions_calculated: Boolean(gates.primary_directions),
          electional_calculated: false
        }
      }
    });
  } catch (err) {
    console.error('advanced-gate error:', err);

    return res.status(500).json({
      ok: false,
      error: 'Advanced Gate calculation failed.',
      detail: err.message
    });
  }
});
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
app.post('/memory/upsert-active-context', requireSecret, async (req, res) => {
  if (!pool) {
    return res.status(500).json({
      ok: false,
      error: 'DATABASE_URL is not configured.'
    });
  }

  const {
    user_id = 'default',
    type = 'owner_active_compact_context',
    content
  } = req.body || {};

  if (!content || typeof content !== 'string') {
    return res.status(400).json({
      ok: false,
      error: 'content is required.'
    });
  }

  try {
    const existing = await pool.query(
      `
      SELECT id
      FROM gm_memory
      WHERE user_id=$1 AND type=$2 AND enabled=true
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      `,
      [user_id, type]
    );

    let memory;

    if (existing.rows[0]?.id) {
      const activeId = existing.rows[0].id;

      await pool.query(
        `
        UPDATE gm_memory
        SET enabled=false
        WHERE user_id=$1 AND type=$2 AND enabled=true AND id<>$3
        `,
        [user_id, type, activeId]
      );

      const updated = await pool.query(
        `
        UPDATE gm_memory
        SET content=$1
        WHERE id=$2
        RETURNING id, user_id, type, content, enabled, created_at
        `,
        [content, activeId]
      );

      memory = updated.rows[0];
    } else {
      const inserted = await pool.query(
        `
        INSERT INTO gm_memory (user_id, type, content, enabled)
        VALUES ($1, $2, $3, true)
        RETURNING id, user_id, type, content, enabled, created_at
        `,
        [user_id, type, content]
      );

      memory = inserted.rows[0];
    }

    await pool.query(
      `
      UPDATE gm_memory
      SET enabled=false
      WHERE user_id=$1 AND type=$2 AND enabled=true AND id<>$3
      `,
      [user_id, type, memory.id]
    );

    return res.json({
      ok: true,
      upserted: true,
      memory: {
        id: String(memory.id),
        user_id: memory.user_id,
        type: memory.type,
        enabled: memory.enabled,
        created_at: memory.created_at,
        content_preview: String(memory.content || '').slice(0, 300)
      }
    });
  } catch (err) {
    console.error('upsert-active-context error:', err);

    return res.status(500).json({
      ok: false,
      error: 'Upsert active context failed.',
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
