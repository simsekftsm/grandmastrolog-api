'use strict';

const { applySecurityHeaders, statusPayload } = require('../lib/foundation');
const { sourceProvenance } = require('../lib/source-provenance');

module.exports = async function health(req, res) {
  applySecurityHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED' });
  }

  return res.status(200).json({ ...statusPayload(), source_provenance: sourceProvenance() });
};
