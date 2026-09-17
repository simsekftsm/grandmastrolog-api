'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { stableSerialize } = require('./trust-boundary');
const { sourceProvenance } = require('./source-provenance');
const {
  CONTRACT_VERSION,
  SCHEMA_ID,
  VALIDATOR_ID,
  validateBindingInput,
  makeValidatedEnvelope
} = require('./natal-contract');
const {
  RENDERER_ID,
  RENDERER_VERSION,
  renderCanonicalNatal,
  assertCanonicalPostconditions
} = require('./natal-renderer');

const DELIVERY_VALIDATOR_ID = 'gm_final_delivery_validator_v1';
const EXPECTED_PROJECT_ID = 'prj_XhDus3tQsyiLxrPccbQteXLwbB2a';

class DeliveryValidationError extends Error {
  constructor(statusCode, code, pathValue = '$') {
    super(code);
    this.name = 'DeliveryValidationError';
    this.statusCode = statusCode;
    this.code = code;
    this.path = pathValue;
  }
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function gitBlobSha1(buffer) {
  const prefix = Buffer.from(`blob ${buffer.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(prefix).update(buffer).digest('hex');
}

function verifyPhysicalSourceProvenance() {
  const provenance = sourceProvenance();
  if (!provenance || provenance.algorithm !== 'git-blob-sha1-manifest-v1') {
    throw new DeliveryValidationError(503, 'SOURCE_PROVENANCE_UNAVAILABLE');
  }
  if (!/^[a-f0-9]{64}$/.test(String(provenance.fingerprint || ''))) {
    throw new DeliveryValidationError(503, 'SOURCE_PROVENANCE_INVALID');
  }
  for (const [repoPath, expectedBlob] of Object.entries(provenance.files || {})) {
    if (!repoPath.startsWith('delivery_runtime/') || !/^[a-f0-9]{40}$/.test(expectedBlob)) {
      throw new DeliveryValidationError(503, 'SOURCE_PROVENANCE_INVALID');
    }
    const runtimeRelative = repoPath.slice('delivery_runtime/'.length);
    const absolute = path.resolve(__dirname, '..', runtimeRelative);
    let bytes;
    try {
      bytes = fs.readFileSync(absolute);
    } catch {
      throw new DeliveryValidationError(503, 'SOURCE_PROVENANCE_FILE_MISSING', `$.source.${repoPath}`);
    }
    if (gitBlobSha1(bytes) !== expectedBlob) {
      throw new DeliveryValidationError(503, 'SOURCE_PROVENANCE_MISMATCH', `$.source.${repoPath}`);
    }
  }
  return provenance;
}

function verifyDeploymentProvenance(runtimeEnv = process.env) {
  const deploymentId = String(runtimeEnv.VERCEL_DEPLOYMENT_ID || '');
  const projectId = String(runtimeEnv.VERCEL_PROJECT_ID || '');
  const environment = String(runtimeEnv.VERCEL_ENV || '');
  if (projectId !== EXPECTED_PROJECT_ID || environment !== 'production' || !/^dpl_[A-Za-z0-9]+$/.test(deploymentId)) {
    throw new DeliveryValidationError(503, 'DEPLOYMENT_PROVENANCE_MISMATCH');
  }
  return Object.freeze({ deployment_id: deploymentId, project_id: projectId, environment });
}

function defaultProvenanceVerifier(runtimeEnv) {
  return {
    source: verifyPhysicalSourceProvenance(),
    deployment: verifyDeploymentProvenance(runtimeEnv)
  };
}

function assertRenderIntegrity(render, envelope) {
  if (!render || render.renderer_id !== RENDERER_ID || render.renderer_version !== RENDERER_VERSION) {
    throw new DeliveryValidationError(422, 'RENDERER_IDENTITY_MISMATCH');
  }
  if (render.contract_version !== CONTRACT_VERSION || render.schema_id !== SCHEMA_ID) {
    throw new DeliveryValidationError(422, 'RENDER_CONTRACT_MISMATCH');
  }
  if (typeof render.canonical_markdown !== 'string' || !render.canonical_markdown) {
    throw new DeliveryValidationError(422, 'CANONICAL_RENDER_MISSING');
  }
  const digest = sha256Text(render.canonical_markdown);
  if (digest !== render.canonical_markdown_sha256) {
    throw new DeliveryValidationError(422, 'RENDER_HASH_MISMATCH');
  }
  assertCanonicalPostconditions(render, envelope.semantic_payload);
}

function validateFinalDelivery(bindingInput, semanticPayload, options = {}) {
  const renderer = options.renderer || renderCanonicalNatal;
  const provenanceVerifier = options.provenanceVerifier || defaultProvenanceVerifier;
  const runtimeEnv = options.runtimeEnv || process.env;

  const { evidenceMap, availability } = validateBindingInput(bindingInput);
  const envelope = makeValidatedEnvelope(semanticPayload, evidenceMap, availability);
  if (envelope.contract_version !== CONTRACT_VERSION || envelope.schema_id !== SCHEMA_ID || envelope.validator_id !== VALIDATOR_ID) {
    throw new DeliveryValidationError(422, 'VALIDATED_CONTRACT_IDENTITY_MISMATCH');
  }

  const first = renderer(bindingInput, semanticPayload);
  const second = renderer(bindingInput, semanticPayload);
  assertRenderIntegrity(first, envelope);
  assertRenderIntegrity(second, envelope);
  if (stableSerialize(first) !== stableSerialize(second)) {
    throw new DeliveryValidationError(422, 'NON_DETERMINISTIC_CANONICAL_RENDER');
  }

  const provenance = provenanceVerifier(runtimeEnv);
  if (!provenance || !provenance.source || !provenance.deployment) {
    throw new DeliveryValidationError(503, 'PROVENANCE_REQUIRED');
  }
  const sourceFingerprint = String(provenance.source.fingerprint || '');
  const deploymentId = String(provenance.deployment.deployment_id || '');
  if (!/^[a-f0-9]{64}$/.test(sourceFingerprint) || !/^dpl_[A-Za-z0-9]+$/.test(deploymentId)) {
    throw new DeliveryValidationError(503, 'PROVENANCE_INVALID');
  }

  const contractSha256 = sha256Text(stableSerialize(envelope));
  const bindingSha256 = sha256Text([
    DELIVERY_VALIDATOR_ID,
    contractSha256,
    first.canonical_markdown_sha256,
    sourceFingerprint,
    deploymentId
  ].join('\n'));

  return Object.freeze({
    delivery_validator_id: DELIVERY_VALIDATOR_ID,
    delivery_state: 'final_delivery_validated',
    contract_version: CONTRACT_VERSION,
    schema_id: SCHEMA_ID,
    validator_id: VALIDATOR_ID,
    renderer_id: first.renderer_id,
    renderer_version: first.renderer_version,
    contract_sha256: contractSha256,
    canonical_markdown_sha256: first.canonical_markdown_sha256,
    delivery_binding_sha256: bindingSha256,
    canonical_markdown: first.canonical_markdown,
    visual_attachments: first.visual_attachments,
    provenance: Object.freeze({
      source_fingerprint: sourceFingerprint,
      deployment_id: deploymentId,
      project_id: provenance.deployment.project_id,
      environment: provenance.deployment.environment
    })
  });
}

module.exports = {
  DELIVERY_VALIDATOR_ID,
  EXPECTED_PROJECT_ID,
  DeliveryValidationError,
  gitBlobSha1,
  verifyPhysicalSourceProvenance,
  verifyDeploymentProvenance,
  validateFinalDelivery
};
