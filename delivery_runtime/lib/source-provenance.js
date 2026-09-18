'use strict';

// Files governed by the accepted delivery-runtime provenance surface.
// Provider-neutral semantic generation and normalization are now part of the
// physical runtime trust boundary.
const FILES = Object.freeze({
  'delivery_runtime/api/delivery.js': '58c8ff9e97b7a02542d8d34afbcdbe8767752ee0',
  'delivery_runtime/api/health.js': '536e3061a23bab293aa9ebf5cf2cb2b41ab2b772',
  'delivery_runtime/api/model-natal.js': 'f1d3b5646c614c4c8499a5e13f750345fafe0ade',
  'delivery_runtime/api/render-natal.js': '6e6e83ec0098b0cfde0e1f1aee2f7831a34a989f',
  'delivery_runtime/api/validate-natal.js': '80b215152fab6835bcb4e3d1cd8938462b107124',
  'delivery_runtime/contracts/gm-natal-semantic-v1.schema.json': 'ee6fdd7c5a83aa9b897437987bbabaffddc6fa62',
  'delivery_runtime/lib/delivery-validator.js': '63e1f58127b85135b12cd9aecc30c7c6b5fbfe29',
  'delivery_runtime/lib/element-visual.js': '79f11584ff1888b7ff511b5cb3a240788969843c',
  'delivery_runtime/lib/foundation.js': '0089910026d3d0379c7bbea9b01bce3adaa8748e',
  'delivery_runtime/lib/groq-binding.js': '26010c6dca5faec57f43de13838d84357ca78088',
  'delivery_runtime/lib/model-binding.js': '92be6bb132fb607315b3946e4bdc130fbcae527b',
  'delivery_runtime/lib/natal-contract.js': '0bab4bf3ea81be7a26325486a64b6759ed9b3cb8',
  'delivery_runtime/lib/natal-renderer.js': 'e51c663c542d5f6b12d3950636ad1f86748bdfad',
  'delivery_runtime/lib/provider-adapter.js': 'ad2f18a067700bdc54df713838ae80e7bc52a879',
  'delivery_runtime/lib/schema-runtime.js': '83aec261b4f9393c77f62210fd905b4abbca733f',
  'delivery_runtime/lib/semantic-generation.js': 'd9d3bf73afeb353451eecd875e892d14d7859b9e',
  'delivery_runtime/lib/semantic-normalizer.js': '4af05bfb9dcdeb4da8befb86def81c29cf7e44bd',
  'delivery_runtime/lib/trust-boundary.js': 'ffbaf0379379c6e21dfcbc86209cd1f966781047',
  'delivery_runtime/package.json': '4806bdc6dc199381660b549475e5f36b8aecd51f',
  'delivery_runtime/public/elements/ates.png': 'd8e4d500586a24541955a8523cc3fbda68987825',
  'delivery_runtime/public/elements/hava.png': '303fb8bbf897007c9d942ed6ae4882078de2ccbe',
  'delivery_runtime/public/elements/su.png': 'dc421441b5b82faf8e599ab20b717dc50e22c296',
  'delivery_runtime/public/elements/toprak.png': '8a64f0f2470b43b92bd33e0a506a65cfbc60a029',
  'delivery_runtime/vercel.json': '0948e04cdd2407cb4c3ce4923570a98726d9808c'
});

const FINGERPRINT = 'a93fc65b38808c6e27167bc5a44663bb7aa1e89e60885b6aca4dea854182d04d';

function sourceProvenance() {
  return {
    algorithm: 'git-blob-sha1-manifest-v1',
    fingerprint: FINGERPRINT,
    files: { ...FILES }
  };
}

module.exports = { sourceProvenance };
