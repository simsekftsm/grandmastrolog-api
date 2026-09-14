'use strict';

const { applySecurityHeaders } = require('../lib/foundation');
const {
  ContractValidationError,
  SchemaValidationError,
  validateBindingInput,
  makeValidatedEnvelope,
  openAIStrictFormat,
  modelInstructions
} = require('../lib/natal-contract');

const GROQ_RESPONSES_URL = 'https://api.groq.com/openai/v1/responses';
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
const MODEL_BINDING = 'groq_responses_json_schema_strict';

function extractOutputText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) return response.output_text;
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'refusal') throw new Error('MODEL_REFUSAL');
      if (content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  throw new Error('MODEL_OUTPUT_MISSING');
}

module.exports = async function modelNatal(req, res) {
  applySecurityHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { evidenceMap, availability } = validateBindingInput(req.body);
    const apiKey = process.env.GROQ_API_KEY;
    const model = process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
    if (!apiKey) {
      return res.status(503).json({ ok: false, code: 'RUNTIME_SECRET_OR_MODEL_BINDING_UNAVAILABLE' });
    }

    const response = await fetch(GROQ_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        instructions: modelInstructions(availability, req.body.verified_evidence),
        input: req.body.semantic_input,
        text: { format: openAIStrictFormat() }
      }),
      signal: AbortSignal.timeout(50000)
    });

    if (!response.ok) {
      return res.status(502).json({ ok: false, code: 'MODEL_BINDING_UPSTREAM_FAIL', upstream_provider: 'groq', upstream_status: response.status });
    }
    const json = await response.json();
    if (json.status && json.status !== 'completed') {
      return res.status(502).json({ ok: false, code: 'MODEL_RESPONSE_INCOMPLETE', upstream_provider: 'groq' });
    }
    const text = extractOutputText(json);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return res.status(502).json({ ok: false, code: 'MODEL_STRUCTURED_PARSE_FAIL', upstream_provider: 'groq' });
    }
    const contract = makeValidatedEnvelope(payload, evidenceMap, availability);
    return res.status(200).json({ ok: true, model_binding: MODEL_BINDING, provider: 'groq', model, contract });
  } catch (error) {
    if (error instanceof ContractValidationError || error instanceof SchemaValidationError) {
      return res.status(422).json({ ok: false, code: error.code, path: error.path });
    }
    if (error && error.message === 'MODEL_REFUSAL') {
      return res.status(502).json({ ok: false, code: 'MODEL_REFUSAL', upstream_provider: 'groq' });
    }
    if (error && error.name === 'TimeoutError') {
      return res.status(504).json({ ok: false, code: 'MODEL_BINDING_TIMEOUT', upstream_provider: 'groq' });
    }
    return res.status(500).json({ ok: false, code: 'MODEL_BINDING_INTERNAL_ERROR' });
  }
};
