'use strict';

const crypto = require('node:crypto');

const ELEMENTS = Object.freeze([
  { key: 'Ateş', asset: '/elements/ates.png', base: 286, x: 542.5, y: 455, labelX: 542.5, labelY: 210 },
  { key: 'Toprak', asset: '/elements/toprak.png', base: 282, x: 205, y: 790, labelX: 128, labelY: 610 },
  { key: 'Hava', asset: '/elements/hava.png', base: 282, x: 880, y: 790, labelX: 957, labelY: 610 },
  { key: 'Su', asset: '/elements/su.png', base: 260, x: 542.5, y: 1085, labelX: 542.5, labelY: 1222 }
]);

const ELEMENT_KEYS = Object.freeze(ELEMENTS.map((x) => x.key));
const SUBJECT_ID = 'element_dengen';

class ElementVisualError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ElementVisualError';
    this.code = code;
  }
}

function fail(code, message) { throw new ElementVisualError(code, message); }

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatPercent(value) {
  const n = Number(value);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function parseElementPercentages(section, evidenceMap) {
  if (!section || section.section_id !== 'element_dengen' || section.included !== true) {
    return null;
  }
  const candidates = section.hat_evidence_refs
    .map((id) => evidenceMap.get(id))
    .filter((item) => item && item.kind === 'indicator' && item.subject_id === SUBJECT_ID && item.verification_state === 'verified');
  if (candidates.length !== 1) fail('ELEMENT_VISUAL_EVIDENCE_MISSING', 'Element Dengen requires exactly one verified structured element evidence binding.');

  let parsed;
  try { parsed = JSON.parse(candidates[0].semantic_value); }
  catch { fail('ELEMENT_VISUAL_EVIDENCE_INVALID', 'Element evidence semantic_value must be canonical JSON percentages.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('ELEMENT_VISUAL_EVIDENCE_INVALID', 'Element evidence must be an object.');
  const keys = Object.keys(parsed);
  if (keys.length !== 4 || ELEMENT_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(parsed, key))) {
    fail('ELEMENT_VISUAL_EVIDENCE_INVALID', 'Element evidence must contain exactly Ateş, Toprak, Hava and Su.');
  }
  const out = {};
  for (const key of ELEMENT_KEYS) {
    const value = Number(parsed[key]);
    if (!Number.isFinite(value) || value < 0 || value > 100) fail('ELEMENT_VISUAL_EVIDENCE_INVALID', `Invalid percentage for ${key}.`);
    out[key] = value;
  }
  const total = ELEMENT_KEYS.reduce((sum, key) => sum + out[key], 0);
  if (total < 99 || total > 101) fail('ELEMENT_VISUAL_EVIDENCE_INVALID', 'Element percentages must sum to approximately 100.');
  return Object.freeze(out);
}

function scaleFor(value) {
  return 0.76 + 0.48 * Math.min(1, Math.max(0, Number(value) / 55));
}

function seededStars(seed, count = 220) {
  let state = BigInt(`0x${crypto.createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 16)}`);
  const mask = (1n << 64n) - 1n;
  const next = () => {
    state ^= (state << 13n) & mask;
    state ^= state >> 7n;
    state ^= (state << 17n) & mask;
    state &= mask;
    return Number(state % 1000000n) / 1000000;
  };
  const stars = [];
  for (let i = 0; i < count; i += 1) {
    const x = 28 + next() * 1029;
    const y = 28 + next() * 1394;
    const r = 0.6 + next() * 1.8;
    const opacity = 0.25 + next() * 0.55;
    stars.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="#ffd06a" opacity="${opacity.toFixed(2)}"/>`);
  }
  return stars.join('');
}

function renderElementSvg(percentages, seed = '') {
  if (!percentages) return null;
  const canonical = ELEMENT_KEYS.map((key) => `${key}=${formatPercent(percentages[key])}`).join('|');
  const stars = seededStars(`${seed}|${canonical}`);
  const legend = [...ELEMENT_KEYS]
    .sort((a, b) => Number(percentages[b]) - Number(percentages[a]) || ELEMENT_KEYS.indexOf(a) - ELEMENT_KEYS.indexOf(b))
    .map((key, rank) => ({ key, rank, nameSize: 28 - rank, percentSize: 29 - rank }));

  const images = ELEMENTS.map((item) => {
    const size = Math.round(item.base * scaleFor(percentages[item.key]));
    const x = item.x - size / 2;
    const y = item.y - size / 2;
    return `<image href="${item.asset}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`;
  }).join('');

  const colors = { 'Ateş':'#ff8412', 'Toprak':'#c5dd1c', 'Hava':'#cde2ee', 'Su':'#96d8ff' };
  const labels = ELEMENTS.map((item) => {
    const pct = formatPercent(percentages[item.key]);
    return `<text x="${item.labelX}" y="${item.labelY}" text-anchor="middle" font-family="Georgia,serif" font-size="31" font-weight="700" fill="${colors[item.key]}">${escapeXml(item.key.toLocaleUpperCase('tr-TR'))}</text>` +
      `<text x="${item.labelX}" y="${item.labelY + 39}" text-anchor="middle" font-family="Georgia,serif" font-size="40" font-weight="400" fill="${colors[item.key]}">%${escapeXml(pct)}</text>`;
  }).join('');

  const legendRows = legend.map((row, index) => {
    const y = 694 + index * 50;
    const pct = formatPercent(percentages[row.key]);
    return `<text x="425" y="${y}" font-family="Georgia,serif" font-size="${row.nameSize}" font-weight="400" fill="${colors[row.key]}">${escapeXml(row.key.toLocaleUpperCase('tr-TR'))}</text>` +
      `<text x="660" y="${y}" text-anchor="end" font-family="Georgia,serif" font-size="${row.percentSize}" font-weight="700" fill="#f6d791">%${escapeXml(pct)}</text>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1085" height="1450" viewBox="0 0 1085 1450" role="img" aria-label="GrandMastrolog 4 Element Dağılımı">` +
    `<rect width="1085" height="1450" fill="#030a0c"/>${stars}` +
    `<rect x="18" y="18" width="1049" height="1414" fill="none" stroke="#d9a52d" stroke-width="3"/>` +
    `<rect x="29" y="29" width="1027" height="1392" fill="none" stroke="#d9a52d" stroke-width="1" opacity="0.7"/>` +
    `<text x="542.5" y="88" text-anchor="middle" font-family="Georgia,serif" font-size="27" font-weight="700" fill="#d9a52d">GRANDMASTROLOG ELEMENT ANALİZİ</text>` +
    `<text x="542.5" y="166" text-anchor="middle" font-family="Georgia,serif" font-size="58" font-weight="400" fill="#f6d791">4 ELEMENT DAĞILIMI</text>` +
    `<text x="542.5" y="205" text-anchor="middle" font-family="Georgia,serif" font-size="27" font-style="italic" fill="#ebcc85">Doğum haritandaki element dengesinin görselleştirilmiş özeti</text>` +
    `<line x1="250" y1="235" x2="835" y2="235" stroke="#d9a52d" stroke-width="2" opacity="0.7"/>` +
    `<circle cx="542.5" cy="760" r="410" fill="none" stroke="#d9a52d" stroke-width="2" opacity="0.85"/>` +
    `<circle cx="542.5" cy="760" r="392" fill="none" stroke="#d9a52d" stroke-width="1" opacity="0.55"/>` +
    `<circle cx="542.5" cy="760" r="335" fill="none" stroke="#d9a52d" stroke-width="1" opacity="0.45"/>` +
    images + labels +
    `<circle cx="542.5" cy="760" r="178" fill="#020b0d" fill-opacity="0.96" stroke="#d9a52d" stroke-width="3"/>` +
    `<circle cx="542.5" cy="760" r="168" fill="none" stroke="#eec762" stroke-width="1" opacity="0.55"/>` +
    `<text x="542.5" y="624" text-anchor="middle" font-family="Georgia,serif" font-size="25" font-weight="700" fill="#f6d791">4 ELEMENT DAĞILIMI</text>` +
    `<line x1="430" y1="642" x2="655" y2="642" stroke="#d9a52d" opacity="0.55"/>` + legendRows +
    `<rect x="120" y="1310" width="845" height="81" rx="16" fill="#030c0e" fill-opacity="0.9" stroke="#d9a52d" stroke-width="2"/>` +
    `<text x="542.5" y="1358" text-anchor="middle" font-family="Georgia,serif" font-size="22" fill="#ebcf97">Elementlerin oranı, doğum haritandaki doğal enerjilerin nasıl dağıldığını gösterir.</text>` +
    `</svg>`;
  return {
    mime_type: 'image/svg+xml',
    width: 1085,
    height: 1450,
    svg,
    sha256: crypto.createHash('sha256').update(svg, 'utf8').digest('hex'),
    percentages: { ...percentages },
    legend: legend.map((x) => ({ element: x.key, name_font_size: x.nameSize, percent_font_size: x.percentSize })),
    asset_refs: ELEMENTS.map((x) => x.asset)
  };
}

module.exports = {
  ELEMENT_KEYS,
  ElementVisualError,
  parseElementPercentages,
  renderElementSvg
};
