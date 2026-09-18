'use strict';

const { compactProviderSchema, providerModelInstructions } = require('./semantic-generation');
const { SemanticNormalizationError, normalizeSemanticCandidate } = require('./semantic-normalizer');

const DEFAULT_PROVIDER = 'google';
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const GEMINI_MAX_OUTPUT_TOKENS = 8192;
const MODEL_BINDING = 'provider_adapter_gemini_interactions_json_schema_v1';

class ProviderAdapterError extends Error {
  constructor(code, statusCode, details = {}) {
    super(code);
    this.name = 'ProviderAdapterError';
    this.code = code;
    this.statusCode = statusCode;
    Object.assign(this, details);
  }
}

function runtimeConfig(env = process.env) {
  const provider = env.GM_MODEL_PROVIDER || DEFAULT_PROVIDER;
  const model = env.GM_MODEL || DEFAULT_MODEL;

  if (provider !== DEFAULT_PROVIDER || model !== DEFAULT_MODEL) {
    throw new ProviderAdapterError('RUNTIME_MODEL_FREEZE_VIOLATION', 503, {
      expected_provider: DEFAULT_PROVIDER,
      expected_model: DEFAULT_MODEL
    });
  }
  if (!env.GEMINI_API_KEY) {
    throw new ProviderAdapterError('RUNTIME_SECRET_OR_MODEL_BINDING_UNAVAILABLE', 503);
  }

  return { provider, model, apiKey: env.GEMINI_API_KEY };
}

function extractOutputText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text;
  }
  const parts = [];
  for (const step of response?.steps || []) {
    if (step?.type !== 'model_output') continue;
    for (const item of step?.content || []) {
      if (item?.type === 'text' && typeof item.text === 'string') parts.push(item.text);
    }
  }
  const text = parts.join('');
  if (!text.trim()) {
    throw new ProviderAdapterError('MODEL_OUTPUT_MISSING', 502, { upstream_provider: DEFAULT_PROVIDER });
  }
  return text;
}

function buildGeminiRequest(bindingInput, model = DEFAULT_MODEL) {
  return {
    model,
    input: 'SEMANTIC_INPUT_JSON:\n' + JSON.stringify(bindingInput.semantic_input),
    system_instruction: providerModelInstructions(bindingInput.availability, bindingInput.verified_evidence),
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: compactProviderSchema(bindingInput.verified_evidence, bindingInput.availability)
    },
    generation_config: {
      max_output_tokens: GEMINI_MAX_OUTPUT_TOKENS,
      seed: 0
    },
    store: false
  };
}

async function generateSemanticCandidate(bindingInput, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || global.fetch;
  const config = runtimeConfig(env);

  let response;
  try {
    response = await fetchImpl(GEMINI_INTERACTIONS_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': config.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buildGeminiRequest(bindingInput, config.model)),
      signal: AbortSignal.timeout(90000)
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      throw new ProviderAdapterError('MODEL_BINDING_TIMEOUT', 504, { upstream_provider: config.provider });
    }
    throw error;
  }

  let json = {};
  try { json = await response.json(); } catch {}

  if (!response.ok) {
    throw new ProviderAdapterError('MODEL_BINDING_UPSTREAM_FAIL', 502, {
      upstream_provider: config.provider,
      upstream_status: response.status,
      upstream_error_status: json?.error?.status || null
    });
  }

  if (json?.status && json.status !== 'completed') {
    throw new ProviderAdapterError('MODEL_RESPONSE_INCOMPLETE', 502, {
      upstream_provider: config.provider
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(extractOutputText(json));
  } catch (error) {
    if (error instanceof ProviderAdapterError) throw error;
    throw new ProviderAdapterError('MODEL_STRUCTURED_PARSE_FAIL', 502, {
      upstream_provider: config.provider
    });
  }

  let normalized;
  try {
    normalized = normalizeSemanticCandidate(parsed);
  } catch (error) {
    if (error instanceof SemanticNormalizationError) {
      throw new ProviderAdapterError('MODEL_SEMANTIC_NORMALIZATION_FAIL', 500, {
        upstream_provider: config.provider
      });
    }
    throw error;
  }

  return {
    provider: config.provider,
    model: config.model,
    model_binding: MODEL_BINDING,
    candidate: normalized.candidate,
    normalization_count: normalized.normalization_count
  };
}

module.exports = {
  DEFAULT_PROVIDER,
  DEFAULT_MODEL,
  GEMINI_INTERACTIONS_URL,
  GEMINI_MAX_OUTPUT_TOKENS,
  MODEL_BINDING,
  ProviderAdapterError,
  runtimeConfig,
  extractOutputText,
  buildGeminiRequest,
  generateSemanticCandidate
};
