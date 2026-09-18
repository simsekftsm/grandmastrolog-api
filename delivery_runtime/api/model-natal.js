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

function providerErrorResponse(res, error) {
  const body = { ok: false, code: error.code };
  if (error.upstream_provider) body.upstream_provider = error.upstream_provider;
  if (error.upstream_status !== undefined) body.upstream_status = error.upstream_status;
  if (error.expected_provider) body.expected_provider = error.expected_provider;
  if (error.expected_model) body.expected_model = error.expected_model;
  return res.status(error.statusCode || 500).json(body);
}

module.exports = async function modelNatal(req, res) {
  applySecurityHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED' });
  }

  if (!enforceTrustedRequest(req, res, 'model-natal')) return;

  try {
    const { evidenceMap, availability } = validateBindingInput(req.body);
    const generated = await generateSemanticCandidate(req.body);
    const canonicalPayload = canonicalizeModelPayload(generated.candidate, evidenceMap, availability);
    const contract = makeValidatedEnvelope(canonicalPayload, evidenceMap, availability);

    return res.status(200).json({
      ok: true,
      model_binding: generated.model_binding,
      provider: generated.provider,
      model: generated.model,
      contract
    });
  } catch (error) {
    if (error instanceof ProviderAdapterError) return providerErrorResponse(res, error);
    if (error instanceof ContractValidationError || error instanceof SchemaValidationError) {
      return res.status(422).json({ ok: false, code: error.code, path: error.path });
    }
    return res.status(500).json({ ok: false, code: 'MODEL_BINDING_INTERNAL_ERROR' });
  }
};
