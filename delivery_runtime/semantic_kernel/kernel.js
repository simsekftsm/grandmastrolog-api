'use strict';

const doctrinePack = require('./doctrine/natal-core.v1.json');
const { stableSerialize, sha256, freezeDeep } = require('./stable');
const { PASS_CONTRACTS, assertCapability } = require('./pass-contracts');

const ASTROIR_VERSION = 'gm.astroir.v1';
const SCHEMA_ID = 'gm_astroir_v1';
const KERNEL_ID = 'gm_semantic_kernel_v1';
const REQUIRED_SECTIONS = Object.freeze(['profilin','haritanin_ozu','para_kariyer','iliskiler','aile','karmalar']);
const CLAIM_STATUSES = new Set(['SUPPORTED','REFUTED','UNKNOWN-UNRESOLVED','CONFLICTED','WEAKENED']);
const ROBUSTNESS = new Set(['ROBUST','CONDITIONAL','BOUNDARY-SENSITIVE','UNSTABLE']);
const SALIENCE = new Set(['PRIMARY','SUPPORTING','MINOR']);

class SemanticKernelError extends Error {
  constructor(code, message, path = '$') { super(message || code); this.name = 'SemanticKernelError'; this.code = code; this.path = path; }
}
function fail(code, message, path) { throw new SemanticKernelError(code, message, path); }

function canonicalDependencyLock(semanticDependencies, localDependencies = {}) {
  if (!semanticDependencies || typeof semanticDependencies !== 'object' || Array.isArray(semanticDependencies)) fail('SEMANTIC_DEPENDENCY_LOCK_REQUIRED');
  for (const key of ['ephemeris_engine','ephemeris_data','timezone_data','calculation_implementation','coordinate_canonicalization','house_calculation']) {
    const d = semanticDependencies[key];
    if (!d || typeof d.version !== 'string' || !d.version || !/^[a-f0-9]{64}$/.test(String(d.sha256 || ''))) {
      fail('SEMANTIC_DEPENDENCY_INVALID', `Dependency ${key} must carry version and immutable sha256.`, `$.semantic_dependencies.${key}`);
    }
  }
  const local = {
    kernel: { version: KERNEL_ID, sha256: sha256(String(localDependencies.kernel_source || 'kernel-runtime')) },
    astroir_schema: { version: ASTROIR_VERSION, sha256: sha256(String(localDependencies.astroir_schema || SCHEMA_ID)) },
    doctrine_pack: { version: doctrinePack.version, sha256: sha256(doctrinePack) },
    ...(localDependencies.extra || {})
  };
  const lock = { upstream: semanticDependencies, local };
  return freezeDeep({ lock, dependency_lock_id: `dep_${sha256(lock)}` });
}

function canonicalizeBindingInput(bindingInput) {
  const evidence = (Array.isArray(bindingInput?.verified_evidence) ? bindingInput.verified_evidence : []).map((x)=>({
    evidence_id:x.evidence_id,kind:x.kind,subject_id:x.subject_id,sign:x.sign,degree:x.degree,house:x.house,
    retrograde:Boolean(x.retrograde),verification_state:x.verification_state
  })).sort((a,b)=>String(a.evidence_id).localeCompare(String(b.evidence_id)));
  return freezeDeep({
    semantic_input:String(bindingInput?.semantic_input || ''),
    availability:{...(bindingInput?.availability || {})},
    verified_evidence:evidence
  });
}

