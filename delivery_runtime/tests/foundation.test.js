'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const health = require('../api/health');
const delivery = require('../api/delivery');
const { signTrustedRequest } = require('../lib/trust-boundary');
const { statusPayload, blockedPayload } = require('../lib/foundation');

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

function trustedDelivery(body) {
  const seal = signTrustedRequest({ secret: TEST_SECRET, method: 'POST', routeId: 'delivery', body });
  return {
    method: 'POST', body,
    headers: {
      authorization: `Bearer ${TEST_SECRET}`,
      'x-gm-evidence-source': seal.source,
      'x-gm-evidence-timestamp': seal.timestamp,
      'x-gm-evidence-signature': seal.signature
    }
  };
}

test('M1A-4 final-delivery candidate preserves prior layers while authorization stays closed', () => {
  delete process.env.GM_FINAL_DELIVERY_AUTHORIZED;
  const body = statusPayload();
  assert.equal(body.ok, true);
  assert.equal(body.stage, 'M1A-4-FINAL-DELIVERY-CANDIDATE');
  assert.equal(body.mode, 'fail-closed');
  assert.equal(body.delivery_boundary, 'present');
  assert.equal(body.raw_delivery_allowed, false);
  assert.equal(body.structured_contract_enabled, true);
  assert.equal(body.canonical_renderer_enabled, true);
  assert.equal(body.trust_boundary_enabled, true);
  assert.equal(body.privileged_surface_authentication, 'gm_api_secret_hmac_v1');
  assert.equal(body.trusted_evidence_provenance_required, true);
  assert.equal(body.delivery_validator_enabled, false);
  assert.equal(body.final_delivery_authorized, false);
  assert.equal(body.next_stage, 'M1A-4');
});

test('blocked payload never authorizes raw or final delivery', () => {
  const body = blockedPayload();
  assert.equal(body.ok, false);
  assert.equal(body.code, 'M1A_4_FINAL_DELIVERY_NOT_AUTHORIZED');
  assert.equal(body.raw_delivery_allowed, false);
  assert.equal(body.structured_contract_enabled, true);
  assert.equal(body.canonical_renderer_enabled, true);
  assert.equal(body.trust_boundary_enabled, true);
  assert.equal(body.delivery_validator_enabled, false);
  assert.equal(body.final_delivery_authorized, false);
});

test('health GET returns candidate state with no-store headers before acceptance', async () => {
  delete process.env.GM_FINAL_DELIVERY_AUTHORIZED;
  const res = fakeResponse();
  await health({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.stage, 'M1A-4-FINAL-DELIVERY-CANDIDATE');
  assert.equal(res.body.delivery_validator_enabled, false);
  assert.equal(res.body.final_delivery_authorized, false);
  assert.equal(res.getHeader('cache-control'), 'no-store');
  assert.equal(res.getHeader('x-content-type-options'), 'nosniff');
});

test('health rejects non-GET', async () => {
  const res = fakeResponse();
  await health({ method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.body.code, 'METHOD_NOT_ALLOWED');
});

test('trusted delivery remains fail closed before final authorization and does not echo input', async () => {
  delete process.env.GM_FINAL_DELIVERY_AUTHORIZED;
  const raw = '# • DOĞUM HARİTAN •\n> malformed output';
  const body = { raw_output: raw };
  const res = fakeResponse();
  await delivery(trustedDelivery(body), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'FINAL_DELIVERY_NOT_AUTHORIZED');
  assert.equal(res.body.raw_delivery_allowed, false);
  assert.equal(res.body.delivery_validator_enabled, false);
  assert.equal(res.body.final_delivery_authorized, false);
  assert.equal(JSON.stringify(res.body).includes(raw), false);
  assert.equal(res.getHeader('cache-control'), 'no-store');
});

test('delivery rejects non-POST', async () => {
  const res = fakeResponse();
  await delivery({ method: 'GET' }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.body.code, 'METHOD_NOT_ALLOWED');
});
