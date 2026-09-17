'use strict';

const { applySecurityHeaders } = require('../lib/foundation');
const { enforceTrustedRequest } = require('../lib/trust-boundary');
const {
  ContractValidationError,
  SchemaValidationError,
  validateBindingInput,
  makeValidatedEnvelope
} = require('../lib/natal-contract');

module.exports = async function validateNatal(req, res) {
  applySecurityHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED' });
  }
  if (!enforceTrustedRequest(req, res, 'validate-natal')) return;
  try {
    const outer = req.body;
    if (!outer || typeof outer !== 'object' || Array.isArray(outer)) {
      return res.status(400).json({ ok: false, code: 'INVALID_REQUEST' });
    }
    const allowed = ['binding_input', 'semantic_payload'];
    for (const key of Object.keys(outer)) {
      if (!allowed.includes(key)) return res.status(400).json({ ok: false, code: 'UNKNOWN_FIELD', path: `$.${key}` });
    }
    if (!Object.prototype.hasOwnProperty.call(outer, 'binding_input') || !Object.prototype.hasOwnProperty.call(outer, 'semantic_payload')) {
      return res.status(400).json({ ok: false, code: 'MISSING_REQUIRED_FIELD' });
    }
    const { evidenceMap, availability } = validateBindingInput(outer.binding_input);
    const contract = makeValidatedEnvelope(outer.semantic_payload, evidenceMap, availability);
    return res.status(200).json({ ok: true, contract });
  } catch (error) {
    if (error instanceof ContractValidationError || error instanceof SchemaValidationError) {
      return res.status(422).json({ ok: false, code: error.code, path: error.path });
    }
    return res.status(500).json({ ok: false, code: 'VALIDATION_INTERNAL_ERROR' });
  }
};
