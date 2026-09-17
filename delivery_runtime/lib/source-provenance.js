'use strict';

// Only files governed by the accepted M1A-4 delivery-runtime provenance surface are represented here.
// The later real E2E integration endpoint is fingerprinted separately by its own acceptance gate.
const FILES = Object.freeze({
  'delivery_runtime/api/delivery.js': '58c8ff9e97b7a02542d8d34afbcdbe8767752ee0',
  'delivery_runtime/api/health.js': '536e3061a23bab293aa9ebf5cf2cb2b41ab2b772',
  'delivery_runtime/api/model-natal.js': '046d62aac226be26207283692d22cf646a67102e',
  'delivery_runtime/api/render-natal.js': '6e6e83ec0098b0cfde0e1f1aee2f7831a34a989f',
  'delivery_runtime/api/validate-natal.js': '80b215152fab6835bcb4e3d1cd8938462b107124',
  'delivery_runtime/contracts/gm-natal-semantic-v1.schema.json': 'ee6fdd7c5a83aa9b897437987bbabaffddc6fa62',
  'delivery_runtime/lib/delivery-validator.js': '315df611eedc7d1121f99204a5fb558ce6d2f17a',
  'delivery_runtime/lib/element-visual.js': '79f11584ff1888b7ff511b5cb3a240788969843c',
  'delivery_runtime/lib/foundation.js': '0089910026d3d0379c7bbea9b01bce3adaa8748e',
  'delivery_runtime/lib/groq-binding.js': '88c2b59f6488ff9e35843df7ae8f9c2e6f7a8e45',
  'delivery_runtime/lib/model-binding.js': '92be6bb132fb607315b3946e4bdc130fbcae527b',
  'delivery_runtime/lib/natal-contract.js': '5f08db4201bed7d45e5ebc903c289e0b972dc25f',
  'delivery_runtime/lib/natal-renderer.js': '633308e9d32ae66456426208fe1b92da69b8934b',
  'delivery_runtime/lib/schema-runtime.js': '83aec261b4f9393c77f62210fd905b4abbca733f',
  'delivery_runtime/lib/trust-boundary.js': 'ffbaf0379379c6e21dfcbc86209cd1f966781047',
  'delivery_runtime/package.json': '4806bdc6dc199381660b549475e5f36b8aecd51f',
  'delivery_runtime/public/elements/ates.png': 'd8e4d500586a24541955a8523cc3fbda68987825',
  'delivery_runtime/public/elements/hava.png': '303fb8bbf897007c9d942ed6ae4882078de2ccbe',
  'delivery_runtime/public/elements/su.png': 'dc421441b5b82faf8e599ab20b717dc50e22c296',
  'delivery_runtime/public/elements/toprak.png': '8a64f0f2470b43b92bd33e0a506a65cfbc60a029',
  'delivery_runtime/vercel.json': '00df89d17927cd0872305e680cd2beb180ae6149'
});

const FINGERPRINT = '577b259728a58ee562ee36f04c8c869ded6ad5c775c1f74a6b8b40d861c845a1';

function sourceProvenance() {
  return {
    algorithm: 'git-blob-sha1-manifest-v1',
    fingerprint: FINGERPRINT,
    files: { ...FILES }
  };
}

module.exports = { sourceProvenance };
