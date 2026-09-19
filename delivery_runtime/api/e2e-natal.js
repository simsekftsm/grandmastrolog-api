'use strict';

const { applySecurityHeaders } = require('../lib/foundation');
const { enforceTrustedRequest } = require('../lib/trust-boundary');
const { ContractValidationError, SchemaValidationError, validateBindingInput, makeValidatedEnvelope, CONTRACT_VERSION, SCHEMA_ID, SCHEMA_VERSION, PLACEMENT_ORDER } = require('../lib/natal-contract');
const { GROQ_MAX_OUTPUT_TOKENS, groqNarrativeFormat, groqNarrativeInstructions } = require('../lib/groq-binding');
const { DeliveryValidationError, validateFinalDelivery } = require('../lib/delivery-validator');
const { RendererError, ElementVisualError } = require('../lib/natal-renderer');
const { buildFrozenNatalArtifact, SemanticKernelError } = require('../semantic_kernel/kernel');
const { localSemanticDependencies } = require('../semantic_kernel/dependency-runtime');
const { NarrativeBoundaryError, toLegacySemanticPayload } = require('../semantic_kernel/narrative-boundary');

const GROQ_RESPONSES_URL = 'https://api.groq.com/openai/v1/responses';
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
const MODEL_BINDING = 'groq_frozen_claim_narrative_json_schema_v1';

function extractOutputText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) return response.output_text;
  for (const item of response?.output || []) for (const content of item?.content || []) {
    if (content?.type === 'refusal') throw new Error('MODEL_REFUSAL');
    if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
  }
  throw new Error('MODEL_OUTPUT_MISSING');
}
function finalDeliveryAuthorized() { return process.env.GM_FINAL_DELIVERY_AUTHORIZED === 'true'; }

module.exports = async function e2eNatal(req, res) {
  applySecurityHeaders(res);
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({ok:false,code:'METHOD_NOT_ALLOWED'}); }
  if (!enforceTrustedRequest(req,res,'e2e-natal')) return;
  if (!finalDeliveryAuthorized()) return res.status(503).json({ok:false,code:'FINAL_DELIVERY_NOT_AUTHORIZED',delivery_validator_enabled:false,final_delivery_authorized:false});
  try {
    const outer=req.body;
    if(!outer||typeof outer!=='object'||Array.isArray(outer)) return res.status(400).json({ok:false,code:'INVALID_REQUEST'});
    const keys=Object.keys(outer).sort();
    if(keys.length!==2||keys[0]!=='binding_input'||keys[1]!=='semantic_dependencies') return res.status(400).json({ok:false,code:'UNKNOWN_FIELD'});
    const bindingInput=outer.binding_input;
    const { evidenceMap, availability }=validateBindingInput(bindingInput);

    const frozenArtifact=buildFrozenNatalArtifact({bindingInput,semanticDependencies:outer.semantic_dependencies,localDependencies:localSemanticDependencies()});

    const apiKey=process.env.GROQ_API_KEY;
    const configuredModel=process.env.GROQ_MODEL;
    if(!apiKey) return res.status(503).json({ok:false,code:'RUNTIME_SECRET_OR_MODEL_BINDING_UNAVAILABLE'});
    if(configuredModel&&configuredModel!==DEFAULT_GROQ_MODEL) return res.status(503).json({ok:false,code:'RUNTIME_MODEL_FREEZE_VIOLATION',expected_model:DEFAULT_GROQ_MODEL});

    const response=await fetch(GROQ_RESPONSES_URL,{
      method:'POST',
      headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:DEFAULT_GROQ_MODEL,instructions:groqNarrativeInstructions(frozenArtifact),input:'Frozen semantic artifact için GrandMastrolog anlatımını üret.',max_output_tokens:GROQ_MAX_OUTPUT_TOKENS,text:{format:groqNarrativeFormat(frozenArtifact)}}),
      signal:AbortSignal.timeout(50000)
    });
    if(!response.ok) return res.status(502).json({ok:false,code:'MODEL_BINDING_UPSTREAM_FAIL',upstream_provider:'groq',upstream_status:response.status});
    const json=await response.json();
    if(json.status&&json.status!=='completed') return res.status(502).json({ok:false,code:'MODEL_RESPONSE_INCOMPLETE',upstream_provider:'groq'});
    let narrative;
    try{narrative=JSON.parse(extractOutputText(json));}
    catch(error){if(error?.message==='MODEL_REFUSAL') throw error; return res.status(502).json({ok:false,code:'MODEL_STRUCTURED_PARSE_FAIL',upstream_provider:'groq'});}

    const materialized=toLegacySemanticPayload(frozenArtifact,narrative,bindingInput,{CONTRACT_VERSION,SCHEMA_ID,SCHEMA_VERSION,PLACEMENT_ORDER});
    const canonicalPayload=materialized.semantic_payload;
    makeValidatedEnvelope(canonicalPayload,evidenceMap,availability);
    const delivery=validateFinalDelivery(bindingInput,canonicalPayload);
    return res.status(200).json({
      ok:true,request_id:bindingInput.request_id,model_binding:MODEL_BINDING,provider:'groq',model:DEFAULT_GROQ_MODEL,
      delivery_validator_enabled:true,final_delivery_authorized:true,delivery,
      semantic:{astroir_version:frozenArtifact.astroir_version,kernel_id:frozenArtifact.kernel_id,build_id:frozenArtifact.build_id,dependency_lock_id:frozenArtifact.dependency_lock_id,transition_id:frozenArtifact.transition.transition_id,frozen_artifact_sha256:frozenArtifact.artifact_sha256,narrative_anchor_id:materialized.narrative_anchor_ledger.narrative_anchor_id}
    });
  } catch(error) {
    if(error instanceof DeliveryValidationError) return res.status(error.statusCode).json({ok:false,code:error.code,path:error.path});
    if(error instanceof SemanticKernelError||error instanceof NarrativeBoundaryError) return res.status(422).json({ok:false,code:error.code,path:error.path||'$'});
    if(error instanceof ContractValidationError||error instanceof SchemaValidationError||error instanceof RendererError||error instanceof ElementVisualError) return res.status(422).json({ok:false,code:error.code||'DELIVERY_REJECTED',path:error.path||'$'});
    if(error?.message==='MODEL_REFUSAL') return res.status(502).json({ok:false,code:'MODEL_REFUSAL',upstream_provider:'groq'});
    if(error?.name==='TimeoutError') return res.status(504).json({ok:false,code:'MODEL_BINDING_TIMEOUT',upstream_provider:'groq'});
    return res.status(500).json({ok:false,code:'E2E_NATAL_INTERNAL_ERROR'});
  }
};
