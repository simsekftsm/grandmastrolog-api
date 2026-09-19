'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('./stable');

function read(relative) { return fs.readFileSync(path.resolve(__dirname, relative)); }

function localSemanticDependencies() {
  const kernelBundle = Buffer.concat([
    read('./stable.js'),
    read('./pass-contracts.js'),
    read('./kernel.js'),
    read('./doctrine/natal-core.v1.json')
  ]);
  return {
    kernel_source: kernelBundle,
    astroir_schema: fs.readFileSync(path.resolve(__dirname, '../contracts/gm-astroir-v1.schema.json')),
    extra: {
      narrative_boundary: { version: 'gm_narrative_boundary_v1', sha256: sha256(read('./narrative-boundary.js')) },
      uncertainty_partitioning: { version: 'gm_uncertainty_partitioning_v1', sha256: sha256(read('./uncertainty.js')) },
      migration_registry: { version: 'gm_astroir_migration_registry_v1', sha256: sha256(read('./migration.js')) }
    }
  };
}

module.exports = { localSemanticDependencies };
