'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const validateNatal = require('../api/validate-natal');
const {
  TRUST_SOURCE,
  signTrustedRequest,
  verifyTrustedRequest
} = require('../lib/trust-boundary');
const { bindingInput, validPayload, clone } = require('./helpers');

const TEST_SECRET = 'unit-test-gm-secret-not-production';

function fakeResponse() {
  return {
    statusCode: 200,
    body: undefined,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function request(routeId, body, {
  secret = TEST_SECRET,
  credential = TEST_SECRET,
  source = TRUST_SOURCE,
  timestamp = Math.floor(Date.now() / 1000),
  signature,
  includeProvenance = true
} = {}) {
  const seal = signTrustedRequest({ secret, routeId, source, timestamp, body });
  const headers = { authorization: `Bearer ${credential}` };
  if (includeProvenance) {
    headers['x-gm-evidence-source'] = source;
    headers['x-gm-evidence-timestamp'] = String(timestamp);
    headers['x-gm-evidence-signature'] = signature ?? seal.signature;
  }
  return { method: 'POST', body, headers };
}

test('unauthenticated privileged request is rejected', () => {
  process.env.GM_API_SECRET = TEST_SECRET;
  assert.throws(
    () => verifyTrustedRequest({ method:'POST', body:{}, headers:{} }, 'model-natal'),
    (error) => error.statusCode === 401 && error.code === 'UNAUTHORIZED'
  );
});

test('unauthorized privileged request is rejected', () => {
  process.env.GM_API_SECRET = TEST_SECRET;
  const req = request('model-natal', {}, { credential: 'wrong-secret' });
  assert.throws(
    () => verifyTrustedRequest(req, 'model-natal'),
    (error) => error.statusCode === 401 && error.code === 'UNAUTHORIZED'
  );
});

test('self-asserted verified evidence without server provenance is rejected', async () => {
  process.env.GM_API_SECRET = TEST_SECRET;
  const body = { binding_input: bindingInput(), semantic_payload: validPayload() };
  const res = fakeResponse();
  await validateNatal({
    method:'POST',
    body,
    headers:{ authorization:`Bearer ${TEST_SECRET}` }
  }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'TRUST_PROVENANCE_REQUIRED');
});

test('forged provenance signature is rejected', () => {
  process.env.GM_API_SECRET = TEST_SECRET;
  const req = request('model-natal', bindingInput(), { signature: '0'.repeat(64) });
  assert.throws(
    () => verifyTrustedRequest(req, 'model-natal'),
    (error) => error.statusCode === 403 && error.code === 'TRUST_PROVENANCE_INVALID'
  );
});

test('stale provenance is rejected even when its HMAC is valid', () => {
  process.env.GM_API_SECRET = TEST_SECRET;
  const now = 2_000_000_000;
  const req = request('model-natal', bindingInput(), { timestamp: now - 301 });
  assert.throws(
    () => verifyTrustedRequest(req, 'model-natal', now),
    (error) => error.statusCode === 403 && error.code === 'TRUST_PROVENANCE_STALE'
  );
});

test('missing server trust material fails closed', () => {
  const old = process.env.GM_API_SECRET;
  delete process.env.GM_API_SECRET;
  try {
    assert.throws(
      () => verifyTrustedRequest({ method:'POST', body:{}, headers:{} }, 'model-natal'),
      (error) => error.statusCode === 503 && error.code === 'TRUST_MATERIAL_UNAVAILABLE'
    );
  } finally {
    if (old !== undefined) process.env.GM_API_SECRET = old;
  }
});

test('valid trusted path binds exact request body and passes', () => {
  process.env.GM_API_SECRET = TEST_SECRET;
  const body = bindingInput();
  const req = request('model-natal', body);
  const trust = verifyTrustedRequest(req, 'model-natal');
  assert.equal(trust.evidence_source, TRUST_SOURCE);
  assert.equal(trust.provenance_bound, true);
});

test('body mutation after provenance sealing is rejected', () => {
  process.env.GM_API_SECRET = TEST_SECRET;
  const body = bindingInput();
  const req = request('model-natal', body);
  const mutated = clone(body);
  mutated.verified_evidence[0].semantic_value = 'caller changed evidence after signing';
  req.body = mutated;
  assert.throws(
    () => verifyTrustedRequest(req, 'model-natal'),
    (error) => error.statusCode === 403 && error.code === 'TRUST_PROVENANCE_INVALID'
  );
});

test('route replay is rejected by route binding', () => {
  process.env.GM_API_SECRET = TEST_SECRET;
  const body = bindingInput();
  const req = request('model-natal', body);
  assert.throws(
    () => verifyTrustedRequest(req, 'validate-natal'),
    (error) => error.statusCode === 403 && error.code === 'TRUST_PROVENANCE_INVALID'
  );
});
