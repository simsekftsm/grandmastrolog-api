'use strict';

const crypto = require('node:crypto');
const schema = require('../contracts/gm-natal-semantic-v1.schema.json');
const { SchemaValidationError, validateAgainstSchema } = require('./schema-runtime');

const CONTRACT_VERSION = 'gm.natal.v1';
const SCHEMA_ID = 'gm_natal_semantic_v1';
const SCHEMA_VERSION = '1.0.0';
const VALIDATOR_ID = 'gm_natal_semantic_validator_v1';
const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_MODEL_TEXT_BYTES = 128 * 1024;

const PLACEMENT_ORDER = Object.freeze([
  'sun', 'moon', 'ascendant', 'mercury', 'venus', 'mars', 'jupiter',
  'saturn', 'uranus', 'neptune', 'pluto', 'north_node', 'mc'
]);

const PRE_SEAL_SECTION_ORDER = Object.freeze([
  'profilin', 'haritanin_ozu', 'element_dengen', 'sinerji', 'senin_yolun'
]);

const MAIN_LIFE_SECTION_ORDER = Object.freeze([
  'para_kariyer', 'iliskiler', 'aile', 'karmalar'
]);

const REQUIRED_SECTIONS = new Set([
  'profilin', 'haritanin_ozu', 'para_kariyer', 'iliskiler', 'aile', 'karmalar'
]);

const OPTIONAL_SECTION_AVAILABILITY = Object.freeze({
  element_dengen: 'element_dengen',
  sinerji: 'sinerji',
  senin_yolun: 'senin_yolun'
});

const SPECIAL_ORDER = Object.freeze([
  'hellenistic', 'jyotish', 'esoteric', 'sade_sati', 'rahu_ketu', 'retrogrades',
  'lilith', 'chiron', 'vertex', 'part_of_fortune', 'fixed_stars'
]);

const AVAILABILITY_KEYS = Object.freeze([
  'ayin_gokyuzu_haritasi', 'element_dengen', 'sinerji', 'senin_yolun', ...SPECIAL_ORDER
]);

const CANONICAL_POLICY = Object.freeze({
  prelude: { owner_ref: 'GM-R-20260903-010', exact_lock: true, section_trim_applied: false },
  profilin: { owner_ref: 'GM-R-20260903-011', exact_lock: true, section_trim_applied: false },
  haritanin_ozu: { owner_ref: 'GM-R-20260903-014', exact_lock: true, section_trim_applied: false },
  element_dengen: { owner_ref: 'GM-R-20260903-015', exact_lock: true, section_trim_applied: false },
  sinerji: { owner_ref: 'GM-R-20260903-018', exact_lock: true, section_trim_applied: false },
  senin_yolun: { owner_ref: 'GM-R-20260903-022', exact_lock: true, section_trim_applied: false },
  personal_seal: { owner_ref: '12_GM_GORUNUR_DIL_VE_RENDERER', exact_lock: true, section_trim_applied: false },
  para_kariyer: { owner_ref: 'GM-R-20260903-024', exact_lock: true, section_trim_applied: false },
  iliskiler: { owner_ref: 'GM-R-20260903-025', exact_lock: true, section_trim_applied: true },
  aile: { owner_ref: 'GM-R-20260903-026', exact_lock: true, section_trim_applied: true },
  karmalar: { owner_ref: 'GM-R-20260903-029', exact_lock: true, section_trim_applied: false },
  first_calibration: { owner_ref: '12_GM_GORUNUR_DIL_VE_RENDERER', exact_lock: true, section_trim_applied: false },
  special_contributions: { owner_ref: '12_GM_GORUNUR_DIL_VE_RENDERER/38_GM_ILERI_TEKNIK_SECIM_BANKASI', exact_lock: false, section_trim_applied: false },
  second_calibration: { owner_ref: '12_GM_GORUNUR_DIL_VE_RENDERER', exact_lock: true, section_trim_applied: false },
  return_identity: { owner_ref: '12_GM_GORUNUR_DIL_VE_RENDERER', exact_lock: true, section_trim_applied: false }
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MARKDOWN_ESCAPE = /(^|\n)\s{0,3}(?:#{1,6}(?:\s|$)|>(?:\s|$)|[-+*]\s+|\d+[.)]\s+|---\s*(?:\n|$)|```|~~~)|\*\*|__|`|\]\s*\(|<\/?[A-Za-z][^>]*>|\*Hat\s*:/;

class ContractValidationError extends Error {
  constructor(code, message, path = '$') {
    super(message);
    this.name = 'ContractValidationError';
    this.code = code;
    this.path = path;
  }
}

function fail(code, message, path) {
  throw new ContractValidationError(code, message, path);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertPlainObject(value, path) {
  if (!isPlainObject(value)) fail('UNEXPECTED_OBJECT_SHAPE', 'Expected a plain object.', path);
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) fail('PROTOTYPE_POLLUTION_KEY', `Forbidden key: ${key}`, `${path}.${key}`);
  }
}

function assertExactKeys(obj, keys, path) {
  assertPlainObject(obj, path);
  const allowed = new Set(keys);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) fail('UNKNOWN_FIELD', `Unknown field: ${key}`, `${path}.${key}`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) fail('MISSING_REQUIRED_FIELD', `Missing required field: ${key}`, `${path}.${key}`);
  }
}

