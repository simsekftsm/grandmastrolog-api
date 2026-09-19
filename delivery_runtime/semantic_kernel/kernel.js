'use strict';

const doctrinePack = require('./doctrine/natal-core.v1.json');
const astroIrSchema = require('../contracts/gm-astroir-v1.schema.json');
const { validateAgainstSchema } = require('../lib/schema-runtime');
const { stableSerialize, sha256, freezeDeep } = require('./stable');
const { PASS_CONTRACTS, assertCapability } = require('./pass-contracts');

const ASTROIR_VERSION = 'gm.astroir.v1';
const SCHEMA_ID = 'gm_astroir_v1';
const KERNEL_ID = 'gm_semantic_kernel_v1';
const ROOT = String.fromCharCode(36);

const REQUIRED_SECTIONS = Object.freeze([
  'profilin','haritanin_ozu','para_kariyer','iliskiler','aile','karmalar'
]);
const CLAIM_STATUSES = new Set([
  'SUPPORTED','REFUTED','UNKNOWN-UNRESOLVED','CONFLICTED','WEAKENED'
]);
const ROBUSTNESS = new Set([
  'ROBUST','CONDITIONAL','BOUNDARY-SENSITIVE','UNSTABLE'
]);
const SALIENCE = new Set(['PRIMARY','SUPPORTING','MINOR']);

const AUTHORITY_POLICIES = Object.freeze({
  'gm.semantic.genesis.v1': Object.freeze({ parent:'NONE', scopes:[ROOT] }),
  'gm.semantic.replay.v1': Object.freeze({ parent:'NONE', scopes:[ROOT] }),
  'gm.semantic.owner-revision.v1': Object.freeze({ parent:'REQUIRED', scopes:[ROOT] }),
  'gm.semantic.context-revision.v1': Object.freeze({
    parent:'REQUIRED',
    scopes:[ROOT + '.defeasible_interpretation_state']
  })
});

class SemanticKernelError extends Error {
  constructor(code, message, pathValue = ROOT) {
    super(message || code);
    this.name = 'SemanticKernelError';
    this.code = code;
    this.path = pathValue;
  }
}

function fail(code, message, pathValue) {
  throw new SemanticKernelError(code, message, pathValue);
}

function digestDependency(value, fallback) {
  if (Buffer.isBuffer(value)) return sha256(value);
  if (value === undefined || value === null) return sha256(String(fallback));
  return sha256(String(value));
}

function canonicalDependencyLock(semanticDependencies, localDependencies = {}) {
  if (!semanticDependencies || typeof semanticDependencies !== 'object' || Array.isArray(semanticDependencies)) {
    fail('SEMANTIC_DEPENDENCY_LOCK_REQUIRED');
  }

  const required = [
    'ephemeris_engine',
    'ephemeris_data',
    'timezone_data',
    'calculation_implementation',
    'coordinate_canonicalization',
    'house_calculation'
  ];

  for (const key of required) {
    const dep = semanticDependencies[key];
    if (
      !dep ||
      typeof dep.version !== 'string' ||
      !dep.version ||
      !/^[a-f0-9]{64}$/u.test(String(dep.sha256 || ''))
    ) {
      fail(
        'SEMANTIC_DEPENDENCY_INVALID',
        'Dependency ' + key + ' must carry version and immutable sha256.',
        ROOT + '.semantic_dependencies.' + key
      );
    }
  }

  const local = {
    kernel:{
      version:KERNEL_ID,
      sha256:digestDependency(localDependencies.kernel_source, 'kernel-runtime')
    },
    astroir_schema:{
      version:ASTROIR_VERSION,
      sha256:digestDependency(localDependencies.astroir_schema, SCHEMA_ID)
    },
    doctrine_pack:{
      version:doctrinePack.version,
      sha256:sha256(doctrinePack)
    }
  };

  const lock = {
    upstream:semanticDependencies,
    local
  };

  return freezeDeep({
    lock,
    dependency_lock_id:'dep_' + sha256(lock)
  });
}

