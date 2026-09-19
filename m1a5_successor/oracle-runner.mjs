import fs from 'node:fs';
import crypto from 'node:crypto';
import {buildNatalBindingInput} from '../gm_integration/natal-evidence.js';
import {evaluate,anchorScore,producer,aggregate} from '../m1a5_acceptance/oracle-core.mjs';

const U=p=>new URL(p,import.meta.url);
const corpusU=U('../m1a5_acceptance/corpus.normal-natal.v1.json');
const rubricU=U('../m1a5_acceptance/rubric.semantic-quality.v1.json');
const manifestU=U('../m1a5_acceptance/frozen-manifest.json');
const deltaU=U('./calibration-delta.v1.json');
const lockU=U('../.github/real-e2e-production-lock.json');
const dirU=U('./run-artifacts/');
const resultU=U('./run-artifacts/m1a5-successor-results.json');

const BASE=process.env.M1A5_PRODUCTION_URL||'https://grandmastrolog-api-production.up.railway.app';
const SECRET=String(process.env.GM_API_SECRET||'');
const GAP_MS=70000;
let lastCallStart=0;

const txt=u=>fs.readFileSync(u,'utf8');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));

function applyCalibrationDelta(frozenRubric,delta){
  if(delta.base_rubric_id!==frozenRubric.rubric_id) throw new Error('SUCCESSOR_DELTA_RUBRIC_ID_MISMATCH');
  if(delta.mutation_scope!=='canonical_language.required_markers_exact_once_in_order') throw new Error('SUCCESSOR_DELTA_SCOPE_INVALID');
  if(delta.semantic_thresholds_unchanged!==true) throw new Error('SUCCESSOR_DELTA_THRESHOLDS_NOT_LOCKED');
  const expectedOld=[
    'Buraya kadarki ana yaşam alanları sende karşılık buluyor mu? **Evet / Hayır / Kısmen**',
    'Bu anlattıklarım sende karşılık buluyor mu? **Evet / Hayır / Kısmen**'
  ];
  if(JSON.stringify(delta.superseded_markers)!==JSON.stringify(expectedOld)) throw new Error('SUCCESSOR_DELTA_SUPERSEDED_MARKERS_INVALID');
  if(delta.authorized_marker!=='Bu anlattıklarım sende karşılık buldu mu: *Evet / Hayır / Kısmen*') throw new Error('SUCCESSOR_DELTA_AUTHORIZED_MARKER_INVALID');

  const before=clone(frozenRubric);
  const markers=before.canonical_language.required_markers_exact_once_in_order;
  for(const marker of expectedOld){
    if(markers.filter(x=>x===marker).length!==1) throw new Error('FROZEN_CALIBRATION_MARKER_IDENTITY_MISMATCH');
  }
  const firstIndex=Math.min(...expectedOld.map(x=>markers.indexOf(x)));
  const successor=markers.filter(x=>!expectedOld.includes(x));
  successor.splice(firstIndex,0,delta.authorized_marker);

  const out=clone(before);
  out.canonical_language.required_markers_exact_once_in_order=successor;

  const normalized=clone(out);
  normalized.canonical_language.required_markers_exact_once_in_order=clone(before.canonical_language.required_markers_exact_once_in_order);
  if(JSON.stringify(normalized)!==JSON.stringify(before)) throw new Error('SUCCESSOR_DELTA_ESCAPED_CALIBRATION_SCOPE');
  return out;
}

async function waitGap(){
  const wait=Math.max(0,GAP_MS-(Date.now()-lastCallStart));
  if(wait>0){
    console.log('M1A5_SUCCESSOR_WAIT_MS='+wait);
    await new Promise(r=>setTimeout(r,wait));
  }
  lastCallStart=Date.now();
  console.log('M1A5_SUCCESSOR_CALL_START='+new Date(lastCallStart).toISOString());
}

async function call(t){
  if(!SECRET)return {v:'BLOCKED',reason:'GM_API_SECRET_MISSING'};
  await waitGap();
  let r;
  try{
    r=await fetch(`${BASE}/natal/deliver`,{
      method:'POST',
      headers:{'content-type':'application/json','x-gm-secret':SECRET},
      body:JSON.stringify({request_id:t.request_id,birth:t.birth}),
      signal:AbortSignal.timeout(90000)
    });
  }catch(e){
    return {v:'BLOCKED',reason:`PRODUCTION_NETWORK:${e?.name||'Error'}`};
  }
  let p;
  try{p=await r.json()}catch{return {v:'BLOCKED',reason:`PRODUCTION_NON_JSON:${r.status}`}}
  if(!r.ok||p?.ok!==true)return {v:r.status>=500||[401,403].includes(r.status)?'BLOCKED':'FAIL',reason:`PRODUCTION_RESPONSE:${r.status}:${String(p?.code||'UNKNOWN')}`,status:r.status};
  if(typeof p.output!=='string'||!p.output)return {v:'UNKNOWN',reason:'FINAL_OUTPUT_MISSING',status:r.status};
  return {v:'PASS',p,status:r.status};
}