function assertString(value, path, { min = 0, max = Infinity, constant, allowed } = {}) {
  if (typeof value !== 'string') fail('TYPE_MISMATCH', 'Expected string.', path);
  if (value.length < min || value.length > max) fail('STRING_SIZE', 'String length outside contract bounds.', path);
  if (constant !== undefined && value !== constant) fail('WRONG_CONSTANT', `Expected ${constant}.`, path);
  if (allowed && !allowed.includes(value)) fail('UNKNOWN_ENUM', `Unknown enum value: ${value}`, path);
}

function assertBoolean(value, path, constant) {
  if (typeof value !== 'boolean') fail('TYPE_MISMATCH', 'Expected boolean.', path);
  if (constant !== undefined && value !== constant) fail('WRONG_CONSTANT', `Expected ${constant}.`, path);
}

function assertArray(value, path, { min = 0, max = Infinity } = {}) {
  if (!Array.isArray(value)) fail('TYPE_MISMATCH', 'Expected array.', path);
  if (value.length < min || value.length > max) fail('ARRAY_SIZE', 'Array size outside contract bounds.', path);
}

function assertNoMarkdown(text, path) {
  if (MARKDOWN_ESCAPE.test(text)) fail('MARKDOWN_ESCAPE', 'Semantic content contains visible Markdown/layout syntax.', path);
}

function assertSemanticTextArray(value, path, maxItems, maxLength, minItems = 0) {
  assertArray(value, path, { min: minItems, max: maxItems });
  value.forEach((text, i) => {
    assertString(text, `${path}[${i}]`, { min: 1, max: maxLength });
    assertNoMarkdown(text, `${path}[${i}]`);
  });
}

function normalizeVerifiedEvidence(input) {
  assertArray(input, '$.verified_evidence', { min: 13, max: 256 });
  const map = new Map();
  const exactKeys = [
    'evidence_id', 'source_ref', 'kind', 'subject_id', 'semantic_value',
    'sign', 'degree', 'house', 'retrograde', 'verification_state'
  ];
  input.forEach((item, i) => {
    const path = `$.verified_evidence[${i}]`;
    assertExactKeys(item, exactKeys, path);
    assertString(item.evidence_id, `${path}.evidence_id`, { min: 1, max: 96 });
    assertString(item.source_ref, `${path}.source_ref`, { min: 1, max: 256 });
    assertString(item.kind, `${path}.kind`, { allowed: ['placement', 'indicator'] });
    assertString(item.subject_id, `${path}.subject_id`, { min: 1, max: 96 });
    assertString(item.semantic_value, `${path}.semantic_value`, { min: 1, max: 512 });
    assertNoMarkdown(item.semantic_value, `${path}.semantic_value`);
    assertString(item.sign, `${path}.sign`, { max: 48 });
    assertString(item.degree, `${path}.degree`, { max: 32 });
    assertString(item.house, `${path}.house`, { max: 32 });
    assertBoolean(item.retrograde, `${path}.retrograde`);
    assertString(item.verification_state, `${path}.verification_state`, { constant: 'verified' });
    if (map.has(item.evidence_id)) fail('DUPLICATE_EVIDENCE_ID', 'Duplicate evidence_id.', `${path}.evidence_id`);
    map.set(item.evidence_id, item);
  });
  return map;
}

