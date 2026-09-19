'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildFrozenNatalArtifact,
  verifyFrozenArtifact,
  backwardSlice,
  forwardSlice,
  blameSlice,
  counterfactualSlice,
  planRebuild,
  sameSemanticSnapshot,
  independentSupportCount,
  SemanticKernelError
} = require('../kernel');
const { validateNarrative, NarrativeBoundaryError } = require('../narrative-boundary');
const { AtomicSemanticStore } = require('../transaction-store');
const { partitionWorlds, robustnessVector } = require('../uncertainty');
const { migrateArtifact } = require('../migration');
const { assertCapability } = require('../pass-contracts');
const doctrinePack = require('../doctrine/natal-core.v1.json');

const ROOT = String.fromCharCode(36);
const subjects = ['sun','moon','ascendant','mercury','venus','mars','jupiter','saturn','uranus','neptune','pluto','north_node','mc'];

function binding() {
  return {
    request_id:'sk-test',
    semantic_input:'x',
    availability:{
      ayin_gokyuzu_haritasi:false,element_dengen:false,sinerji:false,senin_yolun:false,
      hellenistic:false,jyotish:false,esoteric:false,sade_sati:false,rahu_ketu:false,
      retrogrades:false,lilith:false,chiron:false,vertex:false,part_of_fortune:false,fixed_stars:false
    },
    verified_evidence:subjects.map((subject_id,i)=>({
      evidence_id:'ev_'+subject_id,
      source_ref:'astro://engine/'+subject_id,
      kind:'placement',
      subject_id,
      semantic_value:subject_id+': Koç '+i+'°00′',
      sign:'Koç',
      degree:i+'°00′',
      house:'1. ev',
      retrograde:false,
      verification_state:'verified'
    }))
  };
}

const deps = {
  ephemeris_engine:{version:'swisseph-test',sha256:'1'.repeat(64)},
  ephemeris_data:{version:'seas_18',sha256:'2'.repeat(64)},
  timezone_data:{version:'tz-test',sha256:'3'.repeat(64)},
  calculation_implementation:{version:'calc-test',sha256:'4'.repeat(64)},
  coordinate_canonicalization:{version:'coord-test',sha256:'5'.repeat(64)},
  house_calculation:{version:'house-test',sha256:'6'.repeat(64)}
};

function artifact(input=binding(), extra={}) {
  return buildFrozenNatalArtifact({
    bindingInput:input,
    semanticDependencies:deps,
    localDependencies:{kernel_source:'k',astroir_schema:'s'},
    ...extra
  });
}

function narrative(a) {
  const bySection = new Map();
  for (const claim of a.defeasible_interpretation_state.claims) {
    if (!bySection.has(claim.section_id)) bySection.set(claim.section_id,[]);
    bySection.get(claim.section_id).push(claim);
  }
  const order=['profilin','haritanin_ozu','para_kariyer','iliskiler','aile','karmalar'];
  return {
    sections:order.map((section_id)=>{
      const claim=bySection.get(section_id)[0];
      return {
        section_id,
        paragraphs:[{
          text:claim.proposition+' Bu doğrulanmış göstergeler birlikte okunur.',
          claim_refs:[claim.claim_state_id]
        }]
      };
    }),
    personal_seal:{
      motto:bySection.get('profilin')[0].proposition,
      claim_refs:[bySection.get('profilin')[0].claim_state_id]
    }
  };
}

test('semantic determinism',()=>{
  const a=artifact(), b=artifact();
  assert.equal(a.semantic_artifact_id,b.semantic_artifact_id);
  assert.equal(a.artifact_sha256,b.artifact_sha256);
  assert.ok(sameSemanticSnapshot(a,b));
});

test('same version but changed dependency bytes changes Build ID',()=>{
  const changed={...deps,ephemeris_data:{version:'seas_18',sha256:'9'.repeat(64)}};
  const a=artifact();
  const b=buildFrozenNatalArtifact({
    bindingInput:binding(),
    semanticDependencies:changed,
    localDependencies:{kernel_source:'k',astroir_schema:'s'}
  });
  assert.notEqual(a.build_id,b.build_id);
  assert.notEqual(a.semantic_artifact_id,b.semantic_artifact_id);
});

