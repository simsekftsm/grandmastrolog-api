'use strict';

const { applySecurityHeaders } = require('../lib/foundation');
const { enforceTrustedRequest } = require('../lib/trust-boundary');
const {
  DeliveryValidationError,
  validateFinalDelivery
} = require('../lib/delivery-validator');
const {
  ContractValidationError,
  SchemaValidationError,
  RendererError,
  ElementVisualError
} = require('../lib/natal-renderer');

function authorizationEnabled() {
  return process.env.GM_FINAL_DELIVERY_AUTHORIZED === 'true';
}

module.exports = async function delivery(req, res) {
  applySecurityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED' });
  }
  if (!enforceTrustedRequest(req, res, 'delivery')) return;
  if (!authorizationEnabled()) {
    return res.status(503).json({
      ok: false,
      code: 'FINAL_DELIVERY_NOT_AUTHORIZED',
      raw_delivery_allowed: false,
      delivery_validator_enabled: false,
      final_delivery_authorized: false
    });
  }

  try {
    const outer = req.body;
    if (!outer || typeof outer !== 'object' || Array.isArray(outer)) {
      return res.status(400).json({ ok: false, code: 'INVALID_REQUEST' });
    }
    const allowed = ['binding_input', 'semantic_payload'];
    for (const key of Object.keys(outer)) {
      if (!allowed.includes(key)) {
        return res.status(400).json({ ok: false, code: 'UNKNOWN_FIELD', path: `$.${key}` });
      }
    }
    if (!Object.prototype.hasOwnProperty.call(outer, 'binding_input') || !Object.prototype.hasOwnProperty.call(outer, 'semantic_payload')) {
      return res.status(400).json({ ok: false, code: 'MISSING_REQUIRED_FIELD' });
    }

    const finalDelivery = validateFinalDelivery(outer.binding_input, outer.semantic_payload);
    return res.status(200).json({
      ok: true,
      delivery_validator_enabled: true,
      final_delivery_authorized: true,
      delivery: finalDelivery
    });
  } catch (error) {
    if (error instanceof DeliveryValidationError) {
      return res.status(error.statusCode).json({ ok: false, code: error.code, path: error.path });
    }
    if (error instanceof ContractValidationError || error instanceof SchemaValidationError || error instanceof RendererError || error instanceof ElementVisualError) {
      return res.status(422).json({ ok: false, code: error.code || 'DELIVERY_REJECTED', path: error.path || '$' });
    }
    return res.status(500).json({ ok: false, code: 'DELIVERY_INTERNAL_ERROR' });
  }
};