function canonicalizeBindingInput(bindingInput) {
  const evidence = (
    Array.isArray(bindingInput && bindingInput.verified_evidence)
      ? bindingInput.verified_evidence
      : []
  ).map((item)=>({
    evidence_id:item.evidence_id,
    kind:item.kind,
    subject_id:item.subject_id,
    sign:item.sign,
    degree:item.degree,
    house:item.house,
    retrograde:Boolean(item.retrograde),
    verification_state:item.verification_state
  })).sort((a,b)=>String(a.evidence_id).localeCompare(String(b.evidence_id)));

  return freezeDeep({
    semantic_input:String(bindingInput && bindingInput.semantic_input || ''),
    availability:{...((bindingInput && bindingInput.availability) || {})},
    verified_evidence:evidence
  });
}

function evidenceIndex(bindingInput) {
  const evidence = Array.isArray(bindingInput && bindingInput.verified_evidence)
    ? bindingInput.verified_evidence
    : [];
  const map = new Map();

  for (const item of evidence) {
    if (
      !item ||
      item.verification_state !== 'verified' ||
      typeof item.evidence_id !== 'string'
    ) {
      fail('UNVERIFIED_EVIDENCE');
    }
    if (map.has(item.evidence_id)) {
      fail('DUPLICATE_EVIDENCE_ID', item.evidence_id);
    }
    map.set(item.evidence_id, item);
  }

  return map;
}

function placementBySubject(evidenceMap, subject) {
  const found = [...evidenceMap.values()].filter(
    (item)=>item.kind === 'placement' && item.subject_id === subject
  );
  if (found.length !== 1) {
    fail('PLACEMENT_CARDINALITY', 'Expected one placement for ' + subject + '.');
  }
  return found[0];
}

function formatPlacement(item) {
  return [
    item.subject_id + ':' + item.sign,
    item.degree,
    item.house || '',
    item.retrograde ? 'R' : ''
  ].filter(Boolean).join(' ');
}

function interpolate(template, subjects, evidenceMap) {
  let out = template;
  for (const subject of subjects) {
    out = out.replaceAll(
      '{' + subject + '}',
      formatPlacement(placementBySubject(evidenceMap, subject))
    );
  }
  return out;
}

function propositionId(sectionId, text) {
  return 'prop_' + sha256({section_id:sectionId, proposition:text});
}

function derivationId(rule, roots, proposition) {
  return 'drv_' + sha256({
    rule_id:rule.rule_id,
    doctrine_pack:doctrinePack.pack_id,
    roots:[...roots].sort(),
    proposition_id:proposition
  });
}

function claimStateId(propId, context, status, robustness, salience) {
  return 'claim_' + sha256({
    proposition_id:propId,
    context,
    status,
    robustness,
    salience
  });
}

function lineageId(roots) {
  return 'lin_' + sha256([...roots].sort());
}

function makeObservedState(bindingInput) {
  assertCapability('observed_state','observed_calculated_state');
  const map = evidenceIndex(bindingInput);
  const placements = [...map.values()]
    .filter((item)=>item.kind === 'placement')
    .map((item)=>({
      evidence_id:item.evidence_id,
      subject_id:item.subject_id,
      sign:item.sign,
      degree:item.degree,
      house:item.house,
      retrograde:Boolean(item.retrograde),
      epistemic_status:'ASTRONOMICAL_CALCULATED_FACT'
    }))
    .sort((a,b)=>a.subject_id.localeCompare(b.subject_id));

  return freezeDeep({
    evidence_catalog_sha256:sha256(
      canonicalizeBindingInput(bindingInput).verified_evidence
    ),
    placements,
    evidence_ids:[...map.keys()].sort()
  });
}

function houseNumber(house) {
  const text = String(house || '').trim();
  const match = /^(\d{1,2})\.\s*ev/u.exec(text);
  return match && match[0] === text ? match[1] : null;
}

