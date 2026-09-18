'use strict';

class SemanticNormalizationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SemanticNormalizationError';
    this.code = code;
  }
}

function lexicalTokens(text) {
  return String(text).match(/[\p{L}\p{N}]+/gu) || [];
}

function normalizeFormattingOnly(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, '$1')
    .replace(/(^|\n)\s{0,3}>\s?/g, '$1')
    .replace(/(^|\n)\s{0,3}[-+*]\s+/g, '$1')
    .replace(/(^|\n)\s{0,3}(\d+)[.)]\s+/g, '$1$2 ')
    .replace(/(^|\n)\s{0,3}---\s*(?=\n|$)/g, '$1');
}

function normalizeString(value) {
  const normalized = normalizeFormattingOnly(value);
  if (normalized === value) return { value, changed: false };

  if (JSON.stringify(lexicalTokens(value)) !== JSON.stringify(lexicalTokens(normalized))) {
    throw new SemanticNormalizationError(
      'SEMANTIC_NORMALIZER_LEXICAL_DRIFT',
      'Formatting normalization attempted to change lexical semantic content.'
    );
  }
  return { value: normalized, changed: true };
}

function normalizeSemanticCandidate(candidate) {
  const out = JSON.parse(JSON.stringify(candidate ?? {}));
  let changed = 0;

  const cleanArray = (items) => Array.isArray(items)
    ? items.map((item) => {
      const result = normalizeString(item);
      if (result.changed) changed += 1;
      return result.value;
    })
    : items;

  if (out?.prelude) out.prelude.body_paragraphs = cleanArray(out.prelude.body_paragraphs);

  for (const section of out?.pre_seal_sections || []) {
    section.body_paragraphs = cleanArray(section.body_paragraphs);
  }

  if (out?.personal_seal && typeof out.personal_seal.motto === 'string') {
    const result = normalizeString(out.personal_seal.motto);
    if (result.changed) changed += 1;
    out.personal_seal.motto = result.value;
  }

  for (const section of out?.main_life_sections || []) {
    section.body_paragraphs = cleanArray(section.body_paragraphs);
  }

  for (const item of out?.special_contributions || []) {
    item.body_paragraphs = cleanArray(item.body_paragraphs);
  }

  return { candidate: out, normalization_count: changed };
}

module.exports = {
  SemanticNormalizationError,
  lexicalTokens,
  normalizeFormattingOnly,
  normalizeSemanticCandidate
};
