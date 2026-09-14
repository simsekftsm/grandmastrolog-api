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
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || 'gpt-5.6-sol';
    if (!apiKey) {
      return res.status(503).json({ ok: false, code: 'RUNTIME_SECRET_OR_MODEL_BINDING_UNAVAILABLE' });
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
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
      return res.status(502).json({ ok: false, code: 'MODEL_BINDING_UPSTREAM_FAIL', upstream_status: response.status });
    }
    const json = await response.json();
    if (json.status && json.status !== 'completed') {
      return res.status(502).json({ ok: false, code: 'MODEL_RESPONSE_INCOMPLETE' });
    }
    const text = extractOutputText(json);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return res.status(502).json({ ok: false, code: 'MODEL_STRUCTURED_PARSE_FAIL' });
    }
    const contract = makeValidatedEnvelope(payload, evidenceMap, availability);
    return res.status(200).json({ ok: true, model_binding: 'openai_responses_json_schema_strict', model, contract });
  } catch (error) {
    if (error instanceof ContractValidationError || error instanceof SchemaValidationError) {
      return res.status(422).json({ ok: false, code: error.code, path: error.path });
    }
    if (error && error.message === 'MODEL_REFUSAL') {
      return res.status(502).json({ ok: false, code: 'MODEL_REFUSAL' });
    }
    if (error && error.name === 'TimeoutError') {
      return res.status(504).json({ ok: false, code: 'MODEL_BINDING_TIMEOUT' });
    }
    return res.status(500).json({ ok: false, code: 'MODEL_BINDING_INTERNAL_ERROR' });
  }
};