function deriveClaims(bindingInput) {
  assertCapability('doctrine','deterministic_derivation_state');
  assertCapability('doctrine','defeasible_interpretation_state');

  const map = evidenceIndex(bindingInput);
  const derivations = [];
  const claims = [];
  const claimsById = new Map();

  const addClaim = ({
    rule,
    roots,
    proposition,
    sectionId,
    status,
    robustness,
    salience
  }) => {
    if (!REQUIRED_SECTIONS.includes(sectionId)) {
      fail('DOCTRINE_SCOPE_VIOLATION', sectionId);
    }
    if (
      !CLAIM_STATUSES.has(status) ||
      !ROBUSTNESS.has(robustness) ||
      !SALIENCE.has(salience)
    ) {
      fail('DOCTRINE_RULE_INVALID', rule.rule_id);
    }

    const pid = propositionId(sectionId, proposition);
    const did = derivationId(rule, roots, pid);
    const cid = claimStateId(pid, sectionId, status, robustness, salience);
    const lid = lineageId(roots);

    derivations.push({
      derivation_id:did,
      rule_id:rule.rule_id,
      doctrine_pack_id:doctrinePack.pack_id,
      proposition_id:pid,
      parent_evidence_ids:[...roots].sort(),
      lineage_id:lid,
      epistemic_status:'DETERMINISTIC_DERIVATION'
    });

    const existing = claimsById.get(cid);
    if (existing) {
      existing.derivation_ids = [...new Set(
        existing.derivation_ids.concat(did)
      )].sort();
      existing.provenance.root_evidence_ids = [...new Set(
        existing.provenance.root_evidence_ids.concat(roots)
      )].sort();
      existing.provenance.lineage_ids = [...new Set(
        existing.provenance.lineage_ids.concat(lid)
      )].sort();
      existing.provenance.rule_ids = [...new Set(
        existing.provenance.rule_ids.concat(rule.rule_id)
      )].sort();
      return;
    }

    const claim = {
      proposition_id:pid,
      claim_state_id:cid,
      derivation_id:did,
      derivation_ids:[did],
      section_id:sectionId,
      proposition,
      status,
      robustness,
      salience,
      epistemic_status:'INTERPRETIVE_CLAIM',
      provenance:{
        root_evidence_ids:[...roots].sort(),
        lineage_id:lid,
        lineage_ids:[lid],
        rule_id:rule.rule_id,
        rule_ids:[rule.rule_id]
      }
    };

    claimsById.set(cid, claim);
    claims.push(claim);
  };

  for (const rule of doctrinePack.rules) {
    const roots = rule.subjects.map(
      (subject)=>placementBySubject(map, subject).evidence_id
    );
    addClaim({
      rule,
      roots,
      proposition:interpolate(rule.template, rule.subjects, map),
      sectionId:rule.section_id,
      status:rule.status,
      robustness:rule.robustness,
      salience:rule.salience
    });
  }

  for (const [sectionId, subjects] of Object.entries(
    doctrinePack.section_subjects || {}
  )) {
    if (!REQUIRED_SECTIONS.includes(sectionId)) {
      fail('DOCTRINE_SCOPE_VIOLATION', sectionId);
    }

    for (const subject of subjects) {
      const placement = placementBySubject(map, subject);
      const subjectFunction = doctrinePack.subject_functions &&
        doctrinePack.subject_functions[subject];
      const sign = doctrinePack.sign_semantics &&
        doctrinePack.sign_semantics[placement.sign];

      if (!subjectFunction || !sign || !sign.expression || !sign.tension) {
        fail('DOCTRINE_SEMANTIC_LEXICON_MISSING', subject);
      }

      addClaim({
        rule:{rule_id:'placement.sign.' + sectionId + '.' + subject + '.v1'},
        roots:[placement.evidence_id],
        sectionId,
        status:'SUPPORTED',
        robustness:'ROBUST',
        salience:'SUPPORTING',
        proposition:
          subjectFunction + ' ekseni ' + placement.sign +
          ' yerleşiminde ' + sign.expression +
          ' üzerinden çalışır; temel denge noktası ' + sign.tension + '.'
      });

      const hn = houseNumber(placement.house);
      const houseMeaning = hn && doctrinePack.house_semantics
        ? doctrinePack.house_semantics[hn]
        : null;

      if (houseMeaning) {
        addClaim({
          rule:{rule_id:'placement.house.' + sectionId + '.' + subject + '.v1'},
          roots:[placement.evidence_id],
          sectionId,
          status:'SUPPORTED',
          robustness:'BOUNDARY-SENSITIVE',
          salience:'MINOR',
          proposition:
            subjectFunction + ' ekseninin ' + placement.house +
            ' konumu, bu temayı ' + houseMeaning +
            ' içinde görünür kılar.'
        });
      }
    }
  }

  claims.sort(
    (a,b)=>
      a.section_id.localeCompare(b.section_id) ||
      a.salience.localeCompare(b.salience) ||
      a.proposition_id.localeCompare(b.proposition_id)
  );
  derivations.sort((a,b)=>a.derivation_id.localeCompare(b.derivation_id));

  return freezeDeep({
    deterministic_derivation_state:{derivations},
    defeasible_interpretation_state:{claims}
  });
}

