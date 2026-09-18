'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PROVIDER,
  DEFAULT_MODEL,
  OPENAI_MAX_OUTPUT_TOKENS,
  OPENAI_REASONING_EFFORT,
  ProviderAdapterError,
  runtimeConfig,
  buildOpenAIRequest,
  generateSemanticCandidate
} = require('../lib/provider-adapter');
const { bindingInput, validPayload } = require('./helpers');

test('canonical provider defaults to OpenAI GPT-5.6 Luna', () => {
  assert.equal(DEFAULT_PROVIDER, 'openai');
  assert.equal(DEFAULT_MODEL, 'gpt-5.6-luna');
  assert.equal(OPENAI_MAX_OUTPUT_TOKENS, 16384);
  assert.equal(OPENAI_REASONING_EFFORT, 'medium');
});

test('runtime config requires OPENAI_API_KEY and rejects provider/model drift', () => {
  assert.throws(
    () => runtimeConfig({}),
    (e) => e instanceof ProviderAdapterError && e.code === 'RUNTIME_SECRET_OR_MODEL_BINDING_UNAVAILABLE'
  );
  assert.throws(
    () => runtimeConfig({ OPENAI_API_KEY:'x', GM_MODEL_PROVIDER:'groq' }),
    (e) => e instanceof ProviderAdapterError && e.code === 'RUNTIME_MODEL_FREEZE_VIOLATION'
  );
  assert.throws(
    () => runtimeConfig({ OPENAI_API_KEY:'x', GM_MODEL:'other-model' }),
    (e) => e instanceof ProviderAdapterError && e.code === 'RUNTIME_MODEL_FREEZE_VIOLATION'
  );
});

test('Luna request uses Responses API structured outputs and medium reasoning', () => {
  const body = buildOpenAIRequest(bindingInput());
  assert.equal(body.model, 'gpt-5.6-luna');
  assert.equal(body.max_output_tokens, 16384);
  assert.deepEqual(body.reasoning, { effort:'medium' });
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.equal(body.store, false);
});

test('provider adapter normalizes safe presentation markup before downstream binding', async () => {
  const payload = validPayload();
  payload.pre_seal_sections[0].body_paragraphs = ['**Düz** semantik içerik.'];
  const env = { OPENAI_API_KEY:'test-key' };
  const result = await generateSemanticCandidate(bindingInput(), {
    env,
    fetchImpl: async (_url, init) => {
      const sent = JSON.parse(init.body);
      assert.equal(sent.model, 'gpt-5.6-luna');
      return {
        ok:true,
        status:200,
        json:async()=>({status:'completed',output_text:JSON.stringify(payload)})
      };
    }
  });
  assert.equal(result.provider, 'openai');
  assert.equal(result.model, 'gpt-5.6-luna');
  assert.equal(result.normalization_count, 1);
  assert.equal(result.candidate.pre_seal_sections[0].body_paragraphs[0], 'Düz semantik içerik.');
});
