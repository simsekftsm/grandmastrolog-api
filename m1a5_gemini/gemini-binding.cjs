'use strict';

const { groqGenerationFormat, groqModelInstructions } = require('../delivery_runtime/lib/groq-binding');

const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta2/interactions';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_MAX_OUTPUT_TOKENS = 8192;

const UNSUPPORTED_SCHEMA_KEYS = new Set([
  'minLength',
  'maxLength',
  'pattern',
  'multipleOf',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'uniqueItems'
]);

function sanitizeGeminiSchema(value) {
  if (Array.isArray(value)) return value.map(sanitizeGeminiSchema);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
    if (key === 'enum' && value.type === 'boolean') continue;
    out[key] = sanitizeGeminiSchema(child);
  }
  return out;
}

function geminiGenerationSchema(verifiedEvidence, availability) {
  const groq = groqGenerationFormat(verifiedEvidence, availability);
  return sanitizeGeminiSchema(groq.schema);
}

function geminiSystemInstruction(availability, verifiedEvidence) {
  return [
    groqModelInstructions(availability, verifiedEvidence),
    'GEMINI STRUCTURED OUTPUT RULE: return only the JSON object required by the response schema.',
    'Do not wrap the JSON in markdown or explanatory text.'
  ].join('\n');
}

function geminiInteractionRequest(bindingInput) {
  return {
    model: GEMINI_MODEL,
    input: 'SEMANTIC_INPUT_JSON:\n' + JSON.stringify(bindingInput.semantic_input),
    system_instruction: geminiSystemInstruction(bindingInput.availability, bindingInput.verified_evidence),
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: geminiGenerationSchema(bindingInput.verified_evidence, bindingInput.availability)
    },
    generation_config: {
      max_output_tokens: GEMINI_MAX_OUTPUT_TOKENS,
      thinking_level: 'low',
      seed: 0
    },
    store: false
  };
}

function extractGeminiOutputText(response) {
  const parts = [];
  for (const step of response?.steps || []) {
    if (step?.type !== 'model_output') continue;
    for (const item of step?.content || []) {
      if (item?.type === 'text' && typeof item.text === 'string') parts.push(item.text);
    }
  }
  const text = parts.join('');
  if (!text.trim()) throw new Error('GEMINI_OUTPUT_MISSING');
  return text;
}

module.exports = {
  GEMINI_INTERACTIONS_URL,
  GEMINI_MODEL,
  GEMINI_MAX_OUTPUT_TOKENS,
  sanitizeGeminiSchema,
  geminiGenerationSchema,
  geminiSystemInstruction,
  geminiInteractionRequest,
  extractGeminiOutputText
};
