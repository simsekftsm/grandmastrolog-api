'use strict';

const PASS_CONTRACTS = Object.freeze({
  canonical_input: Object.freeze({
    id: 'CanonicalInputPass/v1', requires: ['binding_input', 'semantic_dependencies'], consumes: ['raw_request'],
    produces: ['canonical_input'], may_invalidate: ['build'], may_not_write: ['accepted_state', 'narrative'],
    assumptions: ['binding_input_validated'], doctrine_scope: 'none', deterministic: true, idempotent: true,
    reasoning: 'MONOTONIC', provenance_required: true, failure_behavior: 'FAIL_CLOSED'
  }),
  observed_state: Object.freeze({
    id: 'ObservedCalculatedStatePass/v1', requires: ['canonical_input'], consumes: ['verified_evidence'],
    produces: ['observed_calculated_state'], may_invalidate: ['derivations', 'claims'], may_not_write: ['narrative', 'accepted_state'],
    assumptions: ['verified_evidence_only'], doctrine_scope: 'none', deterministic: true, idempotent: true,
    reasoning: 'MONOTONIC', provenance_required: true, failure_behavior: 'FAIL_CLOSED'
  }),
  doctrine: Object.freeze({
    id: 'DoctrineDerivationPass/v1', requires: ['observed_calculated_state', 'doctrine_pack'], consumes: ['facts', 'rules'],
    produces: ['deterministic_derivation_state', 'defeasible_interpretation_state'], may_invalidate: ['claims'],
    may_not_write: ['observed_calculated_state', 'accepted_state', 'narrative'], assumptions: [], doctrine_scope: 'natal.core',
    deterministic: true, idempotent: true, reasoning: 'DEFEASIBLE', provenance_required: true, failure_behavior: 'FAIL_CLOSED'
  }),
  transaction: Object.freeze({
    id: 'SemanticTransactionPass/v1', requires: ['candidate_artifact', 'authority_envelope'], consumes: ['candidate_delta'],
    produces: ['accepted_artifact', 'transition'], may_invalidate: [], may_not_write: ['narrative'], assumptions: [],
    doctrine_scope: 'none', deterministic: true, idempotent: true, reasoning: 'MONOTONIC',
    provenance_required: true, failure_behavior: 'ATOMIC_ROLLBACK'
  }),
  freeze: Object.freeze({
    id: 'SemanticFreezePass/v1', requires: ['accepted_artifact'], consumes: ['accepted_semantic_state'],
    produces: ['frozen_semantic_artifact'], may_invalidate: [], may_not_write: ['accepted_state', 'claims', 'facts'],
    assumptions: ['accepted_transition_only'], doctrine_scope: 'none', deterministic: true, idempotent: true,
    reasoning: 'MONOTONIC', provenance_required: true, failure_behavior: 'FAIL_CLOSED'
  }),
  narrative: Object.freeze({
    id: 'NarrativeBackend/v1', requires: ['frozen_semantic_artifact'], consumes: ['claims'], produces: ['narrative'],
    may_invalidate: [], may_not_write: ['observed_calculated_state', 'deterministic_derivation_state', 'defeasible_interpretation_state', 'accepted_state'],
    assumptions: ['frozen_semantic_artifact'], doctrine_scope: 'none', deterministic: false, idempotent: false,
    reasoning: 'NARRATIVE_ONLY', provenance_required: true, failure_behavior: 'FAIL_CLOSED'
  })
});

function assertCapability(passId, namespace) {
  const contract = PASS_CONTRACTS[passId];
  if (!contract) throw new Error(`UNKNOWN_PASS:${passId}`);
  if (contract.may_not_write.includes(namespace)) throw new Error(`CAPABILITY_DENIED:${passId}:${namespace}`);
  return true;
}

module.exports = { PASS_CONTRACTS, assertCapability };
