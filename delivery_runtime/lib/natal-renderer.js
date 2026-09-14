'use strict';

const crypto = require('node:crypto');
const {
  CONTRACT_VERSION,
  SCHEMA_ID,
  VALIDATOR_ID,
  PRE_SEAL_SECTION_ORDER,
  MAIN_LIFE_SECTION_ORDER,
  SPECIAL_ORDER,
  ContractValidationError,
  SchemaValidationError,
  validateBindingInput,
  makeValidatedEnvelope
} = require('./natal-contract');
const {
  ElementVisualError,
  parseElementPercentages,
  renderElementSvg
} = require('./element-visual');

const RENDERER_ID = 'gm_natal_canonical_renderer_v1';
const RENDERER_VERSION = '1.0.0-m1a3';
const INPUT_RENDER_STATE = 'blocked_until_m1a3';
const OUTPUT_RENDER_STATE = 'rendered_for_m1a3_acceptance';

const FIXED_HEADINGS = Object.freeze({
  profilin: '• PROFİLİN •',
  haritanin_ozu: '• HARİTANIN ÖZÜ •',
  element_dengen: '• ELEMENT DENGEN •',
  senin_yolun: '• SENİN YOLUN •',
  para_kariyer: '• PARA & KARİYER •',
  iliskiler: '• İLİŞKİLER •',
  aile: '• AİLE •',
  karmalar: '• KARMALAR •'
});

const PLACEMENT_LABELS = Object.freeze({
  sun: 'Güneş', moon: 'Ay', ascendant: 'Yükselen', mercury: 'Merkür', venus: 'Venüs',
  mars: 'Mars', jupiter: 'Jüpiter', saturn: 'Satürn', uranus: 'Uranüs',
  neptune: 'Neptün', pluto: 'Plüton', north_node: 'Kuzey Ay Düğümü', mc: 'MC'
});

const FIRST_CALIBRATION = 'Buraya kadarki ana yaşam alanları sende karşılık buluyor mu? **Evet / Hayır / Kısmen**';
const SECOND_CALIBRATION = 'Bu anlattıklarım sende karşılık buluyor mu? **Evet / Hayır / Kısmen**';
const RETURN_TO_USER_INTENT = 'Natal kapısı tamamlandı; bundan sonra doğrudan istediğin konuya girebiliriz. Kariyer/para, ilişki, aile, zamanlama, Vedik/Jyotish, kör nokta-gölge ya da başka bir mesele sorabilirsin. İstersen “açılım listesi” yazıp bütün görünür açılımları da görebilirsin.';

class RendererError extends Error {
  constructor(code, message, path = '$') {
    super(message);
    this.name = 'RendererError';
    this.code = code;
    this.path = path;
  }
}

function fail(code, message, path) { throw new RendererError(code, message, path); }

function countOccurrence(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const at = text.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + needle.length;
  }
}

function evidenceMapFromEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) fail('MALFORMED_RENDERER_STATE', 'Validated envelope is missing.');
  if (envelope.contract_version !== CONTRACT_VERSION || envelope.schema_id !== SCHEMA_ID || envelope.validator_id !== VALIDATOR_ID) {
    fail('MALFORMED_RENDERER_STATE', 'Validated envelope identity mismatch.');
  }
  if (envelope.render_state !== INPUT_RENDER_STATE) fail('MALFORMED_RENDERER_STATE', 'Unexpected renderer input state.', '$.render_state');
  if (!envelope.semantic_payload || !Array.isArray(envelope.evidence_bindings)) fail('MALFORMED_RENDERER_STATE', 'Validated envelope payload is incomplete.');
  const map = new Map();
  for (const item of envelope.evidence_bindings) {
    if (!item || typeof item.evidence_id !== 'string' || item.verification_state !== 'verified') fail('MALFORMED_RENDERER_STATE', 'Renderer evidence binding is invalid.');
    if (map.has(item.evidence_id)) fail('MALFORMED_RENDERER_STATE', 'Duplicate renderer evidence binding.');
    map.set(item.evidence_id, item);
  }
  return map;
}

function hatText(refs, evidenceMap, elementPercentages = null) {
  if (elementPercentages) {
    return ['Ateş','Toprak','Hava','Su'].map((key) => `${key} %${formatPercent(elementPercentages[key])}`).join(' • ');
  }
  const values = refs.map((id) => evidenceMap.get(id)).map((item) => {
    if (!item || item.verification_state !== 'verified') fail('MALFORMED_RENDERER_STATE', 'Hat references non-verified evidence.');
    return item.semantic_value;
  });
  if (!values.length) fail('MALFORMED_RENDERER_STATE', 'Visible section requires Hat evidence.');
  return values.join(' • ');
}

