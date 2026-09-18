'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeFormattingOnly,
  normalizeSemanticCandidate
} = require('../lib/semantic-normalizer');

test('semantic normalizer removes formatting-only markdown without lexical drift', () => {
  const before = '**Güçlü** ama `ölçülü` bir yaklaşım.';
  const after = normalizeFormattingOnly(before);
  assert.equal(after, 'Güçlü ama ölçülü bir yaklaşım.');
});

test('semantic normalizer strips line-level presentation markup only', () => {
  const before = '# Başlık\n> Cümle\n- Madde';
  const after = normalizeFormattingOnly(before);
  assert.equal(after, 'Başlık\nCümle\nMadde');
});

test('semantic normalizer leaves links and html untouched for downstream rejection', () => {
  const before = '[kaynak](https://example.com) <b>kalın</b>';
  assert.equal(normalizeFormattingOnly(before), before);
});

test('candidate normalizer touches only semantic prose fields', () => {
  const candidate = {
    prelude: { body_paragraphs: ['**A**'], hat_evidence_refs: ['ev_a'] },
    pre_seal_sections: [{ section_id:'profilin', body_paragraphs:['> B'], hat_evidence_refs:['ev_b'] }],
    personal_seal: { motto: '`C`' },
    main_life_sections: [{ section_id:'aile', body_paragraphs:['- D'], hat_evidence_refs:['ev_d'] }],
    special_contributions: [],
    untouched: '**must-stay**'
  };
  const result = normalizeSemanticCandidate(candidate);
  assert.equal(result.normalization_count, 4);
  assert.equal(result.candidate.prelude.body_paragraphs[0], 'A');
  assert.equal(result.candidate.pre_seal_sections[0].body_paragraphs[0], 'B');
  assert.equal(result.candidate.personal_seal.motto, 'C');
  assert.equal(result.candidate.main_life_sections[0].body_paragraphs[0], 'D');
  assert.equal(result.candidate.untouched, '**must-stay**');
});
