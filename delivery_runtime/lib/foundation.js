'use strict';

const SERVICE = 'grandmastrolog-delivery-runtime';
const STAGE = 'M1A-4-TRUST-BOUNDARY';
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
    trust_boundary_enabled: true,
    privileged_surface_authentication: 'gm_api_secret_hmac_v1',
    trusted_evidence_provenance_required: true,
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
    trust_boundary_enabled: true,
    privileged_surface_authentication: 'gm_api_secret_hmac_v1',
    trusted_evidence_provenance_required: true,
    delivery_validator_enabled: false,
    final_delivery_authorized: false,
    message: 'Deterministic canonical rendering remains acceptance-only. Final user delivery remains fail-closed while M1A-4 continues.'
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