test('provenance completeness and typed freeze validate',()=>{
  assert.equal(verifyFrozenArtifact(artifact()),true);
});

test('backward and forward slices expose lineage',()=>{
  const a=artifact();
  const claim=a.defeasible_interpretation_state.claims[0];
  assert.ok(backwardSlice(a,claim.claim_state_id).some((x)=>x.startsWith('evidence:')));
  assert.ok(forwardSlice(a,claim.provenance.root_evidence_ids[0]).includes('claim:'+claim.claim_state_id));
});

test('counterfactual slice returns root changes',()=>{
  const a=artifact();
  const claim=a.defeasible_interpretation_state.claims[0];
  assert.ok(counterfactualSlice(a,claim.claim_state_id).minimum_root_changes.length>0);
});

test('narrow authority cannot authorize wider semantic delta',()=>{
  const parent=artifact();
  const input=binding();
  input.verified_evidence[0]={...input.verified_evidence[0],sign:'Boğa'};
  assert.throws(
    ()=>artifact(input,{
      parentAcceptedArtifact:parent,
      authorityEnvelope:{
        authority_id:'gm.semantic.context-revision.v1',
        write_scopes:[ROOT+'.defeasible_interpretation_state']
      }
    }),
    (e)=>e instanceof SemanticKernelError && e.code==='UNAUTHORIZED_SEMANTIC_DELTA'
  );
});

test('untrusted authority cannot self-authorize',()=>{
  assert.throws(
    ()=>artifact(binding(),{
      authorityEnvelope:{authority_id:'attacker-self-asserted',write_scopes:[ROOT]}
    }),
    (e)=>e instanceof SemanticKernelError && e.code==='AUTHORITY_NOT_TRUSTED'
  );
});

test('narrative cannot reference unknown claim',()=>{
  const a=artifact(), n=narrative(a);
  n.sections[0].paragraphs[0].claim_refs=['claim_'+'0'.repeat(64)];
  assert.throws(()=>validateNarrative(a,n),NarrativeBoundaryError);
});

test('unsupported causal invention fails closed',()=>{
  const a=artifact(), n=narrative(a);
  n.sections[0].paragraphs[0].text='Çocukluk travman yüzünden böyle davranırsın ve profil göstergelerin bunu kanıtlar.';
  assert.throws(()=>validateNarrative(a,n),(e)=>e.code==='UNSUPPORTED_CAUSAL_CLAIM');
});

test('claim anchored narrative cannot mutate frozen artifact',()=>{
  const a=artifact();
  const before=a.artifact_sha256;
  const ledger=validateNarrative(a,narrative(a));
  assert.match(ledger.narrative_anchor_id,/^nar_/);
  assert.equal(a.artifact_sha256,before);
});

test('crash before rename preserves old accepted snapshot',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gm-sk-'));
  const store=new AtomicSemanticStore(dir);
  const a=artifact();
  store.commit(a);
  const input=binding();
  input.verified_evidence[0]={...input.verified_evidence[0],degree:'1°01′'};
  const b=artifact(input,{
    parentAcceptedArtifact:a,
    authorityEnvelope:{authority_id:'gm.semantic.owner-revision.v1',write_scopes:[ROOT]}
  });
  assert.throws(()=>store.commit(b,{crashBeforeRename:true}),/SIMULATED_CRASH_BEFORE_COMMIT/);
  const restarted=new AtomicSemanticStore(dir);
  assert.equal(restarted.readAccepted().artifact_sha256,a.artifact_sha256);
  assert.equal(restarted.verifyConsistency().state,'CONSISTENT');
  assert.equal(fs.readdirSync(dir).some((x)=>x.startsWith('accepted.snapshot.candidate-')),false);
});

