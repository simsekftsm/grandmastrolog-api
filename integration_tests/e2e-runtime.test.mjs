import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const handler = require('../delivery_runtime/api/e2e-natal.js');
const { signTrustedRequest } = require('../delivery_runtime/lib/trust-boundary.js');
const { buildFrozenNatalArtifact } = require('../delivery_runtime/semantic_kernel/kernel.js');
const { localSemanticDependencies } = require('../delivery_runtime/semantic_kernel/dependency-runtime.js');
const { availability, bindingInput } = require('../delivery_runtime/tests/helpers.js');

function makeRes() {
  return {
    headers:{},statusCode:200,payload:null,
    setHeader(name,value){this.headers[String(name).toLowerCase()]=value;},
    status(code){this.statusCode=code;return this;},
    json(payload){this.payload=payload;return this;}
  };
}
function trustedReq(body){
  const signed=signTrustedRequest({secret:process.env.GM_API_SECRET,routeId:'e2e-natal',body});
  return {method:'POST',body,headers:{authorization:`Bearer ${process.env.GM_API_SECRET}`,'x-gm-evidence-source':signed.source,'x-gm-evidence-timestamp':signed.timestamp,'x-gm-evidence-signature':signed.signature}};
}
function primeEnv(){
  process.env.GM_API_SECRET='synthetic-test-secret';
  process.env.GROQ_API_KEY='synthetic-groq-key';
  delete process.env.GROQ_MODEL;
  process.env.GM_FINAL_DELIVERY_AUTHORIZED='true';
  process.env.VERCEL_DEPLOYMENT_ID='dpl_SyntheticE2E';
  process.env.VERCEL_PROJECT_ID='prj_XhDus3tQsyiLxrPccbQteXLwbB2a';
  process.env.VERCEL_ENV='production';
}
const semanticDependencies={
  ephemeris_engine:{version:'swisseph@test',sha256:'1'.repeat(64)},
  ephemeris_data:{version:'seas_18.se1',sha256:'2'.repeat(64)},
  timezone_data:{version:'tz@test',sha256:'3'.repeat(64)},
  calculation_implementation:{version:'calc@test',sha256:'4'.repeat(64)},
  coordinate_canonicalization:{version:'coord@test',sha256:'5'.repeat(64)},
  house_calculation:{version:'house@test',sha256:'6'.repeat(64)}
};
function narrativeFor(binding){
  const artifact=buildFrozenNatalArtifact({bindingInput:binding,semanticDependencies,localDependencies:localSemanticDependencies()});
  const bySection=new Map();
  for(const c of artifact.defeasible_interpretation_state.claims){if(!bySection.has(c.section_id))bySection.set(c.section_id,[]);bySection.get(c.section_id).push(c);}
  return {
    sections:['profilin','haritanin_ozu','para_kariyer','iliskiler','aile','karmalar'].map((id)=>({
      section_id:id,
      paragraphs:[{text:bySection.get(id)[0].proposition+' Bu doğrulanmış göstergeler birlikte okunur.',claim_refs:[bySection.get(id)[0].claim_state_id]}]
    })),
    personal_seal:{motto:'Kimlik odağında üç eksen birlikte çalışır; profil yorumu tek bir yerleşime indirgenmez.',claim_refs:[bySection.get('profilin')[0].claim_state_id]}
  };
}
async function invoke(mutator=(x)=>x){
  const av=availability();
  const binding=bindingInput(av);
  const body={binding_input:binding,semantic_dependencies:semanticDependencies};
  globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({status:'completed',output_text:JSON.stringify(mutator(narrativeFor(binding)))})});
  const res=makeRes();
  await handler(trustedReq(body),res);
  return res;
}

test('same physical request freezes semantic state before narrative backend and reaches final delivery',async()=>{
  primeEnv();
  const res=await invoke();
  assert.equal(res.statusCode,200,JSON.stringify(res.payload));
  assert.equal(res.payload.ok,true);
  assert.equal(res.payload.delivery.delivery_state,'final_delivery_validated');
  assert.equal(res.payload.semantic.astroir_version,'gm.astroir.v1');
  assert.match(res.payload.semantic.build_id,/^build_[a-f0-9]{64}$/);
  assert.match(res.payload.semantic.dependency_lock_id,/^dep_[a-f0-9]{64}$/);
  assert.match(res.payload.semantic.transition_id,/^tx_[a-f0-9]{64}$/);
  assert.match(res.payload.semantic.frozen_artifact_sha256,/^[a-f0-9]{64}$/);
  assert.match(res.payload.semantic.narrative_anchor_id,/^nar_[a-f0-9]{64}$/);
  const serialized=JSON.stringify(res.payload);
  assert.equal(serialized.includes('semantic_payload'),false);
  assert.equal(serialized.includes('raw_model_output'),false);
});

