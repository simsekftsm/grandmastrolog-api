'use strict';

const { sha256, freezeDeep } = require('./stable');
const { verifyFrozenArtifact } = require('./kernel');

const MIGRATIONS = Object.freeze({
  'gm.astroir.v1->gm.astroir.v1': (artifact) => artifact
});

function migrateArtifact(artifact, targetVersion, authorityEnvelope) {
  verifyFrozenArtifact(artifact);
  const key = `${artifact.astroir_version}->${targetVersion}`;
  const fn = MIGRATIONS[key];
  if (!fn) throw new Error(`MIGRATION_NOT_REGISTERED:${key}`);
  if (!authorityEnvelope?.authority_id) throw new Error('MIGRATION_AUTHORITY_REQUIRED');

  const sourceSemanticId = artifact.semantic_artifact_id;
  const migrationDerivationId = `drv_${sha256({
    kind:'SCHEMA_MIGRATION',
    key,
    source_semantic_artifact_id:sourceSemanticId,
    authority:authorityEnvelope.authority_id
  })}`;

  const migrated = fn(artifact);
  verifyFrozenArtifact(migrated);

  const diff = sourceSemanticId === migrated.semantic_artifact_id
    ? []
    : [{
        path:'$',
        before_semantic_artifact_id:sourceSemanticId,
        after_semantic_artifact_id:migrated.semantic_artifact_id
      }];

  const migrationBuildId = `build_${sha256({
    kind:'SCHEMA_MIGRATION',
    derivation_id:migrationDerivationId,
    target_version:targetVersion,
    resulting_semantic_artifact_id:migrated.semantic_artifact_id
  })}`;

  const transitionId = `tx_${sha256({
    kind:'SCHEMA_MIGRATION',
    source_artifact_sha256:artifact.artifact_sha256,
    build_id:migrationBuildId,
    authority:authorityEnvelope.authority_id,
    diff
  })}`;

  const evidence = {
    migration_id:`mig_${sha256({key,source:artifact.artifact_sha256,target:targetVersion,authority:authorityEnvelope.authority_id})}`,
    derivation_id:migrationDerivationId,
    build_id:migrationBuildId,
    transition_id:transitionId,
    from:artifact.astroir_version,
    to:targetVersion,
    diff,
    deterministic:true,
    provenance_source:artifact.artifact_sha256,
    source_semantic_artifact_id:sourceSemanticId,
    resulting_semantic_artifact_id:migrated.semantic_artifact_id,
    acceptance_evidence:{
      source_verified:true,
      result_verified:true,
      explicit_registry_entry:key
    }
  };
  return freezeDeep({ artifact:migrated, evidence });
}

module.exports = { MIGRATIONS, migrateArtifact };
