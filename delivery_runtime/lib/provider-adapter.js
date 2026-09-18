'use strict';

const { providerGenerationFormat, providerModelInstructions } = require('./semantic-generation');
const { normalizeSemanticCandidate } = require('./semantic-normalizer');

const DEFAULT_PROVIDER = 'openai';
const DEFAULT_MODEL = 'gpt-5.6-luna';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_MAX_OUTPUT_TOKENS = 16384;
const OPENAI_REASONING_EFFORT = 'medium';
const MODEL_BINDING = 'provider_adapter_openai_responses_json_schema_strict_v1';

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

  if (provider !== DEFAULT_PROVIDER) {
    throw new ProviderAdapterError('RUNTIME_MODEL_FREEZE_VIOLATION', 503, {
      expected_provider: DEFAULT_PROVIDER,
      expected_model: DEFAULT_MODEL
    });
  }
  if (model !== DEFAULT_MODEL) {
    throw new ProviderAdapterError('RUNTIME_MODEL_FREEZE_VIOLATION', 503, {
      expected_provider: DEFAULT_PROVIDER,
      expected_model: DEFAULT_MODEL
    });
  }
  if (!env.OPENAI_API_KEY) {
    throw new ProviderAdapterError('RUNTIME_SECRET_OR_MODEL_BINDING_UNAVAILABLE', 503);
  }

  return { provider, model, apiKey: env.OPENAI_API_KEY };
}

function extractOutputText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text;
  }
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'refusal') {
        throw new ProviderAdapterError('MODEL_REFUSAL', 502, { upstream_provider: DEFAULT_PROVIDER });
      }
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        return content.text;
      }
    }
  }
  throw new ProviderAdapterError('MODEL_OUTPUT_MISSING', 502, { upstream_provider: DEFAULT_PROVIDER });
}

function buildOpenAIRequest(bindingInput, model = DEFAULT_MODEL) {
  return {
    model,
    instructions: providerModelInstructions(bindingInput.availability, bindingInput.verified_evidence),
    input: bindingInput.semantic_input,
    max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
    reasoning: { effort: OPENAI_REASONING_EFFORT },
    text: { format: providerGenerationFormat(bindingInput.verified_evidence, bindingInput.availability) },
    store: false
  };
}

async function generateSemanticCandidate(bindingInput, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || global.fetch;
  const config = runtimeConfig(env);

  let response;
  try {
    response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buildOpenAIRequest(bindingInput, config.model)),
      signal: AbortSignal.timeout(90000)
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      throw new ProviderAdapterError('MODEL_BINDING_TIMEOUT', 504, { upstream_provider: config.provider });
    }
    throw error;
  }

  if (!response.ok) {
    throw new ProviderAdapterError('MODEL_BINDING_UPSTREAM_FAIL', 502, {
      upstream_provider: config.provider,
      upstream_status: response.status
    });
  }

  const json = await response.json();
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

  const normalized = normalizeSemanticCandidate(parsed);
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
  OPENAI_RESPONSES_URL,
  OPENAI_MAX_OUTPUT_TOKENS,
  OPENAI_REASONING_EFFORT,
  MODEL_BINDING,
  ProviderAdapterError,
  runtimeConfig,
  extractOutputText,
  buildOpenAIRequest,
  generateSemanticCandidate
};
