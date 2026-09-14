'use strict';

const { applySecurityHeaders, blockedPayload } = require('../lib/foundation');

module.exports = async function delivery(req, res) {
  applySecurityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED' });
  }

  // M1A-2 can create and validate structured semantic Natal data, but no
  // user-visible rendering is authorized until M1A-3 and M1A-4 exist.
  return res.status(503).json(blockedPayload());
};