function evidenceIndex(bindingInput) {
  const evidence = Array.isArray(bindingInput?.verified_evidence) ? bindingInput.verified_evidence : [];
  const map = new Map();
  for (const item of evidence) {
    if (!item || item.verification_state !== 'verified' || typeof item.evidence_id !== 'string') fail('UNVERIFIED_EVIDENCE');
    if (map.has(item.evidence_id)) fail('DUPLICATE_EVIDENCE_ID', item.evidence_id);
    map.set(item.evidence_id, item);
  }
  return map;
}
function placementBySubject(evidenceMap, subject) {
  const found = [...evidenceMap.values()].filter((x) => x.kind === 'placement' && x.subject_id === subject);
  if (found.length !== 1) fail('PLACEMENT_CARDINALITY', `Expected one placement for ${subject}.`);
  return found[0];
}
function formatPlacement(item) { return `${item.subject_id}:${item.sign} ${item.degree}${item.house ? ` ${item.house}` : ''}${item.retrograde ? ' R' : ''}`; }
function interpolate(template, subjects, evidenceMap) {
  let out = template;
  for (const subject of subjects) out = out.replaceAll(`{${subject}}`, formatPlacement(placementBySubject(evidenceMap, subject)));
  return out;
}
function propositionId(sectionId, text) { return `prop_${sha256({ section_id: sectionId, proposition: text })}`; }
function derivationId(rule, roots, proposition) { return `drv_${sha256({ rule_id: rule.rule_id, doctrine_pack: doctrinePack.pack_id, roots: [...roots].sort(), proposition_id: proposition })}`; }
function claimStateId(propId, context, status, robustness, salience) { return `claim_${sha256({ proposition_id: propId, context, status, robustness, salience })}`; }
function lineageId(roots) { return `lin_${sha256([...roots].sort())}`; }

function makeObservedState(bindingInput) {
  assertCapability('observed_state','observed_calculated_state');
  const map = evidenceIndex(bindingInput);
  const placements = [...map.values()].filter((x) => x.kind === 'placement').map((x) => ({
    evidence_id:x.evidence_id, subject_id:x.subject_id, sign:x.sign, degree:x.degree,
    house:x.house, retrograde:Boolean(x.retrograde), epistemic_status:'ASTRONOMICAL_CALCULATED_FACT'
  })).sort((a,b)=>a.subject_id.localeCompare(b.subject_id));
  return freezeDeep({
    evidence_catalog_sha256: sha256(canonicalizeBindingInput(bindingInput).verified_evidence),
    placements,
    evidence_ids:[...map.keys()].sort()
  });
}

function deriveClaims(bindingInput) {
  assertCapability('doctrine','deterministic_derivation_state');
  assertCapability('doctrine','defeasible_interpretation_state');
  const map = evidenceIndex(bindingInput);
  const derivations = [], claims = [];
  for (const rule of doctrinePack.rules) {
    if (!REQUIRED_SECTIONS.includes(rule.section_id)) fail('DOCTRINE_SCOPE_VIOLATION', rule.section_id);
    if (!CLAIM_STATUSES.has(rule.status) || !ROBUSTNESS.has(rule.robustness) || !SALIENCE.has(rule.salience)) fail('DOCTRINE_RULE_INVALID', rule.rule_id);
    const roots = rule.subjects.map((subject)=>placementBySubject(map,subject).evidence_id);
    const proposition = interpolate(rule.template,rule.subjects,map);
    const pid = propositionId(rule.section_id,proposition);
    const did = derivationId(rule,roots,pid);
    const cid = claimStateId(pid,rule.section_id,rule.status,rule.robustness,rule.salience);
    const lid = lineageId(roots);
    derivations.push({ derivation_id:did, rule_id:rule.rule_id, doctrine_pack_id:doctrinePack.pack_id, proposition_id:pid, parent_evidence_ids:[...roots].sort(), lineage_id:lid, epistemic_status:'DETERMINISTIC_DERIVATION' });
    claims.push({ proposition_id:pid, claim_state_id:cid, derivation_id:did, section_id:rule.section_id, proposition, status:rule.status, robustness:rule.robustness, salience:rule.salience, epistemic_status:'INTERPRETIVE_CLAIM', provenance:{root_evidence_ids:[...roots].sort(), lineage_id:lid, rule_id:rule.rule_id} });
  }
  return freezeDeep({ deterministic_derivation_state:{derivations}, defeasible_interpretation_state:{claims} });
}

