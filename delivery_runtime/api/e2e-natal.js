'use strict';

const { applySecurityHeaders } = require('../lib/foundation');
const { enforceTrustedRequest } = require('../lib/trust-boundary');
const {
  ContractValidationError,
  SchemaValidationError,
  validateBindingInput,
  makeValidatedEnvelope
} = require('../lib/natal-contract');
const { canonicalizeModelPayload } = require('../lib/model-binding');
const {
  ProviderAdapterError,
  generateSemanticCandidate
} = require('../lib/provider-adapter');
const {
  DeliveryValidationError,
  validateFinalDelivery
} = require('../lib/delivery-validator');
const {
  RendererError,
  ElementVisualError
} = require('../lib/natal-renderer');

function finalDeliveryAuthorized() {
  return process.env.GM_FINAL_DELIVERY_AUTHORIZED === 'true';
}

function providerErrorResponse(res, error) {
  const body = { ok: false, code: error.code };
  if (error.upstream_provider) body.upstream_provider = error.upstream_provider;
  if (error.upstream_status !== undefined) body.upstream_status = error.upstream_status;
  if (error.expected_provider) body.expected_provider = error.expected_provider;
  if (error.expected_model) body.expected_model = error.expected_model;
  return res.status(error.statusCode || 500).json(body);
}

module.exports = async function e2eNatal(req, res) {
  applySecurityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED' });
  }
  if (!enforceTrustedRequest(req, res, 'e2e-natal')) return;
  if (!finalDeliveryAuthorized()) {
    return res.status(503).json({
      ok: false,
      code: 'FINAL_DELIVERY_NOT_AUTHORIZED',
      delivery_validator_enabled: false,
      final_delivery_authorized: false
    });
  }

  try {
    const outer = req.body;
    if (!outer || typeof outer !== 'object' || Array.isArray(outer)) {
      return res.status(400).json({ ok: false, code: 'INVALID_REQUEST' });
    }
    const keys = Object.keys(outer);
    if (keys.length !== 1 || keys[0] !== 'binding_input') {
      return res.status(400).json({ ok: false, code: 'UNKNOWN_FIELD' });
    }

    const bindingInput = outer.binding_input;
    const { evidenceMap, availability } = validateBindingInput(bindingInput);
    const generated = await generateSemanticCandidate(bindingInput);
    const canonicalPayload = canonicalizeModelPayload(generated.candidate, evidenceMap, availability);
    makeValidatedEnvelope(canonicalPayload, evidenceMap, availability);
    const delivery = validateFinalDelivery(bindingInput, canonicalPayload);

    return res.status(200).json({
      ok: true,
      request_id: bindingInput.request_id,
      model_binding: generated.model_binding,
      provider: generated.provider,
      model: generated.model,
      delivery_validator_enabled: true,
      final_delivery_authorized: true,
      delivery
    });
  } catch (error) {
    if (error instanceof ProviderAdapterError) return providerErrorResponse(res, error);
    if (error instanceof DeliveryValidationError) {
      return res.status(error.statusCode).json({ ok: false, code: error.code, path: error.path });
    }
    if (
      error instanceof ContractValidationError ||
      error instanceof SchemaValidationError ||
      error instanceof RendererError ||
      error instanceof ElementVisualError
    ) {
      return res.status(422).json({ ok: false, code: error.code || 'DELIVERY_REJECTED', path: error.path || '$' });
    }
    return res.status(500).json({ ok: false, code: 'E2E_NATAL_INTERNAL_ERROR' });
  }
};