test('crash after atomic rename exposes complete new snapshot',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gm-sk-'));
  const store=new AtomicSemanticStore(dir);
  const a=artifact();
  store.commit(a);
  const input=binding();
  input.verified_evidence[0]={...input.verified_evidence[0],degree:'1°01′'};
  const b=artifact(input,{
    parentAcceptedArtifact:a,
    authorityEnvelope:{authority_id:'gm.semantic.owner-revision.v1',write_scopes:[ROOT]}
  });
  assert.throws(()=>store.commit(b,{crashAfterRename:true}),/SIMULATED_CRASH_AFTER_ATOMIC_COMMIT/);
  const restarted=new AtomicSemanticStore(dir);
  assert.equal(restarted.readAccepted().artifact_sha256,b.artifact_sha256);
  assert.equal(restarted.readLedger().at(-1).transition_id,b.transition.transition_id);
  assert.equal(restarted.verifyConsistency().state,'CONSISTENT');
});

test('transition parent mismatch cannot commit',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gm-sk-'));
  const store=new AtomicSemanticStore(dir);
  store.commit(artifact());
  const unrelated=artifact(binding(),{
    authorityEnvelope:{authority_id:'gm.semantic.replay.v1',write_scopes:[ROOT]}
  });
  assert.throws(()=>store.commit(unrelated),/TRANSITION_PARENT_MISMATCH/);
});

test('possible worlds distinguish robust and unstable',()=>{
  const p=partitionWorlds([
    {world_id:'a',start:'15:20',end:'15:30',claim_states:{x:'SUPPORTED',y:'SUPPORTED'}},
    {world_id:'b',start:'15:30',end:'15:40',claim_states:{x:'SUPPORTED',y:'REFUTED'}}
  ]);
  assert.equal(p.robustness.x,'ROBUST');
  assert.equal(p.robustness.y,'UNSTABLE');
});

test('robustness vector keeps perturbation axes independent',()=>{
  const v=robustnessVector('SUPPORTED',{
    birth_time:[{delta:'2m',claim_state:'SUPPORTED'},{delta:'4m',claim_state:'REFUTED'}],
    house_system:[{delta:'whole-sign',claim_state:'SUPPORTED'}]
  });
  assert.equal(v.birth_time,'4m');
  assert.equal(v.house_system,null);
});

test('snapshot confluence ignores verified evidence ordering',()=>{
  const a=binding(), b=binding();
  b.verified_evidence.reverse();
  assert.equal(artifact(a).semantic_artifact_id,artifact(b).semantic_artifact_id);
});

test('transport request identity and source wording do not alter semantic snapshot',()=>{
  const a=binding(), b=binding();
  b.request_id='another-request';
  b.verified_evidence=b.verified_evidence.map((x)=>({
    ...x,
    source_ref:'astro://different/'+x.subject_id,
    semantic_value:'different transport wording '+x.subject_id
  }));
  assert.equal(artifact(a).semantic_artifact_id,artifact(b).semantic_artifact_id);
});

test('semantic identity is independent from transition identity',()=>{
  const a=artifact(binding(),{
    authorityEnvelope:{authority_id:'gm.semantic.genesis.v1',write_scopes:[ROOT]}
  });
  const b=artifact(binding(),{
    authorityEnvelope:{authority_id:'gm.semantic.replay.v1',write_scopes:[ROOT]}
  });
  assert.equal(a.semantic_artifact_id,b.semantic_artifact_id);
  assert.equal(a.build_id,b.build_id);
  assert.notEqual(a.transition.transition_id,b.transition.transition_id);
  assert.notEqual(a.artifact_sha256,b.artifact_sha256);
  assert.ok(sameSemanticSnapshot(a,b));
});

test('idempotent rebuild over accepted state creates no transition',()=>{
  const a=artifact();
  const b=artifact(binding(),{
    parentAcceptedArtifact:a,
    authorityEnvelope:{authority_id:'gm.semantic.owner-revision.v1',write_scopes:[ROOT]}
  });
  assert.equal(b.artifact_sha256,a.artifact_sha256);
  assert.equal(b.transition.transition_id,a.transition.transition_id);
});