function validateAvailability(availability) {
  assertExactKeys(availability, AVAILABILITY_KEYS, '$.availability');
  AVAILABILITY_KEYS.forEach((key) => assertBoolean(availability[key], `$.availability.${key}`));
  return availability;
}

function validateBindingInput(body) {
  let serialized;
  try { serialized = JSON.stringify(body ?? {}); }
  catch { fail('MALFORMED_PAYLOAD', 'Request cannot be serialized.', '$'); }
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > MAX_REQUEST_BYTES) fail('PAYLOAD_TOO_LARGE', 'Request exceeds M1A-2 payload limit.', '$');
  assertExactKeys(body, ['request_id', 'semantic_input', 'availability', 'verified_evidence'], '$');
  assertString(body.request_id, '$.request_id', { min: 1, max: 96 });
  assertString(body.semantic_input, '$.semantic_input', { min: 1, max: 12000 });
  assertNoMarkdown(body.semantic_input, '$.semantic_input');
  const availability = validateAvailability(body.availability);
  const evidenceMap = normalizeVerifiedEvidence(body.verified_evidence);
  return { evidenceMap, availability };
}

function assertEvidenceRefs(refs, path, evidenceMap, { min = 0, max = 32 } = {}) {
  assertArray(refs, path, { min, max });
  const seen = new Set();
  refs.forEach((ref, i) => {
    assertString(ref, `${path}[${i}]`, { min: 1, max: 96 });
    if (seen.has(ref)) fail('DUPLICATE_EVIDENCE_REF', 'Duplicate evidence reference.', `${path}[${i}]`);
    seen.add(ref);
    const evidence = evidenceMap.get(ref);
    if (!evidence) fail('MALFORMED_EVIDENCE_LINK', 'Evidence reference is not present in the verified catalog.', `${path}[${i}]`);
    if (evidence.verification_state !== 'verified') fail('UNVERIFIED_EVIDENCE', 'Evidence is not verified.', `${path}[${i}]`);
  });
}

function validatePrelude(prelude, availability, evidenceMap) {
  const path = '$.prelude';
  assertExactKeys(prelude, ['section_id', 'included', 'body_paragraphs', 'hat_evidence_refs'], path);
  assertString(prelude.section_id, `${path}.section_id`, { constant: 'ayin_gokyuzu_haritasi' });
  assertBoolean(prelude.included, `${path}.included`);
  if (prelude.included !== availability.ayin_gokyuzu_haritasi) fail('INCLUSION_MISMATCH', 'Monthly prelude inclusion does not match verified availability.', `${path}.included`);
  assertSemanticTextArray(prelude.body_paragraphs, `${path}.body_paragraphs`, 8, 1200, prelude.included ? 1 : 0);
  assertEvidenceRefs(prelude.hat_evidence_refs, `${path}.hat_evidence_refs`, evidenceMap, { min: prelude.included ? 1 : 0, max: 24 });
  if (!prelude.included && (prelude.body_paragraphs.length || prelude.hat_evidence_refs.length)) fail('EXCLUDED_SECTION_HAS_CONTENT', 'Excluded prelude must be empty.', path);
}

function validatePlacements(placements, evidenceMap) {
  assertArray(placements, '$.natal_placements', { min: 13, max: 13 });
  const seen = new Set();
  placements.forEach((placement, i) => {
    const path = `$.natal_placements[${i}]`;
    assertExactKeys(placement, ['point_id', 'sign', 'degree', 'house', 'retrograde', 'evidence_id'], path);
    assertString(placement.point_id, `${path}.point_id`, { allowed: PLACEMENT_ORDER });
    if (placement.point_id !== PLACEMENT_ORDER[i]) fail('WRONG_PLACEMENT_ORDER', 'Natal placement order is not canonical.', `${path}.point_id`);
    if (seen.has(placement.point_id)) fail('DUPLICATE_PLACEMENT', 'Duplicate natal placement.', `${path}.point_id`);
    seen.add(placement.point_id);
    assertString(placement.sign, `${path}.sign`, { min: 1, max: 48 });
    assertString(placement.degree, `${path}.degree`, { min: 1, max: 32 });
    assertString(placement.house, `${path}.house`, { max: 32 });
    assertBoolean(placement.retrograde, `${path}.retrograde`);
    assertString(placement.evidence_id, `${path}.evidence_id`, { min: 1, max: 96 });
    const evidence = evidenceMap.get(placement.evidence_id);
    if (!evidence || evidence.kind !== 'placement' || evidence.verification_state !== 'verified') {
      fail('UNVERIFIED_PLACEMENT_EVIDENCE', 'Placement must bind to verified placement evidence.', `${path}.evidence_id`);
    }
    if (evidence.subject_id !== placement.point_id || evidence.sign !== placement.sign || evidence.degree !== placement.degree || evidence.house !== placement.house || evidence.retrograde !== placement.retrograde) {
      fail('PLACEMENT_EVIDENCE_MISMATCH', 'Placement does not exactly match verified evidence.', path);
    }
  });
}