function buildGraph(derivationState, claimState) {
  const edges = [];

  for (const derivation of derivationState.derivations) {
    for (const evidenceId of derivation.parent_evidence_ids) {
      edges.push([
        'evidence:' + evidenceId,
        'derivation:' + derivation.derivation_id
      ]);
    }
    edges.push([
      'derivation:' + derivation.derivation_id,
      'proposition:' + derivation.proposition_id
    ]);
  }

  for (const claim of claimState.claims) {
    edges.push([
      'proposition:' + claim.proposition_id,
      'claim:' + claim.claim_state_id
    ]);
  }

  return freezeDeep({
    nodes:[...new Set(edges.flat())].sort(),
    edges:edges.sort(
      (a,b)=>stableSerialize(a).localeCompare(stableSerialize(b))
    )
  });
}

function neighbors(graph, node, forward=true) {
  const out = [];
  for (const edge of graph.edges) {
    if (forward && edge[0] === node) out.push(edge[1]);
    if (!forward && edge[1] === node) out.push(edge[0]);
  }
  return out;
}

function slice(graph, start, forward) {
  const seen = new Set([start]);
  const queue = [start];

  while (queue.length) {
    const node = queue.shift();
    for (const next of neighbors(graph, node, forward)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  return [...seen].sort();
}

function backwardSlice(artifact, claimId) {
  return slice(artifact.dependency_graph, 'claim:' + claimId, false);
}

function forwardSlice(artifact, evidenceId) {
  return slice(artifact.dependency_graph, 'evidence:' + evidenceId, true);
}

function counterfactualSlice(artifact, claimId) {
  const claim = artifact.defeasible_interpretation_state.claims.find(
    (item)=>item.claim_state_id === claimId
  );
  if (!claim) fail('CLAIM_NOT_FOUND', claimId);

  return {
    claim_state_id:claimId,
    minimum_root_changes:claim.provenance.root_evidence_ids.map(
      (evidence_id)=>({evidence_id,operation:'VALID_CHANGE_REQUIRED'})
    )
  };
}

function blameSlice(before, after) {
  const left = new Map(
    before.defeasible_interpretation_state.claims.map(
      (item)=>[item.proposition_id,item]
    )
  );
  const right = new Map(
    after.defeasible_interpretation_state.claims.map(
      (item)=>[item.proposition_id,item]
    )
  );
  const changed = [];

  for (const pid of new Set([...left.keys(),...right.keys()])) {
    if (
      stableSerialize(left.get(pid) || null) !==
      stableSerialize(right.get(pid) || null)
    ) {
      changed.push(pid);
    }
  }

  return changed.sort();
}

function planRebuild(changedPaths) {
  const paths = Array.isArray(changedPaths)
    ? changedPaths.map(String)
    : [];

  if (!paths.length) {
    return freezeDeep({mode:'PATCH',from:'none',invalidates:[]});
  }

  const matches = (prefixes)=>paths.some(
    (value)=>prefixes.some(
      (prefix)=>
        value === prefix ||
        value.startsWith(prefix + '.') ||
        value.startsWith(prefix + '/')
    )
  );

  if (matches([
    'astroir_schema','kernel','semantic_dependency_lock',
    'ephemeris_engine','ephemeris_data','timezone_data',
    'calculation_implementation','coordinate_canonicalization',
    'house_calculation'
  ])) {
    return freezeDeep({
      mode:'FULL_SEMANTIC_REBUILD',
      from:'canonical_input',
      invalidates:[
        'observed_calculated_state',
        'deterministic_derivation_state',
        'defeasible_interpretation_state',
        'frozen_artifact'
      ]
    });
  }

  if (matches(['doctrine_pack','rules'])) {
    return freezeDeep({
      mode:'PARTIAL_REBUILD',
      from:'deterministic_derivation_state',
      invalidates:[
        'deterministic_derivation_state',
        'defeasible_interpretation_state',
        'frozen_artifact'
      ]
    });
  }

  if (matches([
    'binding_input','verified_evidence','birth','location','timezone'
  ])) {
    return freezeDeep({
      mode:'PARTIAL_REBUILD',
      from:'observed_calculated_state',
      invalidates:[
        'observed_calculated_state',
        'deterministic_derivation_state',
        'defeasible_interpretation_state',
        'frozen_artifact'
      ]
    });
  }

  if (matches(['context','calibration','counterevidence','claim_state'])) {
    return freezeDeep({
      mode:'PATCH',
      from:'defeasible_interpretation_state',
      invalidates:['defeasible_interpretation_state','frozen_artifact']
    });
  }

  if (matches(['renderer','ui','pdf','translation','style'])) {
    return freezeDeep({
      mode:'PATCH',
      from:'narrative_only',
      invalidates:[]
    });
  }

  return freezeDeep({
    mode:'PARTIAL_REBUILD',
    from:'unknown_semantic_dependency',
    invalidates:['frozen_artifact']
  });
}

function semanticDiff(parent, candidate) {
  if (!parent) {
    return [{
      path:ROOT,
      before:null,
      after_sha256:sha256(candidate)
    }];
  }

  const fields = [
    'observed_calculated_state',
    'deterministic_derivation_state',
    'defeasible_interpretation_state',
    'dependency_graph',
    'build_id',
    'dependency_lock_id'
  ];

  return fields
    .filter(
      (key)=>stableSerialize(parent[key]) !== stableSerialize(candidate[key])
    )
    .map((key)=>({
      path:ROOT + '.' + key,
      before_sha256:sha256(parent[key]),
      after_sha256:sha256(candidate[key])
    }));
}

function authorizeDelta(delta, envelope) {
  const scopes = Array.isArray(envelope && envelope.write_scopes)
    ? envelope.write_scopes
    : [];

  if (!scopes.length) fail('AUTHORITY_ENVELOPE_REQUIRED');

  for (const item of delta) {
    if (item.path === ROOT && !scopes.includes(ROOT)) {
      fail('UNAUTHORIZED_SEMANTIC_DELTA', item.path, item.path);
    }

    if (
      item.path !== ROOT &&
      !scopes.some(
        (scope)=>
          scope === ROOT ||
          item.path === scope ||
          item.path.startsWith(scope + '.')
      )
    ) {
      fail('UNAUTHORIZED_SEMANTIC_DELTA', item.path, item.path);
    }
  }
}

function validateAuthorityEnvelope(envelope, parentAcceptedArtifact) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    fail('AUTHORITY_ENVELOPE_REQUIRED');
  }

  const policy = AUTHORITY_POLICIES[envelope.authority_id];
  if (!policy) {
    fail('AUTHORITY_NOT_TRUSTED', String(envelope.authority_id || ''));
  }

  const hasParent = Boolean(parentAcceptedArtifact);

  if (policy.parent === 'NONE' && hasParent) {
    fail('AUTHORITY_PARENT_POLICY_VIOLATION', envelope.authority_id);
  }
  if (policy.parent === 'REQUIRED' && !hasParent) {
    fail('AUTHORITY_PARENT_POLICY_VIOLATION', envelope.authority_id);
  }

  const scopes = Array.isArray(envelope.write_scopes)
    ? envelope.write_scopes
    : [];

  if (!scopes.length) {
    fail('AUTHORITY_SCOPE_REQUIRED', envelope.authority_id);
  }

  for (const scope of scopes) {
    if (!policy.scopes.includes(scope)) {
      fail('AUTHORITY_SCOPE_NOT_GRANTED', scope);
    }
  }

  return freezeDeep({
    authority_id:envelope.authority_id,
    write_scopes:[...scopes].sort(),
    reason:String(envelope.reason || '')
  });
}