test('same-root lineages do not count as independent confirmation',()=>{
  const a=artifact();
  const profile=a.defeasible_interpretation_state.claims.filter((x)=>
    x.provenance.rule_id==='profile.triad.primary.v1' ||
    x.provenance.rule_id==='profile.triad.tension.v1'
  );
  assert.equal(profile.length,2);
  assert.equal(independentSupportCount(a,profile.map((x)=>x.claim_state_id)),1);
});

test('same proposition retains multiple derivations under one claim identity',()=>{
  const base=doctrinePack.rules[0];
  doctrinePack.rules.push({...base,rule_id:'test.duplicate.derivation.v1'});
  try {
    const a=artifact();
    const claim=a.defeasible_interpretation_state.claims.find((x)=>
      x.provenance.rule_ids?.includes(base.rule_id) &&
      x.provenance.rule_ids?.includes('test.duplicate.derivation.v1')
    );
    assert.ok(claim);
    assert.equal(claim.derivation_ids.length,2);
    assert.equal(independentSupportCount(a,[claim.claim_state_id]),1);
  } finally {
    doctrinePack.rules.pop();
  }
});

test('unregistered migration fails closed',()=>{
  const a=artifact();
  assert.throws(()=>migrateArtifact(a,'gm.astroir.v2',{authority_id:'owner'}),/MIGRATION_NOT_REGISTERED/);
});

test('identity migration carries derivation build and transition ids',()=>{
  const a=artifact();
  const m=migrateArtifact(a,'gm.astroir.v1',{authority_id:'owner'});
  assert.equal(m.artifact.artifact_sha256,a.artifact_sha256);
  assert.match(m.evidence.migration_id,/^mig_[a-f0-9]{64}$/);
  assert.match(m.evidence.derivation_id,/^drv_[a-f0-9]{64}$/);
  assert.match(m.evidence.build_id,/^build_[a-f0-9]{64}$/);
  assert.match(m.evidence.transition_id,/^tx_[a-f0-9]{64}$/);
});

test('narrative boundary permits anchored human synthesis and metaphor',()=>{
  const a=artifact(), n=narrative(a);
  const claim=a.defeasible_interpretation_state.claims.find((x)=>x.section_id==='profilin');
  n.sections[0].paragraphs[0]={
    text:'Güneş, Ay ve Yükselen aynı masada oturuyor gibi; kimlik, duygu ve dış tavır birbirini ezmeden birlikte okunuyor.',
    claim_refs:[claim.claim_state_id]
  };
  assert.match(validateNarrative(a,n).narrative_anchor_id,/^nar_/);
});

test('doctrine sign and house semantics are frozen before narrative',()=>{
  const a=artifact();
  const profile=a.defeasible_interpretation_state.claims.filter((x)=>x.section_id==='profilin');
  assert.ok(profile.some((x)=>/inisiyatif|doğrudanlık|özerklik/u.test(x.proposition)));
  assert.ok(profile.some((x)=>/benlik, görünüş, başlangıçlar/u.test(x.proposition)));
});

test('positive capability boundary rejects ungranted namespace',()=>{
  assert.throws(()=>assertCapability('observed_state','narrative'),/CAPABILITY_DENIED/);
  assert.throws(()=>assertCapability('observed_state','defeasible_interpretation_state'),/CAPABILITY_NOT_GRANTED/);
});

test('incremental rebuild planner distinguishes change classes',()=>{
  assert.equal(planRebuild(['renderer']).mode,'PATCH');
  assert.equal(planRebuild(['doctrine_pack']).mode,'PARTIAL_REBUILD');
  assert.equal(planRebuild(['verified_evidence.sun']).from,'observed_calculated_state');
  assert.equal(planRebuild(['astroir_schema']).mode,'FULL_SEMANTIC_REBUILD');
});

test('blame slice identifies changed proposition set',()=>{
  const a=artifact();
  const input=binding();
  input.verified_evidence[0]={...input.verified_evidence[0],sign:'Boğa'};
  const b=artifact(input);
  assert.ok(blameSlice(a,b).length>0);
});