function formatPercent(value) {
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function placementLine(item, isLast) {
  const label = PLACEMENT_LABELS[item.point_id];
  if (!label) fail('MALFORMED_RENDERER_STATE', `Unknown placement: ${item.point_id}`);
  const house = item.house ? ` — ${item.house}` : '';
  const retro = item.retrograde ? ' (R)' : '';
  return `> *${label} ${item.sign} ${item.degree}${house}${retro}*${isLast ? '' : '  '}`;
}

function sectionHeading(section, payload) {
  if (section.section_id === 'sinerji') {
    const sun = payload.natal_placements.find((x) => x.point_id === 'sun');
    const asc = payload.natal_placements.find((x) => x.point_id === 'ascendant');
    if (!sun || !asc) fail('MALFORMED_RENDERER_STATE', 'Sinerji requires Sun and Ascendant.');
    return `• ${sun.sign.toLocaleUpperCase('tr-TR')} + ${asc.sign.toLocaleUpperCase('tr-TR')} SİNERJİSİ •`;
  }
  const fixed = FIXED_HEADINGS[section.section_id];
  if (!fixed) fail('MALFORMED_RENDERER_STATE', `No canonical heading for ${section.section_id}.`);
  return fixed;
}

function renderSection(lines, section, payload, evidenceMap, elementPercentages = null) {
  if (!section.included) return;
  lines.push(`> ## ${sectionHeading(section, payload)}`);
  if (section.section_id !== 'profilin') lines.push('>');
  lines.push(`> *Hat: ${hatText(section.hat_evidence_refs, evidenceMap, elementPercentages)}*`);
  lines.push('---');
  section.body_paragraphs.forEach((paragraph, index) => {
    if (index) lines.push('');
    lines.push(paragraph);
  });
  lines.push('---');
}

function renderSpecial(lines, contribution, evidenceMap) {
  lines.push(`> *Hat: ${hatText(contribution.evidence_refs, evidenceMap)}*`);
  contribution.body_paragraphs.forEach((paragraph, index) => {
    if (index) lines.push('');
    lines.push(paragraph);
  });
  lines.push('---');
}

function buildCanonicalRender(envelope, availability) {
  const evidenceMap = evidenceMapFromEnvelope(envelope);
  const payload = envelope.semantic_payload;
  const lines = [];
  const visualAttachments = [];

  if (payload.prelude.included) {
    lines.push('> ## • AYIN GÖKYÜZÜ HARİTASI •');
    lines.push(`> *Hat: ${hatText(payload.prelude.hat_evidence_refs, evidenceMap)}*`);
    lines.push('---');
    payload.prelude.body_paragraphs.forEach((paragraph, index) => {
      if (index) lines.push('');
      lines.push(paragraph);
    });
    lines.push('---');
  } else {
    lines.push('---');
  }

  lines.push('> # • NATAL (DOĞUM) HARİTAN •');
  payload.natal_placements.forEach((placement, index) => lines.push(placementLine(placement, index === payload.natal_placements.length - 1)));
  lines.push('---');

  for (const expectedId of PRE_SEAL_SECTION_ORDER) {
    const section = payload.pre_seal_sections.find((x) => x.section_id === expectedId);
    if (!section) fail('MALFORMED_RENDERER_STATE', `Missing pre-seal section ${expectedId}.`);
    let elementPercentages = null;
    if (section.section_id === 'element_dengen' && section.included) {
      elementPercentages = parseElementPercentages(section, evidenceMap);
    }
    renderSection(lines, section, payload, evidenceMap, elementPercentages);
    if (section.section_id === 'element_dengen' && section.included) {
      const visual = renderElementSvg(elementPercentages, envelope.evidence_catalog_sha256 || 'gm.natal.v1');
      visualAttachments.push({
        attachment_id: 'element_dengen_visual',
        insert_after_section: 'element_dengen',
        ...visual
      });
    }
  }

  const sun = payload.natal_placements.find((x) => x.point_id === 'sun');
  const asc = payload.natal_placements.find((x) => x.point_id === 'ascendant');
  if (!sun || !asc || payload.personal_seal.included !== true) fail('MALFORMED_RENDERER_STATE', 'Personal seal state is invalid.');
  lines.push(`> *${sun.sign} & ${asc.sign}: ${payload.personal_seal.motto}*`);
  lines.push('---');

  for (const expectedId of MAIN_LIFE_SECTION_ORDER) {
    const section = payload.main_life_sections.find((x) => x.section_id === expectedId);
    if (!section) fail('MALFORMED_RENDERER_STATE', `Missing main-life section ${expectedId}.`);
    renderSection(lines, section, payload, evidenceMap);
  }

  if (payload.first_calibration.calibration_id !== 'main_life_areas' || payload.first_calibration.required !== true) fail('MALFORMED_RENDERER_STATE', 'First calibration state is invalid.');
  lines.push(FIRST_CALIBRATION);
  lines.push('');

  const specialIds = payload.special_contributions.map((x) => x.contribution_id);
  const expectedSpecial = SPECIAL_ORDER.filter((id) => availability[id]);
  if (specialIds.length !== expectedSpecial.length || specialIds.some((id, i) => id !== expectedSpecial[i])) fail('MALFORMED_RENDERER_STATE', 'Special contribution order is invalid.');
  payload.special_contributions.forEach((item) => renderSpecial(lines, item, evidenceMap));

  if (payload.second_calibration.calibration_id !== 'general_natal' || payload.second_calibration.required !== true) fail('MALFORMED_RENDERER_STATE', 'Second calibration state is invalid.');
  lines.push(SECOND_CALIBRATION);
  lines.push('');
  if (payload.return_identity !== 'return_to_user_intent') fail('MALFORMED_RENDERER_STATE', 'Return identity is invalid.');
  lines.push(RETURN_TO_USER_INTENT);

  const canonicalMarkdown = lines.join('\n');
  return {
    renderer_id: RENDERER_ID,
    renderer_version: RENDERER_VERSION,
    contract_version: CONTRACT_VERSION,
    schema_id: SCHEMA_ID,
    render_state: OUTPUT_RENDER_STATE,
    format: 'canonical_markdown_v1',
    final_delivery_authorized: false,
    delivery_validator_enabled: false,
    canonical_markdown: canonicalMarkdown,
    canonical_markdown_sha256: crypto.createHash('sha256').update(canonicalMarkdown, 'utf8').digest('hex'),
    visual_attachments: visualAttachments
  };
}

function assertCanonicalPostconditions(result, payload) {
  const text = result.canonical_markdown;
  const required = [
    '> # • NATAL (DOĞUM) HARİTAN •',
    '> ## • PROFİLİN •',
    '> ## • HARİTANIN ÖZÜ •',
    '> ## • PARA & KARİYER •',
    '> ## • İLİŞKİLER •',
    '> ## • AİLE •',
    '> ## • KARMALAR •',
    FIRST_CALIBRATION,
    SECOND_CALIBRATION,
    RETURN_TO_USER_INTENT
  ];
  for (const marker of required) {
    if (countOccurrence(text, marker) !== 1) fail('RENDER_POSTCONDITION_FAILED', `Canonical marker count failed: ${marker}`);
  }
  if (/(^|\n)>?\s*#{1,6}\s+.*POTANSİYELLER/u.test(text)) fail('RENDER_POSTCONDITION_FAILED', 'Standalone POTANSİYELLER is forbidden.');
  if (text.includes('Harita hattın:')) fail('RENDER_POSTCONDITION_FAILED', 'Initial Natal cannot expose Harita hattın.');
  if (text.includes('"semantic_payload"') || text.includes('"evidence_bindings"') || text.includes('raw_model_output')) fail('RAW_SEMANTIC_LEAK', 'Raw semantic/model state leaked into visible output.');
  const first = text.indexOf(FIRST_CALIBRATION);
  const second = text.indexOf(SECOND_CALIBRATION);
  const ret = text.indexOf(RETURN_TO_USER_INTENT);
  if (!(first >= 0 && second > first && ret > second)) fail('RENDER_POSTCONDITION_FAILED', 'Calibration/return order is invalid.');

  const semanticSequence = [];
  if (payload.prelude.included) semanticSequence.push(...payload.prelude.body_paragraphs);
  for (const section of payload.pre_seal_sections) if (section.included) semanticSequence.push(...section.body_paragraphs);
  semanticSequence.push(payload.personal_seal.motto);
  for (const section of payload.main_life_sections) if (section.included) semanticSequence.push(...section.body_paragraphs);
  for (const contribution of payload.special_contributions) semanticSequence.push(...contribution.body_paragraphs);

  let cursor = 0;
  for (const semanticText of semanticSequence) {
    const at = text.indexOf(semanticText, cursor);
    if (at < 0) fail('SEMANTIC_PRESERVATION_FAILED', 'Semantic text was changed, dropped, merged or reordered.');
    cursor = at + semanticText.length;
  }
  const expectedCounts = new Map();
  for (const semanticText of semanticSequence) expectedCounts.set(semanticText, (expectedCounts.get(semanticText) || 0) + 1);
  for (const [semanticText, expectedCount] of expectedCounts) {
    if (countOccurrence(text, semanticText) !== expectedCount) fail('SEMANTIC_PRESERVATION_FAILED', 'Semantic text was duplicated or rewritten.');
  }
  const digest = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  if (digest !== result.canonical_markdown_sha256) fail('RENDER_HASH_MISMATCH', 'Canonical Markdown hash mismatch.');
  return true;
}

function renderCanonicalNatal(bindingInput, semanticPayload) {
  const { evidenceMap, availability } = validateBindingInput(bindingInput);
  const envelope = makeValidatedEnvelope(semanticPayload, evidenceMap, availability);
  const result = buildCanonicalRender(envelope, availability);
  assertCanonicalPostconditions(result, envelope.semantic_payload);
  return result;
}

module.exports = {
  RENDERER_ID,
  RENDERER_VERSION,
  FIRST_CALIBRATION,
  SECOND_CALIBRATION,
  RETURN_TO_USER_INTENT,
  RendererError,
  ElementVisualError,
  ContractValidationError,
  SchemaValidationError,
  renderCanonicalNatal,
  assertCanonicalPostconditions
};
