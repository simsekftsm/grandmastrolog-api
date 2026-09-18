'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const validateNatal = require('../api/validate-natal');
const modelNatal = require('../api/model-natal');
const { signTrustedRequest } = require('../lib/trust-boundary');
const { bindingInput, validPayload } = require('./helpers');

const TEST_SECRET = 'unit-test-gm-secret-not-production';
process.env.GM_API_SECRET = TEST_SECRET;

function fakeResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: undefined,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    getHeader(name) { return headers.get(name.toLowerCase()); },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function trustedRequest(routeId, body, method = 'POST') {
  const seal = signTrustedRequest({ secret: TEST_SECRET, method, routeId, body });
  return {
    method,
    body,
    headers: {
      authorization: `Bearer ${TEST_SECRET}`,
      'x-gm-evidence-source': seal.source,
      'x-gm-evidence-timestamp': seal.timestamp,
      'x-gm-evidence-signature': seal.signature
    }
  };
}

test('validate-natal accepts canonical semantic payload without rendering', async () => {
  const body = { binding_input: bindingInput(), semantic_payload: validPayload() };
  const res = fakeResponse();
  await validateNatal(trustedRequest('validate-natal', body), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.contract.render_state, 'blocked_until_m1a3');
  assert.equal(JSON.stringify(res.body).includes('> ##'), false);
});

test('validate-natal rejects raw markup escape', async () => {
  const payload = validPayload(); payload.pre_seal_sections[0].body_paragraphs = ['> ## • PROFİLİN •'];
  const body = { binding_input: bindingInput(), semantic_payload: payload };
  const res = fakeResponse();
  await validateNatal(trustedRequest('validate-natal', body), res);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'MARKDOWN_ESCAPE');
});

test('validate-natal rejects method boundary', async () => {
  const res = fakeResponse();
  await validateNatal({ method:'GET' }, res);
  assert.equal(res.statusCode, 405);
});

test('model-natal fails closed when OpenAI provider secret is absent even if legacy Groq secret exists', async () => {
  const oldOpenAI = process.env.OPENAI_API_KEY;
  const oldGroq = process.env.GROQ_API_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.GROQ_API_KEY = 'must-not-be-used';
  const body = bindingInput();
  const res = fakeResponse();
  await modelNatal(trustedRequest('model-natal', body), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'RUNTIME_SECRET_OR_MODEL_BINDING_UNAVAILABLE');
  if (oldOpenAI !== undefined) process.env.OPENAI_API_KEY = oldOpenAI; else delete process.env.OPENAI_API_KEY;
  if (oldGroq !== undefined) process.env.GROQ_API_KEY = oldGroq; else delete process.env.GROQ_API_KEY;
});

test('model-natal fails closed before upstream call when canonical Luna model override violates freeze', async () => {
  const oldOpenAI = process.env.OPENAI_API_KEY;
  const oldModel = process.env.GM_MODEL;
  process.env.OPENAI_API_KEY = 'test-secret';
  process.env.GM_MODEL = 'wrong/model';
  const body = bindingInput();
  const res = fakeResponse();
  await modelNatal(trustedRequest('model-natal', body), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'RUNTIME_MODEL_FREEZE_VIOLATION');
  assert.equal(res.body.expected_provider, 'openai');
  assert.equal(res.body.expected_model, 'gpt-5.6-luna');
  if (oldOpenAI !== undefined) process.env.OPENAI_API_KEY = oldOpenAI; else delete process.env.OPENAI_API_KEY;
  if (oldModel !== undefined) process.env.GM_MODEL = oldModel; else delete process.env.GM_MODEL;
});

test('model-natal upstream failure fails closed without exposing raw provider output', async () => {
  const oldOpenAI = process.env.OPENAI_API_KEY;
  const oldModel = process.env.GM_MODEL;
  const oldProvider = process.env.GM_MODEL_PROVIDER;
  const oldFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'test-secret';
  delete process.env.GM_MODEL;
  delete process.env.GM_MODEL_PROVIDER;
  let outboundBody;
  global.fetch = async (_url, init) => {
    outboundBody = JSON.parse(init.body);
    return { ok: false, status: 503 };
  };
  try {
    const body = bindingInput();
    const res = fakeResponse();
    await modelNatal(trustedRequest('model-natal', body), res);
    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, { ok: false, code: 'MODEL_BINDING_UPSTREAM_FAIL', upstream_provider: 'openai', upstream_status: 503 });
    assert.equal(JSON.stringify(res.body).includes('raw'), false);
    assert.equal(outboundBody.model, 'gpt-5.6-luna');
    assert.equal(outboundBody.max_output_tokens, 16384);
    assert.equal(outboundBody.reasoning.effort, 'medium');
    assert.equal(outboundBody.text.format.type, 'json_schema');
  } finally {
    global.fetch = oldFetch;
    if (oldOpenAI !== undefined) process.env.OPENAI_API_KEY = oldOpenAI; else delete process.env.OPENAI_API_KEY;
    if (oldModel !== undefined) process.env.GM_MODEL = oldModel; else delete process.env.GM_MODEL;
    if (oldProvider !== undefined) process.env.GM_MODEL_PROVIDER = oldProvider; else delete process.env.GM_MODEL_PROVIDER;
  }
});

test('model-natal upstream timeout fails closed and cannot become delivery output', async () => {
  const oldOpenAI = process.env.OPENAI_API_KEY;
  const oldModel = process.env.GM_MODEL;
  const oldProvider = process.env.GM_MODEL_PROVIDER;
  const oldFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'test-secret';
  delete process.env.GM_MODEL;
  delete process.env.GM_MODEL_PROVIDER;
  global.fetch = async () => {
    const error = new Error('timed out');
    error.name = 'TimeoutError';
    throw error;
  };
  try {
    const body = bindingInput();
    const res = fakeResponse();
    await modelNatal(trustedRequest('model-natal', body), res);
    assert.equal(res.statusCode, 504);
    assert.deepEqual(res.body, { ok: false, code: 'MODEL_BINDING_TIMEOUT', upstream_provider: 'openai' });
  } finally {
    global.fetch = oldFetch;
    if (oldOpenAI !== undefined) process.env.OPENAI_API_KEY = oldOpenAI; else delete process.env.OPENAI_API_KEY;
    if (oldModel !== undefined) process.env.GM_MODEL = oldModel; else delete process.env.GM_MODEL;
    if (oldProvider !== undefined) process.env.GM_MODEL_PROVIDER = oldProvider; else delete process.env.GM_MODEL_PROVIDER;
  }
});
