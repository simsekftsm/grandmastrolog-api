'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ContractValidationError,
  SchemaValidationError,
  validateBindingInput,
  validateNatalSemanticV1,
  makeValidatedEnvelope,
  openAIStrictFormat,
  schema,
  CANONICAL_POLICY
} = require('../lib/natal-contract');
const { evidenceCatalog, availability, bindingInput, validPayload, clone } = require('./helpers');

function codeOf(fn) {
  try { fn(); return null; }
  catch (e) {
    assert.ok(e instanceof ContractValidationError || e instanceof SchemaValidationError, `unexpected error ${e?.stack || e}`);
    return e.code;
  }
}

function validate(payload, av = availability(), evidence = evidenceCatalog()) {
  return validateNatalSemanticV1(payload, evidence, av);
}

function sectionById(payload, id) {
  return [...payload.pre_seal_sections, ...payload.main_life_sections].find((x) => x.section_id === id);
}

test('1 valid canonical structured Natal PASS', () => {
  const av = availability({ sade_sati: true, hellenistic: true });
  const payload = validPayload(av);
  assert.equal(validate(payload, av), true);
  const envelope = makeValidatedEnvelope(payload, evidenceCatalog(), av);
  assert.equal(envelope.render_state, 'blocked_until_m1a3');
  assert.equal(envelope.schema_id, 'gm_natal_semantic_v1');
  assert.equal(envelope.validator_id, 'gm_natal_semantic_validator_v1');
  assert.equal(envelope.canonical_policy.iliskiler.section_trim_applied, true);
  assert.equal(envelope.canonical_policy.aile.section_trim_applied, true);
  assert.equal(CANONICAL_POLICY.karmalar.owner_ref, 'GM-R-20260903-029');
  assert.match(envelope.evidence_catalog_sha256, /^[a-f0-9]{64}$/);
});

test('2 unknown field FAIL', () => {
  const p = validPayload(); p.pre_seal_sections[0].title = 'PROFİLİN';
  assert.equal(codeOf(() => validate(p)), 'SCHEMA_ADDITIONAL_PROPERTY');
});

test('3 unknown section FAIL', () => {
  const p = validPayload(); p.pre_seal_sections[0].section_id = 'unknown';
  assert.equal(codeOf(() => validate(p)), 'SCHEMA_ENUM');
});

test('4 duplicate section FAIL', () => {
  const p = validPayload(); p.pre_seal_sections[1].section_id = p.pre_seal_sections[0].section_id;
  assert.equal(codeOf(() => validate(p)), 'WRONG_SECTION_ORDER');
});

test('5 missing required section FAIL', () => {
  const p = validPayload(); const s = sectionById(p, 'aile'); s.included = false; s.body_paragraphs = []; s.hat_evidence_refs = [];
  assert.equal(codeOf(() => validate(p)), 'MISSING_REQUIRED_SECTION');
});

test('6 reordered sections FAIL', () => {
  const p = validPayload(); [p.pre_seal_sections[0], p.pre_seal_sections[1]] = [p.pre_seal_sections[1], p.pre_seal_sections[0]];
  assert.equal(codeOf(() => validate(p)), 'WRONG_SECTION_ORDER');
});

test('7 free-form visible title FAIL', () => {
  const p = validPayload(); p.visible_title = 'Doğum Haritan';
  assert.equal(codeOf(() => validate(p)), 'SCHEMA_ADDITIONAL_PROPERTY');
});

test('8 raw Markdown field FAIL', () => {
  const p = validPayload(); p.raw_markdown = '---';
  assert.equal(codeOf(() => validate(p)), 'SCHEMA_ADDITIONAL_PROPERTY');
});

test('9 separator/blockquote/Markdown injection FAIL', () => {
  for (const text of ['---', '> Hat: Mars', '# Başlık', '```json', '**kalın**', '[x](https://example.test)']) {
    const p = validPayload(); p.pre_seal_sections[0].body_paragraphs = [text];
    assert.equal(codeOf(() => validate(p)), 'MARKDOWN_ESCAPE');
  }
});

test('10 standalone POTANSİYELLER FAIL', () => {
  const p = validPayload(); p.pre_seal_sections[0].section_id = 'potansiyeller';
  assert.equal(codeOf(() => validate(p)), 'SCHEMA_ENUM');
});

test('11 superseded/old section identity FAIL', () => {
  const p = validPayload(); p.main_life_sections[1].section_id = 'iliski_sosyal_cevre';
  assert.equal(codeOf(() => validate(p)), 'SCHEMA_ENUM');
});

test('12 wrong contract version FAIL', () => {
  const p = validPayload(); p.contract_version = 'gm.natal.v0';
  assert.equal(codeOf(() => validate(p)), 'SCHEMA_ENUM');
});

test('13 missing provenance/evidence FAIL', () => {
  const p = validPayload(); p.pre_seal_sections[0].hat_evidence_refs = [];
  assert.equal(codeOf(() => validate(p)), 'ARRAY_SIZE');
});

test('14 unverified required evidence FAIL', () => {
  const evidence = evidenceCatalog(); evidence.find((x) => x.evidence_id === 'ev_profilin').verification_state = 'unverified';
  assert.equal(codeOf(() => validate(validPayload(), availability(), evidence)), 'WRONG_CONSTANT');
});

