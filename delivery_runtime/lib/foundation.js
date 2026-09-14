'use strict';

const SERVICE = 'grandmastrolog-delivery-runtime';
const STAGE = 'M1A-1';
const MODE = 'fail-closed';
const FOUNDATION_CODE = 'M1A_1_FOUNDATION_ONLY';

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
    structured_contract_enabled: false,
    canonical_renderer_enabled: false,
    delivery_validator_enabled: false,
    next_stage: 'M1A-2'
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
    message: 'Delivery is fail-closed until the structured contract, canonical renderer, and delivery validator are enabled.'
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
