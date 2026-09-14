'use strict';

const SERVICE = 'grandmastrolog-delivery-runtime';
const STAGE = 'M1A-3';
const MODE = 'fail-closed';
const FOUNDATION_CODE = 'M1A_3_DELIVERY_VALIDATOR_NOT_AVAILABLE';

function applySecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

function statusPayload() {
  return {
    ok: true,
    service: SERVICE,
    stage: STAGE,
    mode: MODE,
    delivery_boundary: 'present',
    raw_delivery_allowed: false,
    structured_contract_enabled: true,
    canonical_renderer_enabled: true,
    delivery_validator_enabled: false,
    final_delivery_authorized: false,
    next_stage: 'M1A-4'
  };
}

function blockedPayload() {
  return {
    ok: false,
    service: SERVICE,
    stage: STAGE,
    code: FOUNDATION_CODE,
    mode: MODE,
    raw_delivery_allowed: false,
    structured_contract_enabled: true,
    canonical_renderer_enabled: true,
    delivery_validator_enabled: false,
    final_delivery_authorized: false,
    message: 'Deterministic canonical rendering is available only on the M1A-3 acceptance surface. Final user delivery remains fail-closed until the M1A-4 delivery validator is enabled.'
  };
}

module.exports = {
  SERVICE,
  STAGE,
  MODE,
  FOUNDATION_CODE,
  applySecurityHeaders,
  statusPayload,
  blockedPayload
};
