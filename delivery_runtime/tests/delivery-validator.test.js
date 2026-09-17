'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const deliveryApi = require('../api/delivery');
const { signTrustedRequest } = require('../lib/trust-boundary');
const { renderCanonicalNatal } = require('../lib/natal-renderer');
const {
  EXPECTED_PROJECT_ID,
  DeliveryValidationError,
  fingerprintFiles,
  verifySourceManifest,
  validateFinalDelivery
} = require('../lib/delivery-validator');
const { bindingInput, validPayload } = require('./helpers');

const TEST_SECRET = 'unit-test-gm-secret-not-production';
process.env.GM_API_SECRET = TEST_SECRET;
process.env.GM_FINAL_DELIVERY_AUTHORIZED = 'true';
process.env.VERCEL_PROJECT_ID = EXPECTED_PROJECT_ID;
process.env.VERCEL_ENV = 'production';
process.env.VERCEL_DEPLOYMENT_ID = 'dpl_unitTestFinalDelivery';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
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
function trustedRequest(body) {
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
async function call(body, req = null) {
  const res = fakeResponse();
  await deliveryApi(req || trustedRequest(body), res);
  return res;
}
function validBody() { return { binding_input: bindingInput(), semantic_payload: validPayload() }; }
function testProvenance() {
  return {
    source: { fingerprint: 'a'.repeat(64) },
    deployment: { deployment_id: 'dpl_unitTestFinalDelivery', project_id: EXPECTED_PROJECT_ID, environment: 'production' }
  };
}

test('M1A-4 positive: trusted valid request produces canonical final delivery', async () => {
  const res = await call(validBody());
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.delivery_validator_enabled, true);
  assert.equal(res.body.final_delivery_authorized, true);
  assert.equal(res.body.delivery.delivery_state, 'final_delivery_validated');
  assert.equal(res.body.delivery.contract_version, 'gm.natal.v1');
  assert.match(res.body.delivery.canonical_markdown_sha256, /^[a-f0-9]{64}$/);
  assert.match(res.body.delivery.contract_sha256, /^[a-f0-9]{64}$/);
  assert.match(res.body.delivery.delivery_binding_sha256, /^[a-f0-9]{64}$/);
  const serialized = JSON.stringify(res.body);
  assert.equal(serialized.includes('semantic_payload'), false);
  assert.equal(serialized.includes('raw_model_output'), false);
});

test('M1A-4 positive: same validated input has deterministic canonical shell and binding', async () => {
  const a = await call(validBody());
  const b = await call(validBody());
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(a.body.delivery.canonical_markdown, b.body.delivery.canonical_markdown);
  assert.equal(a.body.delivery.canonical_markdown_sha256, b.body.delivery.canonical_markdown_sha256);
  assert.equal(a.body.delivery.delivery_binding_sha256, b.body.delivery.delivery_binding_sha256);
});

test('raw Markdown or raw model output cannot create delivery authority', async () => {
  const body = { ...validBody(), raw_output: '# forged markdown', raw_model_output: 'forged' };
  const res = await call(body);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'UNKNOWN_FIELD');
  assert.equal(JSON.stringify(res.body).includes('forged markdown'), false);
});

test('caller validated/verified assertions cannot create delivery authority', async () => {
  const body = { ...validBody(), validated: true, verified: true };
  const res = await call(body);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'UNKNOWN_FIELD');
});

test('caller-supplied fake render is rejected rather than trusted', async () => {
  const body = { ...validBody(), render: { canonical_markdown: '# fake' } };
  const res = await call(body);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.path, '$.render');
});

test('fake or stale accepted envelope is rejected at the delivery boundary', async () => {
  const body = { ...validBody(), accepted_envelope: { contract_version: 'gm.natal.v1', validated: true } };
  const res = await call(body);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.path, '$.accepted_envelope');
});

test('caller-supplied provenance is rejected at the delivery boundary', async () => {
  const body = { ...validBody(), provenance: { deployment_id: 'dpl_forged', source_fingerprint: '0'.repeat(64) } };
  const res = await call(body);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.path, '$.provenance');
});

test('malformed gm.natal.v1 semantic schema fails closed', async () => {
  const body = validBody();
  body.semantic_payload.contract_version = 'gm.natal.v0';
  const res = await call(body);
  assert.equal(res.statusCode, 422);
  assert.notEqual(res.body.code, undefined);
});

