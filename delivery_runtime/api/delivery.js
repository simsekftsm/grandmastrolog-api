'use strict';

const { applySecurityHeaders, blockedPayload } = require('../lib/foundation');

module.exports = async function delivery(req, res) {
  applySecurityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED' });
  }

  // M1A-1 establishes the mandatory delivery boundary only.
  // It deliberately forwards no model text. M1A-2+ will add the
  // structured contract, deterministic renderer, and validation path.
  return res.status(503).json(blockedPayload());
};
