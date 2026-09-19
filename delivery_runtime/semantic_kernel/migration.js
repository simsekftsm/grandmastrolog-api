'use strict';

const { sha256, freezeDeep } = require('./stable');

const MIGRATIONS = Object.freeze({
  'gm.astroir.v1->gm.astroir.v1': (artifact) => artifact
});

function migrateArtifact(artifact, targetVersion, authorityEnvelope) {
  const key=`${artifact?.astroir_version}->${targetVersion}`;
  const fn=MIGRATIONS[key];
  if(!fn) throw new Error(`MIGRATION_NOT_REGISTERED:${key}`);
  if(!authorityEnvelope?.authority_id) throw new Error('MIGRATION_AUTHORITY_REQUIRED');
  const migrated=fn(artifact);
  const evidence={
    migration_id:`mig_${sha256({key,source:artifact.artifact_sha256,target:targetVersion,authority:authorityEnvelope.authority_id})}`,
    from:artifact.astroir_version,to:targetVersion,diff:[],deterministic:true,provenance_source:artifact.artifact_sha256
  };
  return freezeDeep({artifact:migrated,evidence});
}

module.exports={MIGRATIONS,migrateArtifact};
