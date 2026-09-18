'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { schema } = require('../lib/natal-contract');
const { GROQ_MAX_OUTPUT_TOKENS, groqGenerationFormat, groqModelInstructions } = require('../lib/groq-binding');
const { evidenceCatalog, availability } = require('./helpers');

test('Groq generation format is strict and forces non-empty fixed semantic slots', () => {
  const format = groqGenerationFormat(evidenceCatalog(), availability());
  assert.equal(format.type, 'json_schema');
  assert.equal(format.strict, true);
  assert.equal(format.name, 'gm_natal_semantic_v1_groq_generation');
  assert.equal(format.schema.$defs.prelude.properties.body_paragraphs.minItems, 1);
  assert.equal(format.schema.$defs.prelude.properties.hat_evidence_refs.minItems, 1);
  assert.equal(format.schema.$defs.section.properties.body_paragraphs.minItems, 1);
  assert.equal(format.schema.$defs.section.properties.hat_evidence_refs.minItems, 1);
  assert.equal(GROQ_MAX_OUTPUT_TOKENS, 4608);
});

test('Groq generation constraints do not mutate the canonical downstream schema', () => {
  groqGenerationFormat(evidenceCatalog(), availability());
  assert.equal(schema.$defs.prelude.properties.body_paragraphs.minItems, undefined);
  assert.equal(schema.$defs.prelude.properties.hat_evidence_refs.minItems, undefined);
  assert.equal(schema.$defs.section.properties.body_paragraphs.minItems, undefined);
  assert.equal(schema.$defs.section.properties.hat_evidence_refs.minItems, undefined);
  assert.equal(schema.properties.special_contributions.minItems, undefined);
  assert.equal(schema.properties.special_contributions.maxItems, 11);
});

test('Groq special contribution cardinality is derived exactly from server availability', () => {
  const av = availability({ jyotish: true, lilith: true });
  const format = groqGenerationFormat(evidenceCatalog(), av);
  assert.equal(format.schema.properties.special_contributions.minItems, 2);
  assert.equal(format.schema.properties.special_contributions.maxItems, 2);
  assert.deepEqual(format.schema.$defs.specialContribution.properties.contribution_id.enum, ['jyotish', 'lilith']);
});

test('Groq evidence-reference enums contain only verified input evidence ids', () => {
  const evidence = evidenceCatalog();
  evidence.push({
    evidence_id: 'ev_unverified_probe', source_ref: 'probe://unverified', kind: 'indicator',
    subject_id: 'probe', semantic_value: 'probe', sign: '', degree: '', house: '',
    retrograde: false, verification_state: 'unverified'
  });
  const format = groqGenerationFormat(evidence, availability());
  const enumValues = format.schema.$defs.section.properties.hat_evidence_refs.items.enum;
  assert.equal(enumValues.includes('ev_sun'), true);
  assert.equal(enumValues.includes('ev_profilin'), true);
  assert.equal(enumValues.includes('ev_unverified_probe'), false);
  assert.equal(new Set(enumValues).size, enumValues.length);
});

test('Groq instructions declare server ownership and verified evidence boundary', () => {
  const text = groqModelInstructions(availability(), evidenceCatalog());
  assert.match(text, /server-owned/);
  assert.match(text, /Use only VERIFIED_EVIDENCE ids/);
  assert.match(text, /excluded candidate content will be discarded by the server/);
});