test('caller without trust provenance cannot reach narrative backend',async()=>{
  primeEnv();let called=false;globalThis.fetch=async()=>{called=true;throw new Error('must not call');};
  const res=makeRes();
  await handler({method:'POST',body:{binding_input:bindingInput()},headers:{}},res);
  assert.equal(res.statusCode,401);assert.equal(res.payload.code,'UNAUTHORIZED');assert.equal(called,false);
});

test('final delivery authorization remains fail closed',async()=>{
  primeEnv();process.env.GM_FINAL_DELIVERY_AUTHORIZED='false';let called=false;globalThis.fetch=async()=>{called=true;throw new Error('must not call');};
  const body={binding_input:bindingInput(),semantic_dependencies:semanticDependencies};const res=makeRes();
  await handler(trustedReq(body),res);
  assert.equal(res.statusCode,503);assert.equal(res.payload.code,'FINAL_DELIVERY_NOT_AUTHORIZED');assert.equal(called,false);
});

test('missing semantic dependency lock fails before provider call',async()=>{
  primeEnv();let called=false;globalThis.fetch=async()=>{called=true;throw new Error('must not call');};
  const body={binding_input:bindingInput(),semantic_dependencies:{}};const res=makeRes();
  await handler(trustedReq(body),res);
  assert.equal(res.statusCode,422);assert.equal(res.payload.code,'SEMANTIC_DEPENDENCY_INVALID');assert.equal(called,false);
});

test('model upstream failure is fail closed',async()=>{
  primeEnv();globalThis.fetch=async()=>({ok:false,status:503,json:async()=>({secret:'RAW-UPSTREAM'})});
  const body={binding_input:bindingInput(),semantic_dependencies:semanticDependencies};const res=makeRes();
  await handler(trustedReq(body),res);
  assert.equal(res.statusCode,502);assert.equal(res.payload.code,'MODEL_BINDING_UPSTREAM_FAIL');assert.equal(JSON.stringify(res.payload).includes('RAW-UPSTREAM'),false);
});

test('model timeout is fail closed',async()=>{
  primeEnv();globalThis.fetch=async()=>{const error=new Error('synthetic timeout');error.name='TimeoutError';throw error;};
  const body={binding_input:bindingInput(),semantic_dependencies:semanticDependencies};const res=makeRes();
  await handler(trustedReq(body),res);
  assert.equal(res.statusCode,504);assert.equal(res.payload.code,'MODEL_BINDING_TIMEOUT');
});

test('narrative markdown escape is rejected after freeze',async()=>{
  primeEnv();
  const res=await invoke((n)=>{n.sections[0].paragraphs[0].text='> RAW-MARKDOWN-ESCAPE';return n;});
  assert.equal(res.statusCode,422);assert.equal(res.payload.code,'NARRATIVE_MARKDOWN_FORBIDDEN');assert.equal(JSON.stringify(res.payload).includes('RAW-MARKDOWN-ESCAPE'),false);
});

test('narrative unsupported causal claim is rejected after freeze',async()=>{
  primeEnv();
  const res=await invoke((n)=>{n.sections[0].paragraphs[0].text='Çocukluk travman yüzünden böyle davranırsın ve profil göstergelerin bunu kanıtlar.';return n;});
  assert.equal(res.statusCode,422);assert.equal(res.payload.code,'UNSUPPORTED_CAUSAL_CLAIM');
});

test('unparseable raw model output never leaks',async()=>{
  primeEnv();globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({status:'completed',output_text:'RAW-SECRET-NOT-JSON'})});
  const body={binding_input:bindingInput(),semantic_dependencies:semanticDependencies};const res=makeRes();
  await handler(trustedReq(body),res);
  assert.equal(res.statusCode,502);assert.equal(res.payload.code,'MODEL_STRUCTURED_PARSE_FAIL');assert.equal(JSON.stringify(res.payload).includes('RAW-SECRET-NOT-JSON'),false);
});