async function main(){
  fs.mkdirSync(dirU,{recursive:true});
  const m=JSON.parse(txt(manifestU));
  const ct=txt(corpusU), rt=txt(rubricU);
  const c=JSON.parse(ct), frozenRubric=JSON.parse(rt), delta=JSON.parse(txt(deltaU));
  const r=applyCalibrationDelta(frozenRubric,delta);
  const lock=JSON.parse(txt(lockU));
  const frozen={
    baseline_head:m.baseline_head,
    corpus_sha256:sha(ct),
    rubric_sha256:sha(rt),
    expected_corpus_sha256:m.corpus_sha256,
    expected_rubric_sha256:m.rubric_sha256
  };
  if(frozen.corpus_sha256!==m.corpus_sha256||frozen.rubric_sha256!==m.rubric_sha256){
    fs.writeFileSync(resultU,JSON.stringify({overall:'BLOCKED',reason:'FROZEN_INPUT_HASH_MISMATCH',frozen},null,2)+'\n');
    return;
  }

  const cases=[];
  for(const t of c.cases){
    let src;
    try{src=buildNatalBindingInput({request_id:t.request_id,birth:t.birth})}
    catch(e){cases.push({case_id:t.case_id,verdict:'BLOCKED',reason:`LOCAL_VERIFIED_EVIDENCE_BUILD_FAILED:${String(e?.message||e)}`});continue}

    const live=await call(t);
    if(live.v!=='PASS'){cases.push({case_id:t.case_id,verdict:live.v,reason:live.reason,status:live.status||null});continue}

    const pv=live.p.provenance||{}, rw=pv.railway||{}, dv=pv.delivery_runtime||{};
    const ok=rw.commit===lock.runtime_source_commit&&rw.deployment_id===lock.railway_deployment_id&&dv.deployment_id===lock.vercel_deployment_id&&dv.source_fingerprint===lock.m1a4_source_fingerprint;
    if(!ok){
      cases.push({case_id:t.case_id,verdict:'BLOCKED',reason:'PRODUCTION_PROVENANCE_DRIFT',observed:{railway_commit:rw.commit||'',railway_deployment_id:rw.deployment_id||'',vercel_deployment_id:dv.deployment_id||'',source_fingerprint:dv.source_fingerprint||''}});
      continue;
    }

    const e=evaluate(live.p.output,src.binding_input.verified_evidence,r);
    const hm=src.evidence_sha256===live.p.evidence_sha256;
    if(!hm){
      e.dimensions.contradiction={...e.dimensions.contradiction,verdict:'FAIL',evidence_hash_match:false,local_evidence_sha256:src.evidence_sha256,production_evidence_sha256:live.p.evidence_sha256};
      e.producer_failures.push({dimension:'contradiction',layer:'astro_evidence_or_integration',proven:true,basis:'The same frozen birth input produced a different evidence digest between accepted-source local evidence and production /natal/deliver.'});
    }
    const verdict=aggregate(Object.values(e.dimensions).map(x=>x.verdict));
    fs.writeFileSync(U(`./run-artifacts/${t.case_id}.json`),JSON.stringify({
      case_id:t.case_id,
      request_id:t.request_id,
      verified_evidence:src.binding_input.verified_evidence,
      evidence_sha256_local:src.evidence_sha256,
      evidence_sha256_production:live.p.evidence_sha256,
      output:live.p.output,
      provenance:live.p.provenance
    },null,2)+'\n');
    cases.push({case_id:t.case_id,verdict,evidence_hash_match:hm,output_sha256:sha(live.p.output),dimensions:e.dimensions,producer_failures:e.producer_failures,own_anchor_score:e.anchor.score,matched_anchor_subjects:e.anchor.matched,_body:e.combinedBody,_ev:src.binding_input.verified_evidence});
  }

  const complete=cases.filter(x=>x._body&&x._ev), cx=[];
  if(complete.length!==c.cases.length)cx.push({verdict:'UNKNOWN',reason:'COUNTEREXAMPLE_REQUIRES_ALL_CORPUS_OUTPUTS'});
  else for(const own of complete){
    const os=anchorScore(own._body,own._ev,r.specificity.anchor_subjects).score;
    let bo=0; const comp=[];
    for(const other of complete){
      if(other.case_id===own.case_id)continue;
      const s=anchorScore(own._body,other._ev,r.specificity.anchor_subjects).score;
      bo=Math.max(bo,s);comp.push({against_case_id:other.case_id,score:s});
    }
    const margin=os-bo;
    const pass=os>=r.counterexample_specificity.minimum_own_anchor_score&&margin>=r.counterexample_specificity.minimum_margin_over_best_other_case;
    cx.push({case_id:own.case_id,verdict:pass?'PASS':'FAIL',own_anchor_score:os,best_other_case_score:bo,margin,comparisons:comp,producer:pass?null:producer('counterexample_specificity')});
  }
  for(const x of cases){delete x._body;delete x._ev}
  const overall=aggregate([...cases.map(x=>x.verdict),...cx.map(x=>x.verdict)]);
  const res={
    overall,
    acceptance_id:'M1A-5_POSTFIX_SUCCESSOR_SEMANTIC_QUALITY',
    production_url:BASE,
    runtime_source_commit:lock.runtime_source_commit,
    successor_delta_id:delta.successor_delta_id,
    frozen,
    corpus_id:c.corpus_id,
    rubric_id:frozenRubric.rubric_id,
    cases,
    counterexample_specificity:cx
  };
  fs.writeFileSync(resultU,JSON.stringify(res,null,2)+'\n');
  console.log(JSON.stringify({overall,cases:cases.map(x=>({case_id:x.case_id,verdict:x.verdict})),counterexample:cx.map(x=>({case_id:x.case_id,verdict:x.verdict}))}));
}

main().catch(e=>{
  fs.mkdirSync(dirU,{recursive:true});
  fs.writeFileSync(resultU,JSON.stringify({overall:'UNKNOWN',reason:'SUCCESSOR_ORACLE_INTERNAL_ERROR',error_name:String(e?.name||'Error'),error_message:String(e?.message||e)},null,2)+'\n');
});