function validateSectionArray(sections, expectedOrder, path, availability, evidenceMap) {
  assertArray(sections, path, { min: expectedOrder.length, max: expectedOrder.length });
  const seen = new Set();
  sections.forEach((section, i) => {
    const spath = `${path}[${i}]`;
    assertExactKeys(section, ['section_id', 'included', 'body_paragraphs', 'hat_evidence_refs'], spath);
    assertString(section.section_id, `${spath}.section_id`, { allowed: [...PRE_SEAL_SECTION_ORDER, ...MAIN_LIFE_SECTION_ORDER] });
    if (section.section_id !== expectedOrder[i]) fail('WRONG_SECTION_ORDER', 'Section order is not canonical.', `${spath}.section_id`);
    if (seen.has(section.section_id)) fail('DUPLICATE_SECTION', 'Duplicate section.', `${spath}.section_id`);
    seen.add(section.section_id);
    assertBoolean(section.included, `${spath}.included`);
    if (REQUIRED_SECTIONS.has(section.section_id) && !section.included) fail('MISSING_REQUIRED_SECTION', 'Required section cannot be omitted.', `${spath}.included`);
    if (OPTIONAL_SECTION_AVAILABILITY[section.section_id]) {
      const expected = availability[OPTIONAL_SECTION_AVAILABILITY[section.section_id]];
      if (section.included !== expected) fail('INCLUSION_MISMATCH', 'Optional section inclusion does not match verified availability.', `${spath}.included`);
    }
    assertSemanticTextArray(section.body_paragraphs, `${spath}.body_paragraphs`, 14, 1600, section.included ? 1 : 0);
    assertEvidenceRefs(section.hat_evidence_refs, `${spath}.hat_evidence_refs`, evidenceMap, { min: section.included ? 1 : 0, max: 32 });
    if (!section.included && (section.body_paragraphs.length || section.hat_evidence_refs.length)) fail('EXCLUDED_SECTION_HAS_CONTENT', 'Excluded section must be empty.', spath);
  });
}

function validatePersonalSeal(seal, evidenceMap) {
  const path = '$.personal_seal';
  assertExactKeys(seal, ['seal_id', 'included', 'motto', 'evidence_refs'], path);
  assertString(seal.seal_id, `${path}.seal_id`, { constant: 'sun_asc_personal_seal' });
  assertBoolean(seal.included, `${path}.included`, true);
  assertString(seal.motto, `${path}.motto`, { min: 1, max: 320 });
  assertNoMarkdown(seal.motto, `${path}.motto`);
  assertEvidenceRefs(seal.evidence_refs, `${path}.evidence_refs`, evidenceMap, { min: 2, max: 12 });
  const subjects = new Set(seal.evidence_refs.map((id) => evidenceMap.get(id)?.subject_id));
  if (!subjects.has('sun') || !subjects.has('ascendant')) fail('PERSONAL_SEAL_EVIDENCE_MISSING', 'Personal seal requires verified Sun and Ascendant evidence.', `${path}.evidence_refs`);
}

function validateCalibration(item, path, expectedId) {
  assertExactKeys(item, ['calibration_id', 'required'], path);
  assertString(item.calibration_id, `${path}.calibration_id`, { constant: expectedId });
  assertBoolean(item.required, `${path}.required`, true);
}

