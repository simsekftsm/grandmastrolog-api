'use strict';

// Only files physically shipped in the Vercel M1A-3 runtime are represented
// here. Tests, workflow files and repository-only lock documents are excluded.
const FILES = Object.freeze({
  'delivery_runtime/api/delivery.js': 'f5ecef0cea45c9687381580f397702c4612d6b0f',
  'delivery_runtime/api/health.js': '536e3061a23bab293aa9ebf5cf2cb2b41ab2b772',
  'delivery_runtime/api/model-natal.js': '91de205f4b54b905ebcd963d35299fea341d694e',
  'delivery_runtime/api/render-natal.js': '886e10c249f570691dbacf6235ac492caddcc521',
  'delivery_runtime/api/validate-natal.js': 'a2ea512c7e1443ba5d7accf50a555902b1ea496b',
  'delivery_runtime/contracts/gm-natal-semantic-v1.schema.json': 'ee6fdd7c5a83aa9b897437987bbabaffddc6fa62',
  'delivery_runtime/lib/element-visual.js': '79f11584ff1888b7ff511b5cb3a240788969843c',
  'delivery_runtime/lib/foundation.js': '476c0aa012d21d2c07e5557690a89edded5ff29b',
  'delivery_runtime/lib/groq-binding.js': '88c2b59f6488ff9e35843df7ae8f9c2e6f7a8e45',
  'delivery_runtime/lib/model-binding.js': '92be6bb132fb607315b3946e4bdc130fbcae527b',
  'delivery_runtime/lib/natal-contract.js': '5f08db4201bed7d45e5ebc903c289e0b972dc25f',
  'delivery_runtime/lib/natal-renderer.js': '633308e9d32ae66456426208fe1b92da69b8934b',
  'delivery_runtime/lib/schema-runtime.js': '83aec261b4f9393c77f62210fd905b4abbca733f',
  'delivery_runtime/package.json': '4806bdc6dc199381660b549475e5f36b8aecd51f',
  'delivery_runtime/public/elements/ates.png': 'd8e4d500586a24541955a8523cc3fbda68987825',
  'delivery_runtime/public/elements/hava.png': '303fb8bbf897007c9d942ed6ae4882078de2ccbe',
  'delivery_runtime/public/elements/su.png': 'dc421441b5b82faf8e599ab20b717dc50e22c296',
  'delivery_runtime/public/elements/toprak.png': '8a64f0f2470b43b92bd33e0a506a65cfbc60a029',
  'delivery_runtime/vercel.json': 'ce01913795915116f2803de4b18dc7f95c285e1b'
});

const FINGERPRINT = 'a16f941fbf64701a916c2f3da09a2ce56451f476e39ff7529e632a456cdb5398';

function sourceProvenance() {
  return {
    algorithm: 'git-blob-sha1-manifest-v1',
    fingerprint: FINGERPRINT,
    files: { ...FILES }
  };
}

module.exports = { sourceProvenance };
