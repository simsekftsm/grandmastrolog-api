import { createHash } from 'crypto';
import { createRequire } from 'module';
import { DateTime } from 'luxon';

const require = createRequire(import.meta.url);
const swisseph = require('swisseph');
swisseph.swe_set_ephe_path('./ephe');

export const EVIDENCE_ENGINE = 'grandmastrolog_swisseph_natal_v1';
export const EVIDENCE_SOURCE = 'grandmastrolog-api';

const SIGN_TR = Object.freeze({
  Aries: 'Koç', Taurus: 'Boğa', Gemini: 'İkizler', Cancer: 'Yengeç',
  Leo: 'Aslan', Virgo: 'Başak', Libra: 'Terazi', Scorpio: 'Akrep',
  Sagittarius: 'Yay', Capricorn: 'Oğlak', Aquarius: 'Kova', Pisces: 'Balık'
});

const SIGN_NAMES = Object.freeze([
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'
]);

const POINTS = Object.freeze([
  ['sun', 'Güneş', swisseph.SE_SUN],
  ['moon', 'Ay', swisseph.SE_MOON],
  ['mercury', 'Merkür', swisseph.SE_MERCURY],
  ['venus', 'Venüs', swisseph.SE_VENUS],
  ['mars', 'Mars', swisseph.SE_MARS],
  ['jupiter', 'Jüpiter', swisseph.SE_JUPITER],
  ['saturn', 'Satürn', swisseph.SE_SATURN],
  ['uranus', 'Uranüs', swisseph.SE_URANUS],
  ['neptune', 'Neptün', swisseph.SE_NEPTUNE],
  ['pluto', 'Plüton', swisseph.SE_PLUTO],
  ['north_node', 'Kuzey Ay Düğümü', swisseph.SE_TRUE_NODE ?? swisseph.SE_MEAN_NODE]
]);

const AVAILABILITY = Object.freeze({
  ayin_gokyuzu_haritasi: false,
  element_dengen: false,
  sinerji: false,
  senin_yolun: false,
  hellenistic: false,
  jyotish: false,
  esoteric: false,
  sade_sati: false,
  rahu_ketu: false,
  retrogrades: false,
  lilith: false,
  chiron: false,
  vertex: false,
  part_of_fortune: false,
  fixed_stars: false
});

