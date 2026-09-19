'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('./stable');
const { verifyFrozenArtifact } = require('./kernel');

class AtomicSemanticStore {
  constructor(directory) {
    this.directory = directory;
    this.snapshotPath = path.join(directory, 'accepted.snapshot.json');
    this.candidatePrefix = 'accepted.snapshot.candidate-';
  }

  init() {
    fs.mkdirSync(this.directory, { recursive: true });
    for (const name of fs.readdirSync(this.directory)) {
      if (name.startsWith(this.candidatePrefix)) {
        try { fs.rmSync(path.join(this.directory, name), { force: true }); } catch {}
      }
    }
  }

  readSnapshot() {
    this.init();
    if (!fs.existsSync(this.snapshotPath)) return null;
    const snapshot = JSON.parse(fs.readFileSync(this.snapshotPath, 'utf8'));
    if (!snapshot || snapshot.format !== 'gm.semantic.accepted-snapshot.v1') {
      throw new Error('ACCEPTED_SNAPSHOT_INVALID');
    }
    verifyFrozenArtifact(snapshot.artifact);
    if (!Array.isArray(snapshot.ledger) || !snapshot.ledger.length) {
      throw new Error('ACCEPTED_LEDGER_MISSING');
    }
    const last = snapshot.ledger.at(-1);
    if (
      last.transition_id !== snapshot.artifact.transition.transition_id ||
      last.resulting !== snapshot.artifact.artifact_sha256 ||
      last.semantic_artifact_id !== snapshot.artifact.semantic_artifact_id
    ) {
      throw new Error('ACCEPTED_LEDGER_MISMATCH');
    }
    if (sha256(snapshot.artifact) !== last.artifact_sha256) {
      throw new Error('ACCEPTED_ARTIFACT_DIGEST_MISMATCH');
    }
    return snapshot;
  }

  readAccepted() {
    return this.readSnapshot()?.artifact || null;
  }

  readLedger() {
    return this.readSnapshot()?.ledger || [];
  }

  commit(artifact, { crashBeforeRename = false, crashAfterRename = false } = {}) {
    verifyFrozenArtifact(artifact);
    this.init();
    const prior = this.readSnapshot();
    const parent = prior?.artifact || null;
    const expectedParent = artifact.transition.parent_accepted_artifact || null;
    const physicalParent = parent?.artifact_sha256 || null;
    if (expectedParent !== physicalParent) {
      throw new Error('TRANSITION_PARENT_MISMATCH');
    }

    const entry = {
      transition_id: artifact.transition.transition_id,
      parent: physicalParent,
      resulting: artifact.artifact_sha256,
      semantic_artifact_id: artifact.semantic_artifact_id,
      artifact_sha256: sha256(artifact),
      acceptance_policy: artifact.transition.acceptance_policy
    };

    const ledger = [...(prior?.ledger || []), entry];
    const snapshot = {
      format: 'gm.semantic.accepted-snapshot.v1',
      artifact,
      ledger
    };

    const tmp = path.join(
      this.directory,
      this.candidatePrefix + process.pid + '-' + Date.now()
    );
    fs.writeFileSync(tmp, JSON.stringify(snapshot) + '\n', { flag: 'wx' });
    const fd = fs.openSync(tmp, 'r');
    fs.fsyncSync(fd);
    fs.closeSync(fd);

    if (crashBeforeRename) {
      throw new Error('SIMULATED_CRASH_BEFORE_COMMIT');
    }

    fs.renameSync(tmp, this.snapshotPath);

    const dirFd = fs.openSync(this.directory, 'r');
    fs.fsyncSync(dirFd);
    fs.closeSync(dirFd);

    if (crashAfterRename) {
      throw new Error('SIMULATED_CRASH_AFTER_ATOMIC_COMMIT');
    }
    return entry;
  }

  verifyConsistency() {
    const snapshot = this.readSnapshot();
    if (!snapshot) return { ok: true, state: 'EMPTY' };
    let parent = null;
    for (const entry of snapshot.ledger) {
      if (entry.parent !== parent) throw new Error('LEDGER_PARENT_CHAIN_MISMATCH');
      parent = entry.resulting;
    }
    const last = snapshot.ledger.at(-1);
    if (
      last.resulting !== snapshot.artifact.artifact_sha256 ||
      last.transition_id !== snapshot.artifact.transition.transition_id
    ) {
      throw new Error('ACCEPTED_LEDGER_MISMATCH');
    }
    return {
      ok: true,
      state: 'CONSISTENT',
      transition_id: last.transition_id,
      semantic_artifact_id: last.semantic_artifact_id
    };
  }
}

module.exports = { AtomicSemanticStore };
