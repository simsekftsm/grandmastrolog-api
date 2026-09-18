'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PROVIDER,
  DEFAULT_MODEL,
  GEMINI_MAX_OUTPUT_TOKENS,
  ProviderAdapterError,
  runtimeConfig,
  buildGeminiRequest,
  generateSemanticCandidate
} = require('../lib/provider-adapter');
const { bindingInput, validPayload } = require('./helpers');

test('canonical provider defaults to Google Gemini 3.1 Flash-Lite', () => {
  assert.equal(DEFAULT_PROVIDER, 'google');
  assert.equal(DEFAULT_MODEL, 'gemini-3.1-flash-lite');
  assert.equal(GEMINI_MAX_OUTPUT_TOKENS, 8192);
});

test('runtime config requires GEMINI_API_KEY and rejects provider/model drift', () => {
  assert.throws(
    () => runtimeConfig({}),
    (e) => e instanceof ProviderAdapterError && e.code === 'RUNTIME_SECRET_OR_MODEL_BINDING_UNAVAILABLE'
  );
  assert.throws(
    () => runtimeConfig({ GEMINI_API_KEY:'x', GM_MODEL_PROVIDER:'openai' }),
    (e) => e instanceof ProviderAdapterError && e.code === 'RUNTIME_MODEL_FREEZE_VIOLATION'
  );
  assert.throws(
    () => runtimeConfig({ GEMINI_API_KEY:'x', GM_MODEL:'other-model' }),
    (e) => e instanceof ProviderAdapterError && e.code === 'RUNTIME_MODEL_FREEZE_VIOLATION'
  );
});

test('Gemini request uses Interactions API structured JSON and compact schema', () => {
  const body = buildGeminiRequest(bindingInput());
  assert.equal(body.model, 'gemini-3.1-flash-lite');
  assert.equal(body.generation_config.max_output_tokens, 8192);
  assert.equal(body.response_format.type, 'text');
  assert.equal(body.response_format.mime_type, 'application/json');
  assert.equal(body.response_format.schema.type, 'object');
  assert.equal(body.store, false);
});

test('provider adapter normalizes safe presentation markup before downstream binding', async () => {
  const payload = validPayload();
  payload.pre_seal_sections[0].body_paragraphs = ['**Düz** semantik içerik.'];
  const env = { GEMINI_API_KEY:'test-key' };
  const result = await generateSemanticCandidate(bindingInput(), {
    env,
    fetchImpl: async (_url, init) => {
      const sent = JSON.parse(init.body);
      assert.equal(sent.model, 'gemini-3.1-flash-lite');
      return {
        ok:true,
        status:200,
        json:async()=>({
          status:'completed',
          steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(payload)}]}]
        })
      };
    }
  });
  assert.equal(result.provider, 'google');
  assert.equal(result.model, 'gemini-3.1-flash-lite');
  assert.equal(result.normalization_count, 1);
  assert.equal(result.candidate.pre_seal_sections[0].body_paragraphs[0], 'Düz semantik içerik.');
});
