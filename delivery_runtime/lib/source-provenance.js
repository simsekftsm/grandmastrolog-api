'use strict';

// Physical source manifest for every Vercel runtime byte that can affect final semantic delivery.
const FILES = Object.freeze({
  'delivery_runtime/api/delivery.js': '58c8ff9e97b7a02542d8d34afbcdbe8767752ee0',
  'delivery_runtime/api/e2e-natal.js': '6e0cd4b0adc10b97c74d20c2dffba209eda1f42c',
  'delivery_runtime/api/health.js': '536e3061a23bab293aa9ebf5cf2cb2b41ab2b772',
  'delivery_runtime/api/model-natal.js': 'de4e0d922e4ae7537f2ae3073b82c722ea0314e3',
  'delivery_runtime/api/render-natal.js': '6e6e83ec0098b0cfde0e1f1aee2f7831a34a989f',
  'delivery_runtime/api/validate-natal.js': '80b215152fab6835bcb4e3d1cd8938462b107124',
  'delivery_runtime/contracts/gm-astroir-v1.schema.json': '142e3ef0d4c05a69567101809862122df05eb60a',
  'delivery_runtime/contracts/gm-natal-semantic-v1.schema.json': 'ee6fdd7c5a83aa9b897437987bbabaffddc6fa62',
  'delivery_runtime/lib/delivery-validator.js': '08603200bdcb7ebe1fcc3548cc3bca4920669fb7',
  'delivery_runtime/lib/element-visual.js': '79f11584ff1888b7ff511b5cb3a240788969843c',
  'delivery_runtime/lib/foundation.js': '0089910026d3d0379c7bbea9b01bce3adaa8748e',
  'delivery_runtime/lib/groq-binding.js': '0c42bb26bd12435cb28ce15c5d7d309e6f4037c6',
  'delivery_runtime/lib/model-binding.js': '92be6bb132fb607315b3946e4bdc130fbcae527b',
  'delivery_runtime/lib/natal-contract.js': '0bab4bf3ea81be7a26325486a64b6759ed9b3cb8',
  'delivery_runtime/lib/natal-renderer.js': 'e51c663c542d5f6b12d3950636ad1f86748bdfad',
  'delivery_runtime/lib/schema-runtime.js': '775b0467be6b3bbd0f9b49bf81ac2a19fe24fd53',
  'delivery_runtime/lib/trust-boundary.js': 'ffbaf0379379c6e21dfcbc86209cd1f966781047',
  'delivery_runtime/package.json': '4806bdc6dc199381660b549475e5f36b8aecd51f',
  'delivery_runtime/public/elements/ates.png': 'd8e4d500586a24541955a8523cc3fbda68987825',
  'delivery_runtime/public/elements/hava.png': '303fb8bbf897007c9d942ed6ae4882078de2ccbe',
  'delivery_runtime/public/elements/su.png': 'dc421441b5b82faf8e599ab20b717dc50e22c296',
  'delivery_runtime/public/elements/toprak.png': '8a64f0f2470b43b92bd33e0a506a65cfbc60a029',
  'delivery_runtime/semantic_kernel/dependency-runtime.js': 'aa0656c531c4fa36d07a64d766864cd32a619ef9',
  'delivery_runtime/semantic_kernel/doctrine/natal-core.v1.json': '081ea9ccd6e119dc111f904f117a66ef42410814',
  'delivery_runtime/semantic_kernel/kernel.js': 'a9873e6a8aad32194340816222c54092b7d122fe',
  'delivery_runtime/semantic_kernel/migration.js': '63cf52dd05c71d5d8aa46dbc2bc4956e23a727f6',
  'delivery_runtime/semantic_kernel/narrative-boundary.js': 'f8eb658166e26babd6ee08af436dc820a429a7ea',
  'delivery_runtime/semantic_kernel/pass-contracts.js': '80aacd6d231ca77fb480e92da755b11148bb6f2f',
  'delivery_runtime/semantic_kernel/stable.js': '8b720f42f1ce6e770b4b21272d17e1adca0fbede',
  'delivery_runtime/semantic_kernel/transaction-store.js': 'e80a88968ba36f3ec166163007819af7a4bbc00a',
  'delivery_runtime/semantic_kernel/uncertainty.js': 'ed4478f25799e62f5eeb6e7fa8f9f06240d14692',
  'delivery_runtime/vercel.json': '45013816265b435af66145e71cfc90248ce1c814',
});

const FINGERPRINT = '62089aaca449f3e62aa6f8e746583ac379e543ac07828abd0751b3f61b5ce5ee';

function sourceProvenance() {
  return {
    algorithm: 'git-blob-sha1-manifest-v1',
    fingerprint: FINGERPRINT,
    files: { ...FILES }
  };
}

module.exports = { sourceProvenance };
