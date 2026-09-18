import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const handler = require('../delivery_runtime/api/e2e-natal.js');
const { signTrustedRequest } = require('../delivery_runtime/lib/trust-boundary.js');
const { availability, bindingInput, validPayload, clone } = require('../delivery_runtime/tests/helpers.js');

function makeRes() {
  return {
    headers: {},
    statusCode: 200,
    payload: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

function trustedReq(body) {
  const signed = signTrustedRequest({
    secret: process.env.GM_API_SECRET,
    routeId: 'e2e-natal',
    body
  });
  return {
    method: 'POST',
    body,
    headers: {
      authorization: `Bearer ${process.env.GM_API_SECRET}`,
      'x-gm-evidence-source': signed.source,
      'x-gm-evidence-timestamp': signed.timestamp,
      'x-gm-evidence-signature': signed.signature
    }
  };
}

function primeEnv() {
  process.env.GM_API_SECRET = 'synthetic-test-secret';
  process.env.OPENAI_API_KEY = 'synthetic-openai-key';
  delete process.env.GM_MODEL;
  delete process.env.GM_MODEL_PROVIDER;
  process.env.GM_FINAL_DELIVERY_AUTHORIZED = 'true';
  process.env.VERCEL_DEPLOYMENT_ID = 'dpl_SyntheticE2E';
  process.env.VERCEL_PROJECT_ID = 'prj_XhDus3tQsyiLxrPccbQteXLwbB2a';
  process.env.VERCEL_ENV = 'production';
}

async function invoke(modelPayloadFactory) {
  const av = availability();
  const binding = bindingInput(av);
  const body = { binding_input: binding };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: 'completed', output_text: JSON.stringify(modelPayloadFactory(av)) })
  });
  const res = makeRes();
  await handler(trustedReq(body), res);
  return res;
}

test('same physical request reaches strict model binding, canonical renderer and final delivery validator', async () => {
  primeEnv();
  const res = await invoke((av) => validPayload(av));
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.delivery_validator_enabled, true);
  assert.equal(res.payload.final_delivery_authorized, true);
  assert.equal(res.payload.delivery.delivery_state, 'final_delivery_validated');
  assert.equal(res.payload.delivery.contract_version, 'gm.natal.v1');
  assert.match(res.payload.delivery.contract_sha256, /^[a-f0-9]{64}$/);
  assert.match(res.payload.delivery.canonical_markdown_sha256, /^[a-f0-9]{64}$/);
  assert.match(res.payload.delivery.delivery_binding_sha256, /^[a-f0-9]{64}$/);
  const serialized = JSON.stringify(res.payload);
  assert.equal(serialized.includes('semantic_payload'), false);
  assert.equal(serialized.includes('raw_model_output'), false);
});

test('caller without trust provenance cannot reach model binding', async () => {
  primeEnv();
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('must not call'); };
  const res = makeRes();
  await handler({ method: 'POST', body: { binding_input: bindingInput() }, headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.code, 'UNAUTHORIZED');
  assert.equal(called, false);
});

test('final delivery authorization remains fail closed', async () => {
  primeEnv();
  process.env.GM_FINAL_DELIVERY_AUTHORIZED = 'false';
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('must not call'); };
  const body = { binding_input: bindingInput() };
  const res = makeRes();
  await handler(trustedReq(body), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.code, 'FINAL_DELIVERY_NOT_AUTHORIZED');
  assert.equal(called, false);
});

test('model upstream failure is fail closed', async () => {
  primeEnv();
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ secret: 'RAW-UPSTREAM' }) });
  const body = { binding_input: bindingInput() };
  const res = makeRes();
  await handler(trustedReq(body), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.payload.code, 'MODEL_BINDING_UPSTREAM_FAIL');
  assert.equal(JSON.stringify(res.payload).includes('RAW-UPSTREAM'), false);
});

test('model timeout is fail closed', async () => {
  primeEnv();
  globalThis.fetch = async () => {
    const error = new Error('synthetic timeout');
    error.name = 'TimeoutError';
    throw error;
  };
  const body = { binding_input: bindingInput() };
  const res = makeRes();
  await handler(trustedReq(body), res);
  assert.equal(res.statusCode, 504);
  assert.equal(res.payload.code, 'MODEL_BINDING_TIMEOUT');
});

test('schema or semantic escape from model is rejected before final delivery', async () => {
  primeEnv();
  const res = await invoke((av) => {
    const payload = clone(validPayload(av));
    payload.pre_seal_sections[0].body_paragraphs = ['[RAW-MARKDOWN-ESCAPE](https://example.invalid)'];
    return payload;
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.payload.code, 'MARKDOWN_ESCAPE');
  assert.equal(JSON.stringify(res.payload).includes('RAW-MARKDOWN-ESCAPE'), false);
});

test('unparseable raw model output never leaks', async () => {
  primeEnv();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: 'completed', output_text: 'RAW-SECRET-NOT-JSON' })
  });
  const body = { binding_input: bindingInput() };
  const res = makeRes();
  await handler(trustedReq(body), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.payload.code, 'MODEL_STRUCTURED_PARSE_FAIL');
  assert.equal(JSON.stringify(res.payload).includes('RAW-SECRET-NOT-JSON'), false);
});
