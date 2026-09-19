'use strict';

const { sha256, freezeDeep } = require('./stable');
const { verifyFrozenArtifact, REQUIRED_SECTIONS } = require('./kernel');
const { assertCapability } = require('./pass-contracts');

const FORBIDDEN_CAUSAL = /\b(çocukluk\s+travm|travman|travması|yüzünden|sebebiyle|neden olduğu için|geçmiş yaşam|kaderin gereği)\b/iu;
const MARKDOWN_ESCAPE = /(^|\n)\s{0,3}(?:#{1,6}(?:\s|$)|>(?:\s|$)|[-+*]\s+|\d+[.)]\s+|---\s*(?:\n|$)|```|~~~)|\*\*|__|`|\]\s*\(|<\/?[A-Za-z][^>]*>/;
const STOP = new Set('ve ile için bu bir aynı olan olarak yalnız ancak ama daha gibi de da ise veya çok tek her bütün arasında üzerinden altında üstünde'.split(' '));

class NarrativeBoundaryError extends Error {
  constructor(code, message, path = '$') { super(message || code); this.name='NarrativeBoundaryError'; this.code=code; this.path=path; }
}
function fail(code,message,path){throw new NarrativeBoundaryError(code,message,path);}
function tokens(text){return (String(text).toLocaleLowerCase('tr-TR').match(/[\p{L}\p{N}]+/gu)||[]).filter((x)=>x.length>2&&!STOP.has(x));}

function claimMaps(artifact){
  verifyFrozenArtifact(artifact);
  const byId=new Map(),bySection=new Map();
  for(const claim of artifact.defeasible_interpretation_state.claims){
    byId.set(claim.claim_state_id,claim);
    if(!bySection.has(claim.section_id)) bySection.set(claim.section_id,[]);
    bySection.get(claim.section_id).push(claim);
  }
  return {byId,bySection};
}

function narrativeSchema(artifact){
  const {bySection}=claimMaps(artifact);
  const sectionSchemas=REQUIRED_SECTIONS.map((sectionId)=>({
    type:'object',additionalProperties:false,required:['section_id','paragraphs'],
    properties:{
      section_id:{const:sectionId},
      paragraphs:{type:'array',minItems:1,maxItems:3,items:{
        type:'object',additionalProperties:false,required:['text','claim_refs'],
        properties:{
          text:{type:'string',minLength:20,maxLength:1600},
          claim_refs:{type:'array',minItems:1,maxItems:6,uniqueItems:true,items:{enum:(bySection.get(sectionId)||[]).map((c)=>c.claim_state_id)}}
        }
      }}
    }
  }));
  const allClaimIds=artifact.defeasible_interpretation_state.claims.map((c)=>c.claim_state_id);
  return {
    type:'json_schema',name:'gm_narrative_from_frozen_claims_v1',strict:true,
    description:'Narrative-only GrandMastrolog output. It may phrase and synthesize frozen claims but cannot create semantic state.',
    schema:{
      type:'object',additionalProperties:false,required:['sections','personal_seal'],
      properties:{
        sections:{type:'array',minItems:REQUIRED_SECTIONS.length,maxItems:REQUIRED_SECTIONS.length,prefixItems:sectionSchemas,items:false},
        personal_seal:{type:'object',additionalProperties:false,required:['motto','claim_refs'],properties:{
          motto:{type:'string',minLength:10,maxLength:320},
          claim_refs:{type:'array',minItems:1,maxItems:4,uniqueItems:true,items:{enum:allClaimIds}}
        }}
      }
    }
  };
}

function narrativeInstructions(artifact){
  const {bySection}=claimMaps(artifact);
  const sections={};
  for(const sectionId of REQUIRED_SECTIONS){
    sections[sectionId]=(bySection.get(sectionId)||[]).map((c)=>({
      claim_state_id:c.claim_state_id,proposition:c.proposition,status:c.status,robustness:c.robustness,salience:c.salience
    }));
  }
  return [
    'Sen GrandMastrolog’un language backend’isin. Semantic state FROZEN; yeni astrolojik fact, claim, neden, biyografi, teknik, zamanlama veya kesinlik yaratamazsın.',
    'Yalnız verilen claim_state_id değerlerine dayanarak doğal, nokta atışlı, nüanslı Türkçe danışmanlık anlatımı üret.',
    'Her paragraf claim_refs ile dayanağını açıkça bağlamalı. Bir paragraf yalnız kendi bölümündeki claim’leri kullanabilir.',
    'SUPPORTED bir claim’i daha kesin bir gerçekliğe yükseltme. ROBUST/CONDITIONAL/BOUNDARY-SENSITIVE niteliğini anlamca koru.',
    'Claim listesi okur gibi mekanik yazma; aynı claim’leri insani sentezde birleştirebilirsin. Ancak frozen artifact’te olmayan yeni nedensellik kurma.',
    'Metafor kullanabilirsin; metafor astrolojik veya biyografik yeni proposition üretmemeli.',
    'Çocukluk travması, yaşanmış olay, partner davranışı, kader kesinliği, aspect/ruler/dignity/transit gibi frozen claim setinde olmayan içerik yasak.',
    'Markdown, görünür Hat satırı, başlık veya ayırıcı üretme. Yalnız strict JSON schema çıktısı üret.',
    `FROZEN_CLAIMS=${JSON.stringify(sections)}`
  ].join('\n');
}

function paragraphAnchored(paragraph,claims){
  const claimTokens=new Set(claims.flatMap((c)=>tokens(c.proposition)));
  const overlap=[...new Set(tokens(paragraph))].filter((t)=>claimTokens.has(t));
  return overlap.length>=2;
}

function validateNarrative(artifact,narrative){
  assertCapability('narrative','narrative');
  const {byId}=claimMaps(artifact);
  if(!narrative||typeof narrative!=='object'||Array.isArray(narrative)) fail('NARRATIVE_OBJECT_REQUIRED');
  if(!Array.isArray(narrative.sections)||narrative.sections.length!==REQUIRED_SECTIONS.length) fail('NARRATIVE_SECTION_SET_INVALID');
  const anchors=[];
  narrative.sections.forEach((section,i)=>{
    const expected=REQUIRED_SECTIONS[i];
    if(section?.section_id!==expected) fail('NARRATIVE_SECTION_ORDER_INVALID',expected,`$.sections[${i}].section_id`);
    if(!Array.isArray(section.paragraphs)||!section.paragraphs.length) fail('NARRATIVE_PARAGRAPH_REQUIRED',expected);
    section.paragraphs.forEach((item,p)=>{
      if(!item||typeof item.text!=='string'||!Array.isArray(item.claim_refs)||!item.claim_refs.length) fail('CLAIM_ANCHOR_REQUIRED',expected,`$.sections[${i}].paragraphs[${p}]`);
      if(MARKDOWN_ESCAPE.test(item.text)) fail('NARRATIVE_MARKDOWN_FORBIDDEN',expected);
      if(FORBIDDEN_CAUSAL.test(item.text)) fail('UNSUPPORTED_CAUSAL_CLAIM',expected);
      const claims=item.claim_refs.map((id)=>byId.get(id));
      if(claims.some((c)=>!c||c.section_id!==expected)) fail('CLAIM_SCOPE_VIOLATION',expected);
      if(!paragraphAnchored(item.text,claims)) fail('CLAIM_ANCHOR_WEAK',expected);
      anchors.push({narrative_sha256:sha256(item.text),section_id:expected,claim_state_ids:[...item.claim_refs].sort()});
    });
  });
  const seal=narrative.personal_seal;
  if(!seal||typeof seal.motto!=='string'||!Array.isArray(seal.claim_refs)||!seal.claim_refs.length) fail('PERSONAL_SEAL_ANCHOR_REQUIRED');
  if(MARKDOWN_ESCAPE.test(seal.motto)||FORBIDDEN_CAUSAL.test(seal.motto)) fail('PERSONAL_SEAL_INVALID');
  const sealClaims=seal.claim_refs.map((id)=>byId.get(id));
  if(sealClaims.some((c)=>!c)) fail('CLAIM_NOT_FOUND');
  if(!paragraphAnchored(seal.motto,sealClaims)) fail('CLAIM_ANCHOR_WEAK','personal_seal');
  anchors.push({narrative_sha256:sha256(seal.motto),section_id:'personal_seal',claim_state_ids:[...seal.claim_refs].sort()});
  return freezeDeep({narrative_anchor_id:`nar_${sha256(anchors)}`,anchors});
}

function evidenceRefsForClaims(claimIds,byId){
  return [...new Set(claimIds.flatMap((id)=>byId.get(id)?.provenance?.root_evidence_ids||[]))].sort();
}

function toLegacySemanticPayload(artifact,narrative,bindingInput,constants){
  const anchorLedger=validateNarrative(artifact,narrative);
  const {byId}=claimMaps(artifact);
  const ev=new Map(bindingInput.verified_evidence.map((x)=>[x.evidence_id,x]));
  const placements=constants.PLACEMENT_ORDER.map((point_id)=>{
    const item=[...ev.values()].find((x)=>x.kind==='placement'&&x.subject_id===point_id);
    if(!item) fail('PLACEMENT_REQUIRED',point_id);
    return {point_id,sign:item.sign,degree:item.degree,house:item.house,retrograde:item.retrograde,evidence_id:item.evidence_id};
  });
  const sectionMap=new Map(narrative.sections.map((s)=>[s.section_id,s]));
  const section=(id,included)=>{
    if(!included) return {section_id:id,included:false,body_paragraphs:[],hat_evidence_refs:[]};
    const src=sectionMap.get(id); if(!src) fail('NARRATIVE_SECTION_MISSING',id);
    const refs=[...new Set(src.paragraphs.flatMap((p)=>p.claim_refs))];
    return {section_id:id,included:true,body_paragraphs:src.paragraphs.map((p)=>p.text),hat_evidence_refs:evidenceRefsForClaims(refs,byId)};
  };
  const availability=bindingInput.availability;
  if(availability.element_dengen||availability.sinerji||availability.senin_yolun||availability.hellenistic||availability.jyotish||availability.esoteric||availability.sade_sati||availability.rahu_ketu||availability.retrogrades||availability.lilith||availability.chiron||availability.vertex||availability.part_of_fortune||availability.fixed_stars){
    fail('DOCTRINE_SCOPE_NOT_MATERIALIZED','Optional/special doctrine scopes are not yet authorized in semantic kernel v1.');
  }
  const sun=placements.find((x)=>x.point_id==='sun'), asc=placements.find((x)=>x.point_id==='ascendant');
  const sealRefs=evidenceRefsForClaims(narrative.personal_seal.claim_refs,byId);
  for(const required of [sun.evidence_id,asc.evidence_id]) if(!sealRefs.includes(required)) sealRefs.push(required);
  sealRefs.sort();
  return freezeDeep({
    semantic_payload:{
      contract_version:constants.CONTRACT_VERSION,response_id:'initial_natal',opening_id:'natal_first_pass',
      prelude:{section_id:'ayin_gokyuzu_haritasi',included:false,body_paragraphs:[],hat_evidence_refs:[]},
      natal_placements:placements,
      pre_seal_sections:[
        section('profilin',true),section('haritanin_ozu',true),
        section('element_dengen',false),section('sinerji',false),section('senin_yolun',false)
      ],
      personal_seal:{seal_id:'sun_asc_personal_seal',included:true,motto:narrative.personal_seal.motto,evidence_refs:sealRefs.slice(0,12)},
      main_life_sections:['para_kariyer','iliskiler','aile','karmalar'].map((id)=>section(id,true)),
      first_calibration:{calibration_id:'main_life_areas',required:true},
      special_contributions:[],
      second_calibration:{calibration_id:'general_natal',required:true},
      return_identity:'return_to_user_intent',
      validation_metadata:{schema_id:constants.SCHEMA_ID,schema_version:constants.SCHEMA_VERSION,evidence_policy:'verified_only',visible_markup_owner:'m1a3_deterministic_renderer'}
    },
    narrative_anchor_ledger:anchorLedger
  });
}

module.exports={NarrativeBoundaryError,narrativeSchema,narrativeInstructions,validateNarrative,toLegacySemanticPayload};
