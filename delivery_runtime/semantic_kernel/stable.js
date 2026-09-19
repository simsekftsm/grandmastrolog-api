'use strict';

const crypto = require('node:crypto');

function stableSerialize(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('NON_CANONICAL_NUMBER');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  throw new Error('NON_CANONICAL_VALUE');
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : stableSerialize(value), 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

module.exports = { stableSerialize, sha256, freezeDeep };
