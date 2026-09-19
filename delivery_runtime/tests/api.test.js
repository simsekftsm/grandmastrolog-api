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

test('model-natal fails closed when Groq secret is absent even if an OpenAI secret exists', async () => {
  const oldGroq = process.env.GROQ_API_KEY;
  const oldOpenAI = process.env.OPENAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  process.env.OPENAI_API_KEY = 'must-not-be-used';
  const body = bindingInput();
  const res = fakeResponse();
  await modelNatal(trustedRequest('model-natal', body), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'RUNTIME_SECRET_OR_MODEL_BINDING_UNAVAILABLE');
  if (oldGroq !== undefined) process.env.GROQ_API_KEY = oldGroq; else delete process.env.GROQ_API_KEY;
  if (oldOpenAI !== undefined) process.env.OPENAI_API_KEY = oldOpenAI; else delete process.env.OPENAI_API_KEY;
});

test('model-natal fails closed before upstream call when Groq model override violates freeze', async () => {
  const oldGroq = process.env.GROQ_API_KEY;
  const oldModel = process.env.GROQ_MODEL;
  process.env.GROQ_API_KEY = 'test-secret';
  process.env.GROQ_MODEL = 'wrong/model';
  const body = bindingInput();
  const res = fakeResponse();
  await modelNatal(trustedRequest('model-natal', body), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'RUNTIME_MODEL_FREEZE_VIOLATION');
  assert.equal(res.body.expected_model, 'openai/gpt-oss-120b');
  if (oldGroq !== undefined) process.env.GROQ_API_KEY = oldGroq; else delete process.env.GROQ_API_KEY;
  if (oldModel !== undefined) process.env.GROQ_MODEL = oldModel; else delete process.env.GROQ_MODEL;
});

test('model-natal upstream failure fails closed without exposing raw provider output', async () => {
  const oldGroq = process.env.GROQ_API_KEY;
  const oldModel = process.env.GROQ_MODEL;
  const oldFetch = global.fetch;
  process.env.GROQ_API_KEY = 'test-secret';
  delete process.env.GROQ_MODEL;
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
    assert.deepEqual(res.body, { ok: false, code: 'MODEL_BINDING_UPSTREAM_FAIL', upstream_provider: 'groq', upstream_status: 503 });
    assert.equal(JSON.stringify(res.body).includes('raw'), false);
    assert.equal(outboundBody.max_output_tokens, 4608);
  } finally {
    global.fetch = oldFetch;
    if (oldGroq !== undefined) process.env.GROQ_API_KEY = oldGroq; else delete process.env.GROQ_API_KEY;
    if (oldModel !== undefined) process.env.GROQ_MODEL = oldModel; else delete process.env.GROQ_MODEL;
  }
});

test('model-natal upstream timeout fails closed and cannot become delivery output', async () => {
  const oldGroq = process.env.GROQ_API_KEY;
  const oldModel = process.env.GROQ_MODEL;
  const oldFetch = global.fetch;
  process.env.GROQ_API_KEY = 'test-secret';
  delete process.env.GROQ_MODEL;
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
    assert.deepEqual(res.body, { ok: false, code: 'MODEL_BINDING_TIMEOUT', upstream_provider: 'groq' });
  } finally {
    global.fetch = oldFetch;
    if (oldGroq !== undefined) process.env.GROQ_API_KEY = oldGroq; else delete process.env.GROQ_API_KEY;
    if (oldModel !== undefined) process.env.GROQ_MODEL = oldModel; else delete process.env.GROQ_MODEL;
  }
});