test('forged verified evidence fails closed', async () => {
  const body = validBody();
  body.binding_input.verified_evidence[0].verification_state = 'verified-by-caller';
  const res = await call(body);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'WRONG_CONSTANT');
});

test('missing required evidence fails closed', async () => {
  const body = validBody();
  body.binding_input.verified_evidence.pop();
  const res = await call(body);
  assert.equal(res.statusCode, 422);
  assert.notEqual(res.body.code, undefined);
});

test('unauthorized request is rejected before delivery validation', async () => {
  const res = await call(validBody(), { method: 'POST', body: validBody(), headers: {} });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'UNAUTHORIZED');
});

test('altered body after trust sealing is rejected', async () => {
  const body = validBody();
  const req = trustedRequest(body);
  req.body = clone(body);
  req.body.semantic_payload.pre_seal_sections[0].body_paragraphs[0] += ' değişti';
  const res = await call(req.body, req);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'TRUST_PROVENANCE_INVALID');
});

test('wrong deployment provenance fails closed', () => {
  assert.throws(
    () => validateFinalDelivery(bindingInput(), validPayload(), {
      runtimeEnv: { VERCEL_PROJECT_ID: 'prj_wrong', VERCEL_ENV: 'production', VERCEL_DEPLOYMENT_ID: 'dpl_valid' },
      provenanceVerifier: (env) => {
        if (env.VERCEL_PROJECT_ID !== EXPECTED_PROJECT_ID) throw new DeliveryValidationError(503, 'DEPLOYMENT_PROVENANCE_MISMATCH');
        return testProvenance();
      }
    }),
    (error) => error.code === 'DEPLOYMENT_PROVENANCE_MISMATCH'
  );
});

test('wrong source fingerprint is killed by physical manifest binding', () => {
  const bytes = Buffer.from('x', 'utf8');
  const files = { 'delivery_runtime/api/example.js': crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex') };
  const provenance = { algorithm: 'git-blob-sha1-manifest-v1', fingerprint: '0'.repeat(64), files };
  assert.notEqual(fingerprintFiles(files), provenance.fingerprint);
  assert.throws(() => verifySourceManifest(provenance, () => bytes), (error) => error.code === 'SOURCE_FINGERPRINT_MISMATCH');
});

test('renderer postcondition violation fails closed even with matching hash', () => {
  const base = renderCanonicalNatal(bindingInput(), validPayload());
  const mutated = clone(base);
  mutated.canonical_markdown = mutated.canonical_markdown.replace('> ## • PROFİLİN •', '> ## • SAHTE •');
  mutated.canonical_markdown_sha256 = crypto.createHash('sha256').update(mutated.canonical_markdown, 'utf8').digest('hex');
  assert.throws(
    () => validateFinalDelivery(bindingInput(), validPayload(), { renderer: () => mutated, provenanceVerifier: testProvenance }),
    (error) => error.code === 'RENDER_POSTCONDITION_FAILED'
  );
});

test('non-deterministic renderer output fails closed', () => {
  const base = renderCanonicalNatal(bindingInput(), validPayload());
  let callCount = 0;
  const renderer = () => {
    callCount += 1;
    const out = clone(base);
    out.visual_attachments = [...out.visual_attachments, ...(callCount === 2 ? [{ attachment_id: 'mutant' }] : [])];
    return out;
  };
  assert.throws(
    () => validateFinalDelivery(bindingInput(), validPayload(), { renderer, provenanceVerifier: testProvenance }),
    (error) => error.code === 'NON_DETERMINISTIC_CANONICAL_RENDER'
  );
});

test('upstream failure/timeout payload cannot be promoted to final delivery', async () => {
  const body = { binding_input: bindingInput(), upstream_error: 'timeout' };
  const res = await call(body);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'UNKNOWN_FIELD');
});

test('final delivery remains disabled when production authorization is absent', async () => {
  const old = process.env.GM_FINAL_DELIVERY_AUTHORIZED;
  delete process.env.GM_FINAL_DELIVERY_AUTHORIZED;
  try {
    const res = await call(validBody());
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'FINAL_DELIVERY_NOT_AUTHORIZED');
    assert.equal(res.body.delivery_validator_enabled, false);
    assert.equal(res.body.final_delivery_authorized, false);
  } finally {
    if (old === undefined) delete process.env.GM_FINAL_DELIVERY_AUTHORIZED;
    else process.env.GM_FINAL_DELIVERY_AUTHORIZED = old;
  }
});
