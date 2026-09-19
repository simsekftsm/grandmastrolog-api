import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNatalBindingInput } from '../gm_integration/natal-evidence.js';

const syntheticBirth = Object.freeze({
  date: '2000-01-01',
  time: '12:00:00',
  timezone: 'Europe/Istanbul',
  latitude: 39.9208,
  longitude: 32.8541,
  district: 'SyntheticDistrict',
  city: 'SyntheticCity'
});

test('Swiss Ephemeris evidence is deterministic and complete for gm.natal.v1 placement ownership', () => {
  const first = buildNatalBindingInput({ request_id: 'synthetic-e2e-001', birth: syntheticBirth });
  const second = buildNatalBindingInput({ request_id: 'synthetic-e2e-001', birth: syntheticBirth });

  assert.deepEqual(first, second);
  assert.equal(first.source, 'grandmastrolog-api');
  assert.equal(first.engine, 'grandmastrolog_swisseph_natal_v1');
  assert.match(first.evidence_sha256, /^[a-f0-9]{64}$/);

  const evidence = first.binding_input.verified_evidence;
  const placements = evidence.filter((item) => item.kind === 'placement');
  assert.equal(placements.length, 13);
  assert.deepEqual(
    placements.map((item) => item.subject_id),
    ['sun','moon','ascendant','mercury','venus','mars','jupiter','saturn','uranus','neptune','pluto','north_node','mc']
  );
  for (const item of evidence) {
    assert.equal(item.verification_state, 'verified');
    assert.match(item.source_ref, /^astro:\/\/grandmastrolog-api\//);
  }
});

test('caller cannot inject a verified placement through the evidence builder surface', () => {
  const result = buildNatalBindingInput({
    request_id: 'synthetic-e2e-002',
    birth: syntheticBirth,
    verified_evidence: [{
      evidence_id: 'ev_sun',
      verification_state: 'verified',
      sign: 'Injected'
    }]
  });
  const sun = result.binding_input.verified_evidence.find((item) => item.evidence_id === 'ev_sun');
  assert.notEqual(sun.sign, 'Injected');
  assert.equal(sun.verification_state, 'verified');
});

test('invalid astro source input fails closed', () => {
  assert.throws(
    () => buildNatalBindingInput({
      request_id: 'synthetic-e2e-003',
      birth: { ...syntheticBirth, timezone: 'Invalid/Timezone' }
    }),
    /BIRTH_DATETIME_INVALID/
  );
});