function transitionId(parentIdentity, envelope, delta, semanticArtifactId) {
  return 'tx_' + sha256({
    parent:parentIdentity || 'GENESIS',
    authority:envelope,
    delta,
    resulting_semantic_artifact_id:semanticArtifactId
  });
}

function semanticCoreFromArtifact(artifact) {
  return {
    astroir_version:artifact.astroir_version,
    schema_id:artifact.schema_id,
    kernel_id:artifact.kernel_id,
    build_id:artifact.build_id,
    dependency_lock_id:artifact.dependency_lock_id,
    canonical_input_sha256:artifact.canonical_input_sha256,
    observed_calculated_state:artifact.observed_calculated_state,
    deterministic_derivation_state:artifact.deterministic_derivation_state,
    defeasible_interpretation_state:artifact.defeasible_interpretation_state,
    dependency_graph:artifact.dependency_graph
  };
}

function buildFrozenNatalArtifact({
  bindingInput,
  semanticDependencies,
  localDependencies={},
  parentAcceptedArtifact=null,
  authorityEnvelope=null
}) {
  if (!bindingInput || typeof bindingInput !== 'object') {
    fail('CANONICAL_INPUT_REQUIRED');
  }

  const lock = canonicalDependencyLock(
    semanticDependencies,
    localDependencies
  );

  const canonicalInputSha = sha256({
    binding_input:canonicalizeBindingInput(bindingInput),
    dependency_lock_id:lock.dependency_lock_id
  });

  const observed = makeObservedState(bindingInput);
  const derived = deriveClaims(bindingInput);
  const graph = buildGraph(
    derived.deterministic_derivation_state,
    derived.defeasible_interpretation_state
  );

  const buildId = 'build_' + sha256({
    canonical_input_sha256:canonicalInputSha,
    dependency_lock_id:lock.dependency_lock_id,
    kernel_id:KERNEL_ID,
    doctrine_pack_id:doctrinePack.pack_id,
    schema_id:SCHEMA_ID
  });

  const candidateCore = {
    astroir_version:ASTROIR_VERSION,
    schema_id:SCHEMA_ID,
    kernel_id:KERNEL_ID,
    build_id:buildId,
    dependency_lock_id:lock.dependency_lock_id,
    canonical_input_sha256:canonicalInputSha,
    observed_calculated_state:observed,
    deterministic_derivation_state:derived.deterministic_derivation_state,
    defeasible_interpretation_state:derived.defeasible_interpretation_state,
    dependency_graph:graph
  };

  const defaultEnvelope = parentAcceptedArtifact
    ? null
    : {
        authority_id:'gm.semantic.genesis.v1',
        write_scopes:[ROOT],
        reason:'GENESIS_BUILD'
      };

  const envelope = validateAuthorityEnvelope(
    authorityEnvelope || defaultEnvelope,
    parentAcceptedArtifact
  );

  const delta = semanticDiff(parentAcceptedArtifact, candidateCore);
  authorizeDelta(delta, envelope);

  if (parentAcceptedArtifact && delta.length === 0) {
    return parentAcceptedArtifact;
  }

  const semanticArtifactId = 'sem_' + sha256(candidateCore);
  const parentIdentity = parentAcceptedArtifact
    ? parentAcceptedArtifact.artifact_sha256
    : null;
  const tid = transitionId(
    parentIdentity,
    envelope,
    delta,
    semanticArtifactId
  );

  const transition = {
    transition_id:tid,
    parent_accepted_artifact:parentIdentity,
    authorized_change_set:envelope.write_scopes,
    authority:envelope.authority_id,
    candidate_delta:delta,
    accepted_semantic_delta:delta,
    acceptance_policy:'gm.semantic.transaction.v1',
    acceptance_evidence:{
      capability_contracts_sha256:sha256(PASS_CONTRACTS),
      provenance_complete:true
    },
    resulting_semantic_artifact_id:semanticArtifactId
  };

  const preHash = {
    ...candidateCore,
    semantic_artifact_id:semanticArtifactId,
    transition,
    frozen:true
  };

  return freezeDeep({
    ...preHash,
    artifact_sha256:sha256(preHash)
  });
}

