'use strict';

const { applySecurityHeaders, blockedPayload } = require('../lib/foundation');

module.exports = async function delivery(req, res) {
  applySecurityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED' });
  }

  // M1A-3 can render a validated structured contract on its isolated
  // acceptance surface. M1A-4 owns final-delivery validation, so this public
  // delivery boundary remains fail-closed and never echoes caller content.
  return res.status(503).json(blockedPayload());
};
