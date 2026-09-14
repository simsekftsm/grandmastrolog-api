'use strict';

// Candidate source authority for the M1A-3 production surface. The four
// canonical Element assets remain fingerprinted by their accepted Git blobs;
// production exposes those exact bytes through immutable external rewrites
// pinned to the accepted M1A-2/baseline commit.
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
  'delivery_runtime/vercel.json': '5d94c5854a749191f893e713cefbf77a0b41cfcc'
});

const FINGERPRINT = 'b12980615e720e1bbf97e00b09a3a3a37830f90cbe356f527edfb2b85335581b';
const CANONICAL_ASSET_SOURCE_COMMIT = 'aacc1eb42034bcc44732aeab9e17be2f199e0432';
const CANONICAL_ASSET_SHA256 = Object.freeze({
  ates: '1f61fa6bb6fd3432a508e310201b70ad7b32966db9253baa6656a9eb33538468',
  hava: 'abb47fdda41cb72bf1dfc0fa819ee6bf971646326bbed171b7208d7367d5205e',
  su: '655e73b56475592cf2c14787fecefc64aa9f2c9e77bcfda745d76ba247c29619',
  toprak: 'b398703724d072b4cd53350eed641278c5a9058cdd93dbe28c828c51db1c68a0'
});

function sourceProvenance() {
  return {
    algorithm: 'git-blob-sha1-manifest-v1',
    fingerprint: FINGERPRINT,
    files: { ...FILES },
    canonical_asset_transport: 'pinned_external_rewrite',
    canonical_asset_source_commit: CANONICAL_ASSET_SOURCE_COMMIT,
    canonical_asset_sha256: { ...CANONICAL_ASSET_SHA256 }
  };
}

module.exports = { sourceProvenance };