function verifyFrozenArtifact(artifact) {
  if (
    !artifact ||
    artifact.frozen !== true ||
    artifact.astroir_version !== ASTROIR_VERSION
  ) {
    fail('SEMANTIC_FREEZE_REQUIRED');
  }

  const copy = {...artifact};
  delete copy.artifact_sha256;

  if (sha256(copy) !== artifact.artifact_sha256) {
    fail('FROZEN_ARTIFACT_HASH_MISMATCH');
  }

  try {
    validateAgainstSchema(artifact, astroIrSchema);
  } catch (error) {
    fail(
      'ASTROIR_SCHEMA_INVALID',
      error.message,
      error.path || ROOT
    );
  }

  const expectedSemanticArtifactId =
    'sem_' + sha256(semanticCoreFromArtifact(artifact));

  if (artifact.semantic_artifact_id !== expectedSemanticArtifactId) {
    fail('SEMANTIC_ARTIFACT_ID_MISMATCH');
  }

  if (
    !artifact.transition ||
    artifact.transition.resulting_semantic_artifact_id !==
      artifact.semantic_artifact_id
  ) {
    fail('TRANSITION_RESULT_IDENTITY_MISMATCH');
  }

  const claims = artifact.defeasible_interpretation_state &&
    artifact.defeasible_interpretation_state.claims;

  if (!Array.isArray(claims) || !claims.length) {
    fail('PROVENANCE_REQUIRED');
  }

  for (const claim of claims) {
    if (
      !claim.provenance ||
      !claim.provenance.root_evidence_ids ||
      !claim.provenance.root_evidence_ids.length ||
      !claim.derivation_id ||
      !claim.derivation_ids ||
      !claim.derivation_ids.length ||
      !claim.provenance.lineage_ids ||
      !claim.provenance.lineage_ids.length ||
      !claim.proposition_id ||
      !claim.claim_state_id
    ) {
      fail('PROVENANCE_REQUIRED');
    }
  }

  return true;
}