function buildGraph(derivationState, claimState) {
  const edges = [];
  for (const d of derivationState.derivations) {
    d.parent_evidence_ids.forEach((eid)=>edges.push([`evidence:${eid}`,`derivation:${d.derivation_id}`]));
    edges.push([`derivation:${d.derivation_id}`,`proposition:${d.proposition_id}`]);
  }
  for (const c of claimState.claims) edges.push([`proposition:${c.proposition_id}`,`claim:${c.claim_state_id}`]);
  return freezeDeep({ nodes:[...new Set(edges.flat())].sort(), edges:edges.sort((a,b)=>stableSerialize(a).localeCompare(stableSerialize(b))) });
}
function neighbors(graph,node,forward=true) {
  const out=[]; for (const [a,b] of graph.edges) { if (forward && a===node) out.push(b); if (!forward && b===node) out.push(a); } return out;
}
function slice(graph,start,forward) {
  const seen=new Set([start]), queue=[start];
  while(queue.length){ const n=queue.shift(); for(const next of neighbors(graph,n,forward)) if(!seen.has(next)){seen.add(next);queue.push(next);} }
  return [...seen].sort();
}
function backwardSlice(artifact, claimId){return slice(artifact.dependency_graph,`claim:${claimId}`,false);}
function forwardSlice(artifact, evidenceId){return slice(artifact.dependency_graph,`evidence:${evidenceId}`,true);}
function counterfactualSlice(artifact, claimId){
  const claim=artifact.defeasible_interpretation_state.claims.find((x)=>x.claim_state_id===claimId);
  if(!claim) fail('CLAIM_NOT_FOUND',claimId);
  return {claim_state_id:claimId,minimum_root_changes:claim.provenance.root_evidence_ids.map((evidence_id)=>({evidence_id,operation:'VALID_CHANGE_REQUIRED'}))};
}
function blameSlice(before,after){
  const a=new Map(before.defeasible_interpretation_state.claims.map((x)=>[x.proposition_id,x]));
  const b=new Map(after.defeasible_interpretation_state.claims.map((x)=>[x.proposition_id,x]));
  const changed=[]; for(const pid of new Set([...a.keys(),...b.keys()])) if(stableSerialize(a.get(pid)||null)!==stableSerialize(b.get(pid)||null)) changed.push(pid);
  return changed.sort();
}
function semanticDiff(parent,candidate){
  if(!parent) return [{path:'$',before:null,after_sha256:sha256(candidate)}];
  const fields=['observed_calculated_state','deterministic_derivation_state','defeasible_interpretation_state','dependency_graph','build_id','dependency_lock_id'];
  return fields.filter((k)=>stableSerialize(parent[k])!==stableSerialize(candidate[k])).map((k)=>({path:`$.${k}`,before_sha256:sha256(parent[k]),after_sha256:sha256(candidate[k])}));
}
function authorizeDelta(delta,envelope){
  const scopes=Array.isArray(envelope?.write_scopes)?envelope.write_scopes:[];
  if(!scopes.length) fail('AUTHORITY_ENVELOPE_REQUIRED');
  for(const item of delta){
    if(item.path==='$' && !scopes.includes('$')) fail('UNAUTHORIZED_SEMANTIC_DELTA',item.path,item.path);
    if(item.path!=='$' && !scopes.some((scope)=>scope==='$'||item.path===scope||item.path.startsWith(`${scope}.`))) {
      fail('UNAUTHORIZED_SEMANTIC_DELTA',item.path,item.path);
    }
  }
}
function transitionId(parentIdentity,envelope,delta,candidateCore){
  return `tx_${sha256({parent:parentIdentity||'GENESIS',authority:envelope,delta,resulting_semantic_sha256:sha256(candidateCore)})}`;
}