function normalizeDegree(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function parseBirth(birth) {
  if (!birth || typeof birth !== 'object' || Array.isArray(birth)) {
    throw new Error('BIRTH_REQUIRED');
  }
  const allowed = new Set(['date', 'time', 'timezone', 'latitude', 'longitude', 'district', 'city']);
  for (const key of Object.keys(birth)) {
    if (!allowed.has(key)) throw new Error(`BIRTH_UNKNOWN_FIELD:${key}`);
  }
  for (const key of ['date', 'time', 'timezone', 'district', 'city']) {
    if (typeof birth[key] !== 'string' || !birth[key].trim()) throw new Error(`BIRTH_FIELD_REQUIRED:${key}`);
  }
  if (!Number.isFinite(birth.latitude) || birth.latitude < -90 || birth.latitude > 90) {
    throw new Error('BIRTH_LATITUDE_INVALID');
  }
  if (!Number.isFinite(birth.longitude) || birth.longitude < -180 || birth.longitude > 180) {
    throw new Error('BIRTH_LONGITUDE_INVALID');
  }

  const dt = DateTime.fromISO(`${birth.date}T${birth.time}`, { zone: birth.timezone });
  if (!dt.isValid) throw new Error('BIRTH_DATETIME_INVALID');
  return dt;
}

function julianDay(dt) {
  const utc = dt.toUTC();
  const decimalHour = utc.hour + utc.minute / 60 + utc.second / 3600;
  return swisseph.swe_julday(utc.year, utc.month, utc.day, decimalHour, swisseph.SE_GREG_CAL);
}

function calcPoint(jd, pointId, flags) {
  if (typeof pointId !== 'number') throw new Error('ASTRO_POINT_UNAVAILABLE');
  const result = swisseph.swe_calc_ut(jd, pointId, flags);
  if (result?.error) throw new Error(`ASTRO_UPSTREAM:${result.error}`);
  const longitude = Array.isArray(result) ? result[0] : result?.longitude;
  const speed = Array.isArray(result) ? result[3] : result?.longitudeSpeed;
  if (!Number.isFinite(longitude)) throw new Error('ASTRO_LONGITUDE_MISSING');
  return {
    full_degree: normalizeDegree(longitude),
    speed: Number.isFinite(speed) ? speed : null,
    retrograde: Number.isFinite(speed) ? speed < 0 : false
  };
}

function signData(fullDegree) {
  const normalized = normalizeDegree(fullDegree);
  const signEn = SIGN_NAMES[Math.floor(normalized / 30)];
  const degreeInSign = normalized % 30;
  return {
    sign: SIGN_TR[signEn],
    degree_in_sign: degreeInSign
  };
}

function formatDegree(value) {
  let degree = Math.floor(value);
  let minute = Math.round((value - degree) * 60);
  if (minute === 60) {
    degree += 1;
    minute = 0;
  }
  return `${degree}°${String(minute).padStart(2, '0')}′`;
}

function extractAnglesAndCusps(jd, birth) {
  const houses = swisseph.swe_houses(jd, Number(birth.latitude), Number(birth.longitude), 'P');
  const asc = houses?.ascendant ?? houses?.asc ?? houses?.ascmc?.[0];
  const mc = houses?.mc ?? houses?.midheaven ?? houses?.ascmc?.[1];
  if (!Number.isFinite(asc) || !Number.isFinite(mc)) throw new Error('ASTRO_ANGLES_MISSING');

  const rawCusps = Array.isArray(houses?.house)
    ? houses.house
    : Array.isArray(houses?.cusps)
      ? houses.cusps
      : [];
  const cusps = rawCusps.length >= 13 ? rawCusps.slice(1, 13) : rawCusps.slice(0, 12);
  return {
    ascendant: normalizeDegree(asc),
    mc: normalizeDegree(mc),
    cusps: cusps.length === 12 && cusps.every(Number.isFinite) ? cusps.map(normalizeDegree) : []
  };
}

function houseForDegree(fullDegree, cusps) {
  if (!Array.isArray(cusps) || cusps.length !== 12) return '';
  const degree = normalizeDegree(fullDegree);
  for (let i = 0; i < 12; i += 1) {
    const start = normalizeDegree(cusps[i]);
    const end = normalizeDegree(cusps[(i + 1) % 12]);
    const span = normalizeDegree(end - start);
    const position = normalizeDegree(degree - start);
    if (position < span || (i === 11 && position === span)) return `${i + 1}. ev`;
  }
  return '';
}

function stableSerialize(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('NON_CANONICAL_NUMBER');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  throw new Error('NON_CANONICAL_VALUE');
}

function evidenceDigest(bindingInput) {
  return createHash('sha256').update(stableSerialize(bindingInput), 'utf8').digest('hex');
}

function placementEvidence(pointId, label, fullDegree, retrograde, house, requestId) {
  const sign = signData(fullDegree);
  const degree = formatDegree(sign.degree_in_sign);
  return {
    evidence_id: `ev_${pointId}`,
    source_ref: `astro://grandmastrolog-api/${EVIDENCE_ENGINE}/${requestId}/${pointId}`,
    kind: 'placement',
    subject_id: pointId,
    semantic_value: `${label}: ${sign.sign} ${degree}${house ? `, ${house}` : ''}${retrograde ? ', retrograd' : ''}.`,
    sign: sign.sign,
    degree,
    house,
    retrograde: Boolean(retrograde),
    verification_state: 'verified'
  };
}

function indicatorEvidence(subjectId, semanticValue, requestId) {
  return {
    evidence_id: `ev_${subjectId}`,
    source_ref: `astro://grandmastrolog-api/${EVIDENCE_ENGINE}/${requestId}/indicator/${subjectId}`,
    kind: 'indicator',
    subject_id: subjectId,
    semantic_value: semanticValue,
    sign: '',
    degree: '',
    house: '',
    retrograde: false,
    verification_state: 'verified'
  };
}

export function buildNatalBindingInput({ request_id, birth }) {
  if (typeof request_id !== 'string' || !/^[A-Za-z0-9._:-]{1,96}$/.test(request_id)) {
    throw new Error('REQUEST_ID_INVALID');
  }
  const birthDt = parseBirth(birth);
  const jd = julianDay(birthDt);
  const flags = swisseph.SEFLG_SPEED | swisseph.SEFLG_SWIEPH;
  const angles = extractAnglesAndCusps(jd, birth);

  const byPoint = new Map();
  for (const [pointId, label, sweId] of POINTS) {
    const point = calcPoint(jd, sweId, flags);
    byPoint.set(pointId, placementEvidence(
      pointId,
      label,
      point.full_degree,
      point.retrograde,
      houseForDegree(point.full_degree, angles.cusps),
      request_id
    ));
  }

  byPoint.set('ascendant', placementEvidence('ascendant', 'Yükselen', angles.ascendant, false, '', request_id));
  byPoint.set('mc', placementEvidence('mc', 'MC', angles.mc, false, '', request_id));

  const order = [
    'sun', 'moon', 'ascendant', 'mercury', 'venus', 'mars', 'jupiter',
    'saturn', 'uranus', 'neptune', 'pluto', 'north_node', 'mc'
  ];
  const placements = order.map((id) => byPoint.get(id));
  if (placements.some((item) => !item)) throw new Error('ASTRO_PLACEMENT_SET_INCOMPLETE');

  const p = (id) => byPoint.get(id).semantic_value;
  const indicators = [
    indicatorEvidence('profilin', `Profil göstergeleri: ${p('sun')} ${p('moon')} ${p('ascendant')}`, request_id),
    indicatorEvidence('haritanin_ozu', `Haritanın özü göstergeleri: ${p('sun')} ${p('moon')} ${p('ascendant')}`, request_id),
    indicatorEvidence('para_kariyer', `Para ve kariyer göstergeleri: ${p('mc')} ${p('saturn')} ${p('jupiter')}`, request_id),
    indicatorEvidence('iliskiler', `İlişki göstergeleri: ${p('venus')} ${p('mars')} ${p('moon')}`, request_id),
    indicatorEvidence('aile', `Aile göstergeleri: ${p('moon')} ${p('saturn')}`, request_id),
    indicatorEvidence('karmalar', `Karmik göstergeler: ${p('north_node')} ${p('saturn')} ${p('pluto')}`, request_id)
  ];

  const binding_input = {
    request_id,
    semantic_input: 'Doğrulanmış GrandMastrolog Natal verilerinden ilk Natal yorumunu üret.',
    availability: { ...AVAILABILITY },
    verified_evidence: [...placements, ...indicators]
  };

  return Object.freeze({
    source: EVIDENCE_SOURCE,
    engine: EVIDENCE_ENGINE,
    binding_input,
    evidence_sha256: evidenceDigest(binding_input)
  });
}

export { stableSerialize, evidenceDigest };