function sameSemanticSnapshot(left, right) {
  return (
    left.semantic_artifact_id === right.semantic_artifact_id &&
    left.build_id === right.build_id
  );
}

function independentSupportCount(artifact, claimIds) {
  const ids = new Set(Array.isArray(claimIds) ? claimIds : []);
  const claims = artifact.defeasible_interpretation_state.claims.filter(
    (claim)=>ids.has(claim.claim_state_id)
  );
  const propositionIds = new Set(
    claims.map((claim)=>claim.proposition_id)
  );
  const uniqueRootSets = new Map();

  for (const derivation of artifact.deterministic_derivation_state.derivations) {
    if (!propositionIds.has(derivation.proposition_id)) continue;
    const roots = [...new Set(
      derivation.parent_evidence_ids || []
    )].sort();
    uniqueRootSets.set(roots.join('|'), new Set(roots));
  }

  const sets = [...uniqueRootSets.values()];
  let best = 0;

  const search = (index, used, count) => {
    if (index >= sets.length) {
      best = Math.max(best, count);
      return;
    }

    search(index + 1, used, count);

    const current = sets[index];
    if ([...current].every((root)=>!used.has(root))) {
      const next = new Set(used);
      for (const root of current) next.add(root);
      search(index + 1, next, count + 1);
    }
  };

  search(0, new Set(), 0);
  return best;
}

module.exports = {
  ASTROIR_VERSION,
  SCHEMA_ID,
  KERNEL_ID,
  REQUIRED_SECTIONS,
  SemanticKernelError,
  buildFrozenNatalArtifact,
  verifyFrozenArtifact,
  backwardSlice,
  forwardSlice,
  blameSlice,
  counterfactualSlice,
  planRebuild,
  semanticDiff,
  sameSemanticSnapshot,
  canonicalDependencyLock,
  canonicalizeBindingInput,
  independentSupportCount
};