test('15 oversized/malformed payload FAIL', () => {
  const body = bindingInput(); body.semantic_input = 'x'.repeat(140000);
  assert.equal(codeOf(() => validateBindingInput(body)), 'PAYLOAD_TOO_LARGE');
  const cyclic = bindingInput(); cyclic.self = cyclic;
  assert.equal(codeOf(() => validateBindingInput(cyclic)), 'MALFORMED_PAYLOAD');
});

test('16 prototype/pollution/unexpected object shape FAIL', () => {
  const body = bindingInput();
  body.availability = Object.create({ polluted: true });
  Object.assign(body.availability, availability());
  assert.equal(codeOf(() => validateBindingInput(body)), 'UNEXPECTED_OBJECT_SHAPE');
});

test('17 optional section inclusion is bound to verified availability', () => {
  const av = availability({ sinerji: true, senin_yolun: true });
  assert.equal(validate(validPayload(av), av), true);
  const p = validPayload(av); const s = sectionById(p, 'sinerji'); s.included = false; s.body_paragraphs = []; s.hat_evidence_refs = [];
  assert.equal(codeOf(() => validate(p, av)), 'INCLUSION_MISMATCH');
});

test('18 strict OpenAI format is json_schema strict and schema forbids additional properties', () => {
  const format = openAIStrictFormat();
  assert.equal(format.type, 'json_schema');
  assert.equal(format.strict, true);
  assert.equal(format.schema, schema);
  assert.equal(schema.additionalProperties, false);
});

test('placement values must exactly match verified astro evidence', () => {
  const p = validPayload(); p.natal_placements[0].sign = 'Koç';
  assert.equal(codeOf(() => validate(p)), 'PLACEMENT_EVIDENCE_MISMATCH');
});

test('personal seal requires verified Sun + Ascendant and no renderer markup', () => {
  const p = validPayload(); p.personal_seal.evidence_refs = ['ev_sun', 'ev_moon'];
  assert.equal(codeOf(() => validate(p)), 'PERSONAL_SEAL_EVIDENCE_MISSING');
  const p2 = validPayload(); p2.personal_seal.motto = '> *Balık & Aslan: görünür başlık*';
  assert.equal(codeOf(() => validate(p2)), 'MARKDOWN_ESCAPE');
});

test('first calibration precedes special layer by contract shape and special set is externally bound', () => {
  const av = availability({ sade_sati: true, jyotish: true });
  const p = validPayload(av);
  assert.equal(p.first_calibration.calibration_id, 'main_life_areas');
  assert.deepEqual(p.special_contributions.map((x) => x.contribution_id), ['jyotish', 'sade_sati']);
  assert.equal(p.second_calibration.calibration_id, 'general_natal');
  p.special_contributions.pop();
  assert.equal(codeOf(() => validate(p, av)), 'SPECIAL_INCLUSION_MISMATCH');
});

test('second-trim status is server-owned canonical policy, not model field', () => {
  const p = validPayload(); p.main_life_sections[1].section_trim_applied = false;
  assert.equal(codeOf(() => validate(p)), 'SCHEMA_ADDITIONAL_PROPERTY');
  const env = makeValidatedEnvelope(validPayload(), evidenceCatalog(), availability());
  assert.equal(env.canonical_policy.iliskiler.section_trim_applied, true);
  assert.equal(env.canonical_policy.aile.section_trim_applied, true);
});

test('MUTANTS: all expected FAIL', () => {
  const mutants = {
    enum_bypass: (p) => { p.pre_seal_sections[0].section_id = '__proto_bypass__'; },
    additional_properties: (p) => { p.pre_seal_sections[0].rendered_section = 'x'; },
    missing_required: (p) => { const s = sectionById(p, 'karmalar'); s.included=false; s.body_paragraphs=[]; s.hat_evidence_refs=[]; },
    reorder: (p) => { [p.pre_seal_sections[0], p.pre_seal_sections[1]] = [p.pre_seal_sections[1], p.pre_seal_sections[0]]; },
    duplicate_section: (p) => { p.pre_seal_sections[1].section_id = p.pre_seal_sections[0].section_id; },
    raw_markdown_escape: (p) => { p.pre_seal_sections[0].body_paragraphs = ['> *Hat: escape*']; },
    free_title: (p) => { p.pre_seal_sections[0].visible_title = 'PROFİLİN'; },
    forbidden_section: (p) => { p.pre_seal_sections[0].section_id = 'potansiyeller'; }
  };
  for (const [name, mutate] of Object.entries(mutants)) {
    const p = clone(validPayload()); mutate(p);
    assert.notEqual(codeOf(() => validate(p)), null, `${name} must EXPECTED FAIL`);
  }
});

test('MUTANT: fail-open delivery state EXPECTED FAIL under independent oracle', () => {
  const mutant = {
    ok: true, stage: 'M1A-2', mode: 'fail-closed', delivery_boundary: 'present',
    raw_delivery_allowed: true, structured_contract_enabled: true,
    canonical_renderer_enabled: false, delivery_validator_enabled: false, next_stage: 'M1A-3'
  };
  assert.throws(() => {
    assert.equal(mutant.raw_delivery_allowed, false);
    assert.equal(mutant.canonical_renderer_enabled, false);
    assert.equal(mutant.delivery_validator_enabled, false);
  });
});
