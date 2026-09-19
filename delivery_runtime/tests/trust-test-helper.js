'use strict';

const { signTrustedRequest } = require('../lib/trust-boundary');

const TEST_TRUST_SECRET = 'unit-test-gm-secret-not-production';

function installTestTrustSecret() {
  process.env.GM_API_SECRET = TEST_TRUST_SECRET;
  return TEST_TRUST_SECRET;
}

function trustedRequest(routeId, body, method = 'POST') {
  const secret = installTestTrustSecret();
  const seal = signTrustedRequest({ secret, method, routeId, body });
  return {
    method,
    body,
    headers: {
      authorization: `Bearer ${secret}`,
      'x-gm-evidence-source': seal.source,
      'x-gm-evidence-timestamp': seal.timestamp,
      'x-gm-evidence-signature': seal.signature
    }
  };
}

module.exports = { TEST_TRUST_SECRET, installTestTrustSecret, trustedRequest };
