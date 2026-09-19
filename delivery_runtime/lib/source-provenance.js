'use strict';

// Physical source manifest for every runtime byte that can affect final semantic delivery.
const FILES = Object.freeze({
  'delivery_runtime/api/delivery.js': '58c8ff9e97b7a02542d8d34afbcdbe8767752ee0',
  'delivery_runtime/api/e2e-natal.js': '7004437fd47ce87cc907525aaa54194481cb1bcc',
  'delivery_runtime/api/health.js': '536e3061a23bab293aa9ebf5cf2cb2b41ab2b772',
  'delivery_runtime/api/model-natal.js': 'de4e0d922e4ae7537f2ae3073b82c722ea0314e3',
  'delivery_runtime/api/render-natal.js': '6e6e83ec0098b0cfde0e1f1aee2f7831a34a989f',
  'delivery_runtime/api/validate-natal.js': '80b215152fab6835bcb4e3d1cd8938462b107124',
  'delivery_runtime/contracts/gm-astroir-v1.schema.json': 'ca854f3e673218a096e9912abc9d520ff438dc19',
  'delivery_runtime/contracts/gm-natal-semantic-v1.schema.json': 'ee6fdd7c5a83aa9b897437987bbabaffddc6fa62',
  'delivery_runtime/lib/delivery-validator.js': '38e4bc09f04f6ba1ee59703a3838001acb20f466',
  'delivery_runtime/lib/element-visual.js': '79f11584ff1888b7ff511b5cb3a240788969843c',
  'delivery_runtime/lib/foundation.js': '0089910026d3d0379c7bbea9b01bce3adaa8748e',
  'delivery_runtime/lib/groq-binding.js': '0c42bb26bd12435cb28ce15c5d7d309e6f4037c6',
  'delivery_runtime/lib/model-binding.js': '92be6bb132fb607315b3946e4bdc130fbcae527b',
  'delivery_runtime/lib/natal-contract.js': '0bab4bf3ea81be7a26325486a64b6759ed9b3cb8',
  'delivery_runtime/lib/natal-renderer.js': 'e51c663c542d5f6b12d3950636ad1f86748bdfad',
  'delivery_runtime/lib/schema-runtime.js': '83aec261b4f9393c77f62210fd905b4abbca733f',
  'delivery_runtime/lib/trust-boundary.js': 'ffbaf0379379c6e21dfcbc86209cd1f966781047',
  'delivery_runtime/package.json': '4806bdc6dc199381660b549475e5f36b8aecd51f',
  'delivery_runtime/public/elements/ates.png': 'd8e4d500586a24541955a8523cc3fbda68987825',
  'delivery_runtime/public/elements/hava.png': '303fb8bbf897007c9d942ed6ae4882078de2ccbe',
  'delivery_runtime/public/elements/su.png': 'dc421441b5b82faf8e599ab20b717dc50e22c296',
  'delivery_runtime/public/elements/toprak.png': '8a64f0f2470b43b92bd33e0a506a65cfbc60a029',
  'delivery_runtime/semantic_kernel/dependency-runtime.js': 'dec9d3d5bc50048fe09eca63e7bf9bf24dc2d6c0',
  'delivery_runtime/semantic_kernel/doctrine/natal-core.v1.json': 'f28e995997f758bac779ab26649d86bbd4cabb4a',
  'delivery_runtime/semantic_kernel/kernel.js': '99af753585803e57ddf6ee0753dce5c1a29f1cb4',
  'delivery_runtime/semantic_kernel/migration.js': 'a7675d3f756a41e53239094a4c0621671a59b039',
  'delivery_runtime/semantic_kernel/narrative-boundary.js': 'f2c51d3ba641edff64c3f9a4e26644559af23084',
  'delivery_runtime/semantic_kernel/pass-contracts.js': '2f43193ef7afd2233213f85630d00157f991ee24',
  'delivery_runtime/semantic_kernel/stable.js': '8b720f42f1ce6e770b4b21272d17e1adca0fbede',
  'delivery_runtime/semantic_kernel/transaction-store.js': '3c46f35e2e491ea8d183eadf40b5890988e96eb5',
  'delivery_runtime/semantic_kernel/uncertainty.js': 'ed4478f25799e62f5eeb6e7fa8f9f06240d14692',
  'delivery_runtime/vercel.json': '45013816265b435af66145e71cfc90248ce1c814'
});

const FINGERPRINT = 'a3ab78b342cf4d12dd8aa0c5b347ef0d1cce2cd28f541f785322e8c7d1105dbf';

function sourceProvenance() {
  return {
    algorithm: 'git-blob-sha1-manifest-v1',
    fingerprint: FINGERPRINT,
    files: { ...FILES }
  };
}

module.exports = { sourceProvenance };
