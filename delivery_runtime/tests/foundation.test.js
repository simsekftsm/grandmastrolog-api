'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const health = require('../api/health');
const delivery = require('../api/delivery');
const { statusPayload, blockedPayload } = require('../lib/foundation');

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

test('M1A-4 trust-boundary status preserves M1A-2 and M1A-3 while final delivery stays closed', () => {
  const body = statusPayload();
  assert.equal(body.ok, true);
  assert.equal(body.stage, 'M1A-4-TRUST-BOUNDARY');
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
  assert.equal(body.code, 'M1A_3_DELIVERY_VALIDATOR_NOT_AVAILABLE');
  assert.equal(body.raw_delivery_allowed, false);
  assert.equal(body.structured_contract_enabled, true);
  assert.equal(body.canonical_renderer_enabled, true);
  assert.equal(body.trust_boundary_enabled, true);
  assert.equal(body.delivery_validator_enabled, false);
  assert.equal(body.final_delivery_authorized, false);
});

test('health GET returns 200 with no-store headers', async () => {
  const res = fakeResponse();
  await health({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.trust_boundary_enabled, true);
  assert.equal(res.getHeader('cache-control'), 'no-store');
  assert.equal(res.getHeader('x-content-type-options'), 'nosniff');
});

test('health rejects non-GET', async () => {
  const res = fakeResponse();
  await health({ method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.body.code, 'METHOD_NOT_ALLOWED');
});

test('delivery POST remains fail closed and does not echo raw model output', async () => {
  const raw = '# • DOĞUM HARİTAN •\n> malformed output';
  const res = fakeResponse();
  await delivery({ method: 'POST', body: { raw_output: raw } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'M1A_3_DELIVERY_VALIDATOR_NOT_AVAILABLE');
  assert.equal(res.body.raw_delivery_allowed, false);
  assert.equal(res.body.canonical_renderer_enabled, true);
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