function validateSpecialContributions(items, availability, evidenceMap) {
  const path = '$.special_contributions';
  assertArray(items, path, { max: SPECIAL_ORDER.length });
  const expected = SPECIAL_ORDER.filter((id) => availability[id]);
  if (items.length !== expected.length) fail('SPECIAL_INCLUSION_MISMATCH', 'Special contribution set does not match verified availability.', path);
  items.forEach((item, i) => {
    const ipath = `${path}[${i}]`;
    assertExactKeys(item, ['contribution_id', 'body_paragraphs', 'evidence_refs'], ipath);
    assertString(item.contribution_id, `${ipath}.contribution_id`, { allowed: SPECIAL_ORDER });
    if (item.contribution_id !== expected[i]) fail('WRONG_SPECIAL_ORDER', 'Special contribution order/set is not canonical for verified availability.', `${ipath}.contribution_id`);
    assertSemanticTextArray(item.body_paragraphs, `${ipath}.body_paragraphs`, 8, 1200, 1);
    assertEvidenceRefs(item.evidence_refs, `${ipath}.evidence_refs`, evidenceMap, { min: 1, max: 24 });
  });
}

function validateMetadata(meta) {
  const path = '$.validation_metadata';
  assertExactKeys(meta, ['schema_id', 'schema_version', 'evidence_policy', 'visible_markup_owner'], path);
  assertString(meta.schema_id, `${path}.schema_id`, { constant: SCHEMA_ID });
  assertString(meta.schema_version, `${path}.schema_version`, { constant: SCHEMA_VERSION });
  assertString(meta.evidence_policy, `${path}.evidence_policy`, { constant: 'verified_only' });
  assertString(meta.visible_markup_owner, `${path}.visible_markup_owner`, { constant: 'm1a3_deterministic_renderer' });
}

function validateNatalSemanticV1(payload, verifiedEvidence, availability) {
  let serialized;
  try { serialized = JSON.stringify(payload ?? {}); }
  catch { fail('MALFORMED_PAYLOAD', 'Structured payload cannot be serialized.', '$'); }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_MODEL_TEXT_BYTES) fail('PAYLOAD_TOO_LARGE', 'Structured payload exceeds M1A-2 model-output limit.', '$');
  validateAgainstSchema(payload, schema);
  const evidenceMap = verifiedEvidence instanceof Map ? verifiedEvidence : normalizeVerifiedEvidence(verifiedEvidence);
  validateAvailability(availability);
  assertExactKeys(payload, [
    'contract_version', 'response_id', 'opening_id', 'prelude', 'natal_placements',
    'pre_seal_sections', 'personal_seal', 'main_life_sections', 'first_calibration',
    'special_contributions', 'second_calibration', 'return_identity', 'validation_metadata'
  ], '$');
  assertString(payload.contract_version, '$.contract_version', { constant: CONTRACT_VERSION });
  assertString(payload.response_id, '$.response_id', { constant: 'initial_natal' });
  assertString(payload.opening_id, '$.opening_id', { constant: 'natal_first_pass' });
  validatePrelude(payload.prelude, availability, evidenceMap);
  validatePlacements(payload.natal_placements, evidenceMap);
  validateSectionArray(payload.pre_seal_sections, PRE_SEAL_SECTION_ORDER, '$.pre_seal_sections', availability, evidenceMap);
  validatePersonalSeal(payload.personal_seal, evidenceMap);
  validateSectionArray(payload.main_life_sections, MAIN_LIFE_SECTION_ORDER, '$.main_life_sections', availability, evidenceMap);
  validateCalibration(payload.first_calibration, '$.first_calibration', 'main_life_areas');
  validateSpecialContributions(payload.special_contributions, availability, evidenceMap);
  validateCalibration(payload.second_calibration, '$.second_calibration', 'general_natal');
  assertString(payload.return_identity, '$.return_identity', { constant: 'return_to_user_intent' });
  validateMetadata(payload.validation_metadata);
  return true;
}

