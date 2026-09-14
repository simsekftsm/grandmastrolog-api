'use strict';

const FILES = Object.freeze({
  '.github/workflows/m1a1-delivery-runtime-live-acceptance.yml': '2928b76b325721b5dd188811448d80eb29abb5ff',
  'delivery_runtime/README.md': '24bb2c76e686ede51539b448e4c15cf05ee48df8',
  'delivery_runtime/api/delivery.js': '5edf2f01a5d74297fe3a83f8255ad4c0eefd001f',
  'delivery_runtime/api/health.js': 'c5bc78af809c84feb07e60d35c8e920ea6b8dd71',
  'delivery_runtime/api/model-natal.js': '91de205f4b54b905ebcd963d35299fea341d694e',
  'delivery_runtime/api/validate-natal.js': 'a2ea512c7e1443ba5d7accf50a555902b1ea496b',
  'delivery_runtime/contracts/gm-natal-semantic-v1.schema.json': 'ee6fdd7c5a83aa9b897437987bbabaffddc6fa62',
  'delivery_runtime/lib/foundation.js': 'e919818e57aad97080366a6dcdf907405b2b77dd',
  'delivery_runtime/lib/groq-binding.js': '88c2b59f6488ff9e35843df7ae8f9c2e6f7a8e45',
  'delivery_runtime/lib/model-binding.js': '92be6bb132fb607315b3946e4bdc130fbcae527b',
  'delivery_runtime/lib/natal-contract.js': '5f08db4201bed7d45e5ebc903c289e0b972dc25f',
  'delivery_runtime/lib/schema-runtime.js': '83aec261b4f9393c77f62210fd905b4abbca733f',
  'delivery_runtime/package.json': '4eae5ec46a534e69d761d614704fd8a788abe505',
  'delivery_runtime/tests/api.test.js': 'a17efb8f7b809a0090d253d5d3ddfbed4ccd4297',
  'delivery_runtime/tests/foundation.test.js': '7bd005c80a877385d25fd8f648e449164f5e703d',
  'delivery_runtime/tests/groq-binding.test.js': '752f2f732a60ca1cafe3e7e0de0ee448624f1355',
  'delivery_runtime/tests/helpers.js': 'c960e370b0c844097fe61d9ab0e1cfcbab6107b8',
  'delivery_runtime/tests/model-binding.test.js': '3b674c726f743cd0d85402c4f481a0b34c4b5b46',
  'delivery_runtime/tests/natal-contract.test.js': 'ed907dbc1a2aeb923cdc3e615682148d27534389',
  'delivery_runtime/vercel.json': 'ce01913795915116f2803de4b18dc7f95c285e1b'
});

const FINGERPRINT = 'a88d634cf3a5d89afae5a348a683905d9dce45c51a274acd5d5993a48f4938de';

function sourceProvenance() {
  return {
    algorithm: 'git-blob-sha1-manifest-v1',
    fingerprint: FINGERPRINT,
    files: { ...FILES }
  };
}

module.exports = { sourceProvenance };