function buildFrozenNatalArtifact({bindingInput,semanticDependencies,localDependencies={},parentAcceptedArtifact=null,authorityEnvelope=null}){
  if(!bindingInput||typeof bindingInput!=='object') fail('CANONICAL_INPUT_REQUIRED');
  const lock=canonicalDependencyLock(semanticDependencies,localDependencies);
  const canonicalInputSha=sha256({binding_input:canonicalizeBindingInput(bindingInput),dependency_lock_id:lock.dependency_lock_id});
  const observed=makeObservedState(bindingInput);
  const derived=deriveClaims(bindingInput);
  const graph=buildGraph(derived.deterministic_derivation_state,derived.defeasible_interpretation_state);
  const buildId=`build_${sha256({canonical_input_sha256:canonicalInputSha,dependency_lock_id:lock.dependency_lock_id,kernel_id:KERNEL_ID,doctrine_pack_id:doctrinePack.pack_id,schema_id:SCHEMA_ID})}`;
  const candidateCore={astroir_version:ASTROIR_VERSION,schema_id:SCHEMA_ID,kernel_id:KERNEL_ID,build_id:buildId,dependency_lock_id:lock.dependency_lock_id,canonical_input_sha256:canonicalInputSha,observed_calculated_state:observed,deterministic_derivation_state:derived.deterministic_derivation_state,defeasible_interpretation_state:derived.defeasible_interpretation_state,dependency_graph:graph};
  const envelope=authorityEnvelope||{authority_id:'gm.semantic.genesis.v1',write_scopes:['$'],reason:'GENESIS_BUILD'};
  const delta=semanticDiff(parentAcceptedArtifact,candidateCore);
  authorizeDelta(delta,envelope);
  if(parentAcceptedArtifact && delta.length===0) return parentAcceptedArtifact;
  const parentIdentity=parentAcceptedArtifact?.artifact_sha256||null;
  const tid=transitionId(parentIdentity,envelope,delta,candidateCore);
  const transition={transition_id:tid,parent_accepted_artifact:parentIdentity,authorized_change_set:envelope.write_scopes,authority:envelope.authority_id,candidate_delta:delta,accepted_semantic_delta:delta,acceptance_policy:'gm.semantic.transaction.v1',acceptance_evidence:{capability_contracts_sha256:sha256(PASS_CONTRACTS),provenance_complete:true},resulting_artifact_semantic_sha256:sha256(candidateCore)};
  const preHash={...candidateCore,transition,frozen:true};
  return freezeDeep({...preHash,artifact_sha256:sha256(preHash)});
}
function verifyFrozenArtifact(artifact){
  if(!artifact||artifact.frozen!==true||artifact.astroir_version!==ASTROIR_VERSION) fail('SEMANTIC_FREEZE_REQUIRED');
  const copy={...artifact};delete copy.artifact_sha256;
  if(sha256(copy)!==artifact.artifact_sha256) fail('FROZEN_ARTIFACT_HASH_MISMATCH');
  const claims=artifact.defeasible_interpretation_state?.claims;
  if(!Array.isArray(claims)||!claims.length) fail('PROVENANCE_REQUIRED');
  for(const c of claims) if(!c.provenance?.root_evidence_ids?.length||!c.derivation_id||!c.proposition_id||!c.claim_state_id) fail('PROVENANCE_REQUIRED');
  return true;
}
function sameSemanticSnapshot(a,b){return a.artifact_sha256===b.artifact_sha256&&a.build_id===b.build_id;}
function independentSupportCount(artifact,claimIds){
  const ids=Array.isArray(claimIds)?claimIds:[];
  const claims=artifact.defeasible_interpretation_state.claims.filter((c)=>ids.includes(c.claim_state_id));
  return new Set(claims.map((c)=>c.provenance.lineage_id)).size;
}

module.exports={ASTROIR_VERSION,SCHEMA_ID,KERNEL_ID,REQUIRED_SECTIONS,SemanticKernelError,buildFrozenNatalArtifact,verifyFrozenArtifact,backwardSlice,forwardSlice,blameSlice,counterfactualSlice,semanticDiff,sameSemanticSnapshot,canonicalDependencyLock,canonicalizeBindingInput,independentSupportCount};
