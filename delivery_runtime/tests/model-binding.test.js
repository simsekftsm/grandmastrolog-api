'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ContractValidationError,
  validateBindingInput,
  makeValidatedEnvelope
} = require('../lib/natal-contract');
const { canonicalizeModelPayload } = require('../lib/model-binding');
const { bindingInput, validPayload } = require('./helpers');

function context() {
  const binding = bindingInput();
  const { evidenceMap, availability } = validateBindingInput(binding);
  return { binding, evidenceMap, availability };
}

test('model binding discards content for server-excluded prelude and optional sections', () => {
  const { evidenceMap, availability } = context();
  const payload = validPayload();
  payload.prelude.included = true;
  payload.prelude.body_paragraphs = ['Bu içerik görünmemeli.'];
  payload.prelude.hat_evidence_refs = ['ev_ayin_gokyuzu_haritasi'];
  const optional = payload.pre_seal_sections.find((x) => x.section_id === 'element_dengen');
  optional.included = true;
  optional.body_paragraphs = ['Bu da görünmemeli.'];
  optional.hat_evidence_refs = ['ev_element_dengen'];

  const canonical = canonicalizeModelPayload(payload, evidenceMap, availability);
  assert.equal(canonical.prelude.included, false);
  assert.deepEqual(canonical.prelude.body_paragraphs, []);
  assert.deepEqual(canonical.prelude.hat_evidence_refs, []);
  const canonicalOptional = canonical.pre_seal_sections.find((x) => x.section_id === 'element_dengen');
  assert.equal(canonicalOptional.included, false);
  assert.deepEqual(canonicalOptional.body_paragraphs, []);
  assert.deepEqual(canonicalOptional.hat_evidence_refs, []);
  assert.doesNotThrow(() => makeValidatedEnvelope(canonical, evidenceMap, availability));
});

test('model binding restores placements exactly from verified server evidence', () => {
  const { evidenceMap, availability } = context();
  const payload = validPayload();
  payload.natal_placements[0].sign = 'Yanlış';
  payload.natal_placements[0].degree = '99°99′';
  payload.natal_placements[0].evidence_id = 'invented';

  const canonical = canonicalizeModelPayload(payload, evidenceMap, availability);
  const sunEvidence = evidenceMap.get('ev_sun');
  assert.equal(canonical.natal_placements[0].point_id, 'sun');
  assert.equal(canonical.natal_placements[0].sign, sunEvidence.sign);
  assert.equal(canonical.natal_placements[0].degree, sunEvidence.degree);
  assert.equal(canonical.natal_placements[0].evidence_id, 'ev_sun');
  assert.doesNotThrow(() => makeValidatedEnvelope(canonical, evidenceMap, availability));
});

test('model binding forces Sun and Ascendant provenance on the personal seal', () => {
  const { evidenceMap, availability } = context();
  const payload = validPayload();
  payload.personal_seal.evidence_refs = ['ev_moon', 'invented'];

  const canonical = canonicalizeModelPayload(payload, evidenceMap, availability);
  assert.equal(canonical.personal_seal.evidence_refs.includes('ev_sun'), true);
  assert.equal(canonical.personal_seal.evidence_refs.includes('ev_ascendant'), true);
  assert.equal(canonical.personal_seal.evidence_refs.includes('invented'), false);
  assert.doesNotThrow(() => makeValidatedEnvelope(canonical, evidenceMap, availability));
});

test('model binding never repairs unsafe semantic prose', () => {
  const { evidenceMap, availability } = context();
  const payload = validPayload();
  payload.pre_seal_sections[0].body_paragraphs = ['> *Hat: unsafe*'];

  const canonical = canonicalizeModelPayload(payload, evidenceMap, availability);
  assert.throws(
    () => makeValidatedEnvelope(canonical, evidenceMap, availability),
    (error) => error instanceof ContractValidationError && error.code === 'MARKDOWN_ESCAPE'
  );
});
