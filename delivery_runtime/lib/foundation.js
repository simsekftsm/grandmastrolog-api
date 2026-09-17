'use strict';

const SERVICE = 'grandmastrolog-delivery-runtime';
const MODE = 'fail-closed';
const FOUNDATION_CODE = 'M1A_4_FINAL_DELIVERY_NOT_AUTHORIZED';

function finalDeliveryAuthorized() {
  return process.env.GM_FINAL_DELIVERY_AUTHORIZED === 'true';
}

function applySecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

function statusPayload() {
  const authorized = finalDeliveryAuthorized();
  return {
    ok: true,
    service: SERVICE,
    stage: authorized ? 'M1A-4' : 'M1A-4-FINAL-DELIVERY-CANDIDATE',
    mode: MODE,
    delivery_boundary: 'present',
    raw_delivery_allowed: false,
    structured_contract_enabled: true,
    canonical_renderer_enabled: true,
    trust_boundary_enabled: true,
    privileged_surface_authentication: 'gm_api_secret_hmac_v1',
    trusted_evidence_provenance_required: true,
    delivery_validator_enabled: authorized,
    final_delivery_authorized: authorized,
    next_stage: authorized ? null : 'M1A-4'
  };
}

function blockedPayload() {
  return {
    ok: false,
    service: SERVICE,
    stage: 'M1A-4-FINAL-DELIVERY-CANDIDATE',
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
    message: 'Final delivery remains fail-closed until mandatory local and live M1A-4 acceptance is complete.'
  };
}

module.exports = {
  SERVICE,
  MODE,
  FOUNDATION_CODE,
  finalDeliveryAuthorized,
  applySecurityHeaders,
  statusPayload,
  blockedPayload
};
