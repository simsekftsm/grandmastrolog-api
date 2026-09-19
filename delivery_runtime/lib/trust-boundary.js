'use strict';

const crypto = require('node:crypto');

const TRUST_VERSION = 'gm-trust-v1';
const TRUST_SOURCE = 'grandmastrolog-api';
const MAX_AGE_SECONDS = 300;
const MAX_FUTURE_SKEW_SECONDS = 60;

class TrustBoundaryError extends Error {
  constructor(statusCode, code) {
    super(code);
    this.name = 'TrustBoundaryError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function stableSerialize(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TrustBoundaryError(400, 'TRUST_BODY_NOT_CANONICAL');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TrustBoundaryError(400, 'TRUST_BODY_NOT_CANONICAL');
    }
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  throw new TrustBoundaryError(400, 'TRUST_BODY_NOT_CANONICAL');
}

function bodyDigest(body) {
  return crypto.createHash('sha256').update(stableSerialize(body ?? {}), 'utf8').digest('hex');
}

function signaturePayload({ method, routeId, source, timestamp, body }) {
  return [
    TRUST_VERSION,
    String(method || '').toUpperCase(),
    routeId,
    source,
    String(timestamp),
    bodyDigest(body)
  ].join('\n');
}

function signTrustedRequest({ secret, method = 'POST', routeId, source = TRUST_SOURCE, timestamp, body }) {
  if (typeof secret !== 'string' || !secret) throw new Error('TEST_OR_SERVER_SECRET_REQUIRED');
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signaturePayload({ method, routeId, source, timestamp: ts, body }), 'utf8')
    .digest('hex');
  return { source, timestamp: String(ts), signature };
}

function getHeader(req, name) {
  if (req && typeof req.header === 'function') {
    const value = req.header(name);
    if (value !== undefined && value !== null) return String(value);
  }
  const headers = req?.headers || {};
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      if (Array.isArray(value)) return value.length ? String(value[0]) : '';
      return value === undefined || value === null ? '' : String(value);
    }
  }
  return '';
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function extractCredential(req) {
  const custom = getHeader(req, 'x-gm-secret').trim();
  const authorization = getHeader(req, 'authorization').trim();
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
  return custom || (bearer ? bearer[1].trim() : '');
}

function verifyTrustedRequest(req, routeId, nowSeconds = Math.floor(Date.now() / 1000)) {
  const secret = String(process.env.GM_API_SECRET || '');
  if (!secret) throw new TrustBoundaryError(503, 'TRUST_MATERIAL_UNAVAILABLE');

  const credential = extractCredential(req);
  if (!credential || !safeEqualText(credential, secret)) {
    throw new TrustBoundaryError(401, 'UNAUTHORIZED');
  }

  const source = getHeader(req, 'x-gm-evidence-source').trim();
  const timestampText = getHeader(req, 'x-gm-evidence-timestamp').trim();
  const signature = getHeader(req, 'x-gm-evidence-signature').trim().toLowerCase();

  if (!source || !timestampText || !signature) {
    throw new TrustBoundaryError(403, 'TRUST_PROVENANCE_REQUIRED');
  }
  if (source !== TRUST_SOURCE) {
    throw new TrustBoundaryError(403, 'TRUST_PROVENANCE_INVALID');
  }

  if (!/^\d{10}$/.test(timestampText)) {
    throw new TrustBoundaryError(403, 'TRUST_PROVENANCE_INVALID');
  }
  const timestamp = Number(timestampText);
  if (
    timestamp < nowSeconds - MAX_AGE_SECONDS ||
    timestamp > nowSeconds + MAX_FUTURE_SKEW_SECONDS
  ) {
    throw new TrustBoundaryError(403, 'TRUST_PROVENANCE_STALE');
  }

  if (!/^[a-f0-9]{64}$/.test(signature)) {
    throw new TrustBoundaryError(403, 'TRUST_PROVENANCE_INVALID');
  }

  const expected = signTrustedRequest({
    secret,
    method: req?.method,
    routeId,
    source,
    timestamp,
    body: req?.body
  }).signature;

  if (!safeEqualText(signature, expected)) {
    throw new TrustBoundaryError(403, 'TRUST_PROVENANCE_INVALID');
  }

  return Object.freeze({
    trust_version: TRUST_VERSION,
    evidence_source: TRUST_SOURCE,
    provenance_bound: true
  });
}

function enforceTrustedRequest(req, res, routeId) {
  try {
    return verifyTrustedRequest(req, routeId);
  } catch (error) {
    if (error instanceof TrustBoundaryError) {
      res.status(error.statusCode).json({ ok: false, code: error.code });
      return null;
    }
    res.status(500).json({ ok: false, code: 'TRUST_BOUNDARY_INTERNAL_ERROR' });
    return null;
  }
}

module.exports = {
  TRUST_VERSION,
  TRUST_SOURCE,
  MAX_AGE_SECONDS,
  TrustBoundaryError,
  stableSerialize,
  bodyDigest,
  signTrustedRequest,
  verifyTrustedRequest,
  enforceTrustedRequest
};
