'use strict';

// Only files that are physically shipped in the Vercel M1A-2 runtime are
// represented here. Tests, workflow files and repository-only documents are
// intentionally excluded from production-source provenance.
const FILES = Object.freeze({
  'delivery_runtime/api/delivery.js': '5edf2f01a5d74297fe3a83f8255ad4c0eefd001f',
  'delivery_runtime/api/health.js': '536e3061a23bab293aa9ebf5cf2cb2b41ab2b772',
  'delivery_runtime/api/model-natal.js': '91de205f4b54b905ebcd963d35299fea341d694e',
  'delivery_runtime/api/validate-natal.js': 'a2ea512c7e1443ba5d7accf50a555902b1ea496b',
  'delivery_runtime/contracts/gm-natal-semantic-v1.schema.json': 'ee6fdd7c5a83aa9b897437987bbabaffddc6fa62',
  'delivery_runtime/lib/foundation.js': 'e919818e57aad97080366a6dcdf907405b2b77dd',
  'delivery_runtime/lib/groq-binding.js': '88c2b59f6488ff9e35843df7ae8f9c2e6f7a8e45',
  'delivery_runtime/lib/model-binding.js': '92be6bb132fb607315b3946e4bdc130fbcae527b',
  'delivery_runtime/lib/natal-contract.js': '5f08db4201bed7d45e5ebc903c289e0b972dc25f',
  'delivery_runtime/lib/schema-runtime.js': '83aec261b4f9393c77f62210fd905b4abbca733f',
  'delivery_runtime/package.json': '4eae5ec46a534e69d761d614704fd8a788abe505',
  'delivery_runtime/vercel.json': 'ce01913795915116f2803de4b18dc7f95c285e1b'
});

const FINGERPRINT = 'e57bfe54241a3be61e2c8f9dc3dcb83c15fd3d3449ce28fb53336472528271a9';

function sourceProvenance() {
  return {
    algorithm: 'git-blob-sha1-manifest-v1',
    fingerprint: FINGERPRINT,
    files: { ...FILES }
  };
}

module.exports = { sourceProvenance };