function evidenceDigest(verifiedEvidence) {
  const list = verifiedEvidence instanceof Map ? [...verifiedEvidence.values()] : verifiedEvidence;
  const canonical = list.map((x) => ({
    evidence_id: x.evidence_id, source_ref: x.source_ref, kind: x.kind, subject_id: x.subject_id,
    semantic_value: x.semantic_value, sign: x.sign, degree: x.degree, house: x.house,
    retrograde: x.retrograde, verification_state: x.verification_state
  })).sort((a, b) => a.evidence_id.localeCompare(b.evidence_id));
  return crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

function collectUsedEvidenceRefs(payload) {
  const refs = new Set(payload.natal_placements.map((x) => x.evidence_id));
  payload.prelude.hat_evidence_refs.forEach((x) => refs.add(x));
  payload.pre_seal_sections.forEach((section) => section.hat_evidence_refs.forEach((x) => refs.add(x)));
  payload.personal_seal.evidence_refs.forEach((x) => refs.add(x));
  payload.main_life_sections.forEach((section) => section.hat_evidence_refs.forEach((x) => refs.add(x)));
  payload.special_contributions.forEach((item) => item.evidence_refs.forEach((x) => refs.add(x)));
  return refs;
}

function makeValidatedEnvelope(payload, verifiedEvidence, availability) {
  const evidenceMap = verifiedEvidence instanceof Map ? verifiedEvidence : normalizeVerifiedEvidence(verifiedEvidence);
  validateNatalSemanticV1(payload, evidenceMap, availability);
  const refs = collectUsedEvidenceRefs(payload);
  const bindings = [...refs].sort().map((id) => evidenceMap.get(id));
  return {
    contract_version: CONTRACT_VERSION,
    schema_id: SCHEMA_ID,
    validator_id: VALIDATOR_ID,
    canonical_policy: CANONICAL_POLICY,
    evidence_catalog_sha256: evidenceDigest(evidenceMap),
    semantic_payload: payload,
    evidence_bindings: bindings,
    render_state: 'blocked_until_m1a3'
  };
}

function openAIStrictFormat() {
  return {
    type: 'json_schema',
    name: SCHEMA_ID,
    description: 'GrandMastrolog initial Natal semantic payload. Plain semantic content only; no visible Markdown, headings, separators, blockquotes, Hat markup, or rendered layout.',
    schema,
    strict: true
  };
}

function modelInstructions(availability, verifiedEvidence) {
  const evidence = verifiedEvidence.map((item) => ({
    evidence_id: item.evidence_id, source_ref: item.source_ref, kind: item.kind,
    subject_id: item.subject_id, semantic_value: item.semantic_value, sign: item.sign,
    degree: item.degree, house: item.house, retrograde: item.retrograde,
    verification_state: item.verification_state
  }));
  return [
    'Produce only the strict structured GrandMastrolog Natal semantic object required by the supplied JSON schema.',
    'Do not output Markdown, visible headings, separators, blockquotes, Hat markup, rendered section titles, or layout strings.',
    'Use only evidence_id values from VERIFIED_EVIDENCE. Never invent, infer, or upgrade evidence.',
    `Pre-seal section order: ${PRE_SEAL_SECTION_ORDER.join(', ')}.`,
    'Then produce the personal seal semantic motto, without its visible Sun/Ascendant renderer shell.',
    `Main-life section order: ${MAIN_LIFE_SECTION_ORDER.join(', ')}.`,
    'Then first_calibration, then special_contributions, then second_calibration, then return_identity.',
    `Special contribution canonical order: ${SPECIAL_ORDER.join(', ')}; include exactly those marked true in AVAILABILITY.`,
    'Required sections must be included. Optional section inclusion must exactly match AVAILABILITY.',
    'POTANSİYELLER is forbidden as an independent section or contribution.',
    'Do not create a visible title field or raw/rendered Markdown field.',
    `AVAILABILITY=${JSON.stringify(availability)}`,
    `VERIFIED_EVIDENCE=${JSON.stringify(evidence)}`
  ].join('\n');
}

module.exports = {
  CONTRACT_VERSION, SCHEMA_ID, SCHEMA_VERSION, VALIDATOR_ID,
  MAX_REQUEST_BYTES, MAX_MODEL_TEXT_BYTES,
  PLACEMENT_ORDER, PRE_SEAL_SECTION_ORDER, MAIN_LIFE_SECTION_ORDER, SPECIAL_ORDER,
  AVAILABILITY_KEYS, CANONICAL_POLICY,
  ContractValidationError, SchemaValidationError, schema,
  validateBindingInput, validateNatalSemanticV1, makeValidatedEnvelope,
  openAIStrictFormat, modelInstructions
};
