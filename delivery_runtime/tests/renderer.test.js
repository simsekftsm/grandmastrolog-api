'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const renderNatal = require('../api/render-natal');
const {
  RendererError,
  ElementVisualError,
  renderCanonicalNatal,
  assertCanonicalPostconditions,
  FINAL_CALIBRATION,
  RETURN_TO_USER_INTENT
} = require('../lib/natal-renderer');
const { availability, bindingInput, validPayload, clone } = require('./helpers');
const { trustedRequest } = require('./trust-test-helper');

function fakeResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: undefined,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    getHeader(name) { return headers.get(name.toLowerCase()); },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function fixture(overrides = {}) {
  const av = availability(overrides);
  const binding = bindingInput(av);
  const payload = validPayload(av);
  if (av.element_dengen) {
    const ev = binding.verified_evidence.find((x) => x.evidence_id === 'ev_element_dengen');
    ev.semantic_value = JSON.stringify({ 'Ateş': 45, 'Toprak': 25, 'Hava': 20, 'Su': 10 });
  }
  return { av, binding, payload };
}

function render(overrides = {}) {
  const f = fixture(overrides);
  return { ...f, result: renderCanonicalNatal(f.binding, f.payload) };
}

function rehash(result) {
  result.canonical_markdown_sha256 = crypto.createHash('sha256').update(result.canonical_markdown, 'utf8').digest('hex');
  return result;
}

function mustReject(fn) { assert.throws(fn); }

test('M1A-3 positive: valid canonical envelope path renders exact owner shell', () => {
  const { result } = render();
  const text = result.canonical_markdown;
  assert.equal(result.render_state, 'rendered_for_m1a3_acceptance');
  assert.equal(result.final_delivery_authorized, false);
  assert.equal(result.delivery_validator_enabled, false);
  assert.ok(text.startsWith('---\n> # • NATAL (DOĞUM) HARİTAN •\n'));
  assert.match(text, /> \*Güneş Balık 10°00′ — 1\. ev\*  \n/);
  assert.match(text, /> \*Plüton Akrep 20°00′ — 11\. ev \(R\)\*  \n/);
  assert.equal(text.includes('Harita hattın:'), false);
  assert.equal(text.includes('POTANSİYELLER'), false);
});

test('M1A-3 positive: same validated input renders byte-identical Markdown and visuals', () => {
  const f = fixture({ element_dengen: true, sinerji: true });
  const a = renderCanonicalNatal(clone(f.binding), clone(f.payload));
  const b = renderCanonicalNatal(clone(f.binding), clone(f.payload));
  assert.deepEqual(a, b);
  assert.equal(a.canonical_markdown_sha256, b.canonical_markdown_sha256);
  assert.equal(a.visual_attachments[0].sha256, b.visual_attachments[0].sha256);
});

test('M1A-3 positive: optional sections absent do not leak', () => {
  const { result } = render();
  const text = result.canonical_markdown;
  assert.equal(text.includes('• ELEMENT DENGEN •'), false);
  assert.equal(text.includes('SİNERJİSİ •'), false);
  assert.equal(text.includes('• SENİN YOLUN •'), false);
  assert.equal(result.visual_attachments.length, 0);
});

test('M1A-3 positive: optional sections present use canonical headings and element visual', () => {
  const { result } = render({ element_dengen: true, sinerji: true, senin_yolun: true });
  const text = result.canonical_markdown;
  assert.ok(text.includes('> ## • ELEMENT DENGEN •'));
  assert.ok(text.includes('> ## • BALIK + ASLAN SİNERJİSİ •'));
  assert.ok(text.includes('> ## • SENİN YOLUN •'));
  assert.equal(result.visual_attachments.length, 1);
  assert.equal(result.visual_attachments[0].insert_after_section, 'element_dengen');
  assert.equal(result.visual_attachments[0].mime_type, 'image/svg+xml');
});

test('M1A-3 positive: canonical element visual uses baseline assets and B5 legend ordering/font steps', () => {
  const { result } = render({ element_dengen: true });
  const visual = result.visual_attachments[0];
  assert.deepEqual(visual.asset_refs, ['/elements/ates.png','/elements/toprak.png','/elements/hava.png','/elements/su.png']);
  assert.deepEqual(visual.legend.map((x) => x.element), ['Ateş','Toprak','Hava','Su']);
  assert.deepEqual(visual.legend.map((x) => x.name_font_size), [28,27,26,25]);
  assert.deepEqual(visual.legend.map((x) => x.percent_font_size), [29,28,27,26]);
  assert.match(visual.svg, /font-weight="700" fill="#ff8412">ATEŞ<\/text>/);
  assert.match(visual.svg, /font-size="28" font-weight="400" fill="#ff8412">ATEŞ<\/text>/);
});

test('M1A-3 positive: personal seal is single canonical Sun & Ascendant shell in correct order', () => {
  const { result, payload } = render();
  const text = result.canonical_markdown;
  const seal = `> *Balık & Aslan: ${payload.personal_seal.motto}*`;
  assert.equal((text.match(new RegExp(seal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);
  assert.ok(text.indexOf(seal) > text.indexOf('> ## • HARİTANIN ÖZÜ •'));
  assert.ok(text.indexOf(seal) < text.indexOf('> ## • PARA & KARİYER •'));
});

test('M1A-3 positive: single final calibration and return identity are exact and ordered', () => {
  const { result } = render();
  const text = result.canonical_markdown;
  assert.equal((text.match(/Buraya kadarki ana yaşam alanları/g) || []).length, 0);
  assert.equal((text.match(/Bu anlattıklarım sende karşılık buluyor mu\?/g) || []).length, 0);
  assert.equal((text.match(/Bu anlattıklarım sende karşılık buldu mu:/g) || []).length, 1);
  assert.equal((text.match(/Natal kapısı tamamlandı/g) || []).length, 1);
  assert.ok(text.indexOf(FINAL_CALIBRATION) < text.indexOf(RETURN_TO_USER_INTENT));
});

test('M1A-3 positive: special contributions follow server canonical order for mixed availability', () => {
  const { result } = render({ hellenistic:true, sade_sati:true, lilith:true, fixed_stars:true });
  const text = result.canonical_markdown;
  const ids = ['hellenistic','sade_sati','lilith','fixed_stars'];
  const positions = ids.map((id) => text.indexOf(`${id} için düz semantik katkı.`));
  positions.forEach((p) => assert.ok(p >= 0));
  assert.deepEqual([...positions].sort((a,b)=>a-b), positions);
  assert.ok(positions.at(-1) < text.indexOf(FINAL_CALIBRATION));
});

test('M1A-3 positive: semantic body paragraphs are preserved verbatim without merge/drop', () => {
  const f = fixture();
  f.payload.pre_seal_sections[0].body_paragraphs = ['Birinci düz semantik paragraf.', 'İkinci düz semantik paragraf.'];
  const result = renderCanonicalNatal(f.binding, f.payload);
  assert.ok(result.canonical_markdown.includes('Birinci düz semantik paragraf.\n\nİkinci düz semantik paragraf.'));
  assert.equal(assertCanonicalPostconditions(result, f.payload), true);
});

test('M1A-3 positive: Haritanın Özü exact blockquote + Hat + separator lock is preserved', () => {
  const { result } = render();
  assert.match(result.canonical_markdown, /> ## • HARİTANIN ÖZÜ •\n>\n> \*Hat: [^\n]+\*\n---\nharitanin_ozu için düz semantik içerik\.\n---/);
});

test('M1A-3 positive: monthly prelude appears only when verified availability says true', () => {
  const { result } = render({ ayin_gokyuzu_haritasi:true });
  assert.ok(result.canonical_markdown.startsWith('> ## • AYIN GÖKYÜZÜ HARİTASI •\n> *Hat: '));
  assert.ok(result.canonical_markdown.indexOf('• AYIN GÖKYÜZÜ HARİTASI •') < result.canonical_markdown.indexOf('• NATAL (DOĞUM) HARİTAN •'));
});

test('MUTANT wrong section order is killed', () => { const f=fixture(); [f.payload.pre_seal_sections[0],f.payload.pre_seal_sections[1]]=[f.payload.pre_seal_sections[1],f.payload.pre_seal_sections[0]]; mustReject(() => renderCanonicalNatal(f.binding,f.payload)); });
test('MUTANT duplicate section is killed', () => { const f=fixture(); f.payload.pre_seal_sections[1].section_id=f.payload.pre_seal_sections[0].section_id; mustReject(() => renderCanonicalNatal(f.binding,f.payload)); });
test('MUTANT missing required section is killed', () => { const f=fixture(); const s=f.payload.main_life_sections.find((x)=>x.section_id==='aile'); s.included=false; s.body_paragraphs=[]; s.hat_evidence_refs=[]; mustReject(() => renderCanonicalNatal(f.binding,f.payload)); });
test('MUTANT fake renderer title is killed before rendering', () => { const f=fixture(); f.payload.pre_seal_sections[0].visible_title='Benim Başlığım'; mustReject(() => renderCanonicalNatal(f.binding,f.payload)); });

test('MUTANTS model Markdown, Hat syntax and separator injection are killed', () => {
  for (const bad of ['> ## sahte', '*Hat: sahte*', '---']) { const f=fixture(); f.payload.pre_seal_sections[0].body_paragraphs=[bad]; mustReject(() => renderCanonicalNatal(f.binding,f.payload)); }
});

test('MUTANT standalone POTANSİYELLER is killed', () => { const f=fixture(); f.payload.pre_seal_sections[0].section_id='potansiyeller'; mustReject(() => renderCanonicalNatal(f.binding,f.payload)); });
test('MUTANT wrong section identity/title is killed', () => { const f=fixture(); f.payload.main_life_sections[1].section_id='iliski_sosyal_cevre'; mustReject(() => renderCanonicalNatal(f.binding,f.payload)); });

test('MUTANT blockquote line loss is killed by independent renderer postcondition', () => {
  const { result, payload }=render(); const mutant=clone(result); mutant.canonical_markdown=mutant.canonical_markdown.replace('> ## • PROFİLİN •','## • PROFİLİN •'); rehash(mutant); assert.throws(()=>assertCanonicalPostconditions(mutant,payload), RendererError);
});

test('MUTANT heading/body order deviation is killed', () => {
  const { result, payload }=render(); const mutant=clone(result); mutant.canonical_markdown=mutant.canonical_markdown.replace('> ## • PROFİLİN •\n> *Hat:', 'profilin için düz semantik içerik.\n> ## • PROFİLİN •\n> *Hat:'); rehash(mutant); assert.throws(()=>assertCanonicalPostconditions(mutant,payload), RendererError);
});

test('MUTANT personal seal moved after main-life content is killed', () => {
  const { result, payload }=render(); const mutant=clone(result); const seal=`> *Balık & Aslan: ${payload.personal_seal.motto}*\n---`; mutant.canonical_markdown=mutant.canonical_markdown.replace(`${seal}\n`, '').replace(FINAL_CALIBRATION, `${seal}\n${FINAL_CALIBRATION}`); rehash(mutant); assert.throws(()=>assertCanonicalPostconditions(mutant,payload), RendererError);
});

test('MUTANT calibration moved to wrong position is killed', () => {
  const { result, payload }=render(); const mutant=clone(result); mutant.canonical_markdown=mutant.canonical_markdown.replace(FINAL_CALIBRATION,'').replace('> ## • PARA & KARİYER •', `${FINAL_CALIBRATION}\n\n> ## • PARA & KARİYER •`); rehash(mutant); assert.throws(()=>assertCanonicalPostconditions(mutant,payload), RendererError);
});

test('MUTANT special contribution wrong order is killed by server contract', () => { const f=fixture({hellenistic:true,jyotish:true}); [f.payload.special_contributions[0],f.payload.special_contributions[1]]=[f.payload.special_contributions[1],f.payload.special_contributions[0]]; mustReject(()=>renderCanonicalNatal(f.binding,f.payload)); });
test('MUTANT excluded section content leak is killed', () => { const f=fixture(); const s=f.payload.pre_seal_sections.find((x)=>x.section_id==='sinerji'); s.body_paragraphs=['sızma']; s.hat_evidence_refs=['ev_sinerji']; mustReject(()=>renderCanonicalNatal(f.binding,f.payload)); });

test('MUTANT raw semantic JSON never leaks through Element Hat', () => {
  const { result }=render({element_dengen:true}); assert.equal(result.canonical_markdown.includes('{"Ateş":45'), false); assert.equal(result.canonical_markdown.includes('"semantic_payload"'), false); assert.equal(result.canonical_markdown.includes('"evidence_bindings"'), false);
});

test('MUTANT raw model output key cannot enter renderer request', async () => {
  const f=fixture(); const res=fakeResponse(); const body={binding_input:f.binding,semantic_payload:f.payload,raw_model_output:'# raw'}; await renderNatal(trustedRequest('render-natal', body),res); assert.equal(res.statusCode,400); assert.equal(res.body.code,'UNKNOWN_FIELD');
});

test('MUTANT manual/fake validated envelope is rejected at API boundary', async () => {
  const res=fakeResponse(); const body={contract:{contract_version:'gm.natal.v1'},binding_input:{},semantic_payload:{}}; await renderNatal(trustedRequest('render-natal', body),res); assert.equal(res.statusCode,400); assert.equal(res.body.code,'UNKNOWN_FIELD');
});

test('MUTANT semantic text rewrite is killed', () => {
  const { result, payload }=render(); const mutant=clone(result); mutant.canonical_markdown=mutant.canonical_markdown.replace('profilin için düz semantik içerik.','profilin yeniden yazıldı.'); rehash(mutant); assert.throws(()=>assertCanonicalPostconditions(mutant,payload), RendererError);
});

test('MUTANT body paragraph drop is killed', () => {
  const f=fixture(); f.payload.pre_seal_sections[0].body_paragraphs=['A paragrafı.','B paragrafı.']; const result=renderCanonicalNatal(f.binding,f.payload); const mutant=clone(result); mutant.canonical_markdown=mutant.canonical_markdown.replace('B paragrafı.',''); rehash(mutant); assert.throws(()=>assertCanonicalPostconditions(mutant,f.payload), RendererError);
});

test('MUTANT body paragraph merge is killed', () => {
  const f=fixture(); f.payload.pre_seal_sections[0].body_paragraphs=['A paragrafı.','B paragrafı.']; const result=renderCanonicalNatal(f.binding,f.payload); const mutant=clone(result); mutant.canonical_markdown=mutant.canonical_markdown.replace('A paragrafı.\n\nB paragrafı.','A paragrafı.B paragrafı.'); rehash(mutant); assert.throws(()=>assertCanonicalPostconditions(mutant,f.payload), RendererError);
});

test('MUTANT Element Dengen without structured verified percentages fails closed', () => {
  const f=fixture({element_dengen:true}); const ev=f.binding.verified_evidence.find((x)=>x.evidence_id==='ev_element_dengen'); ev.semantic_value='element dengesine dair genel gösterge'; assert.throws(()=>renderCanonicalNatal(f.binding,f.payload), ElementVisualError);
});

test('MUTANT invalid element sum fails closed', () => {
  const f=fixture({element_dengen:true}); const ev=f.binding.verified_evidence.find((x)=>x.evidence_id==='ev_element_dengen'); ev.semantic_value=JSON.stringify({'Ateş':90,'Toprak':25,'Hava':20,'Su':10}); assert.throws(()=>renderCanonicalNatal(f.binding,f.payload), ElementVisualError);
});

test('MUTANT renderer fail-open state is killed', () => {
  const { result, payload }=render(); const mutant=clone(result); mutant.final_delivery_authorized=true; assert.equal(result.final_delivery_authorized,false); assert.equal(result.delivery_validator_enabled,false); assert.throws(()=>{ assert.equal(mutant.final_delivery_authorized,false); assertCanonicalPostconditions(mutant,payload); });
});

test('render-natal API returns acceptance render only and no semantic envelope', async () => {
  const f=fixture(); const res=fakeResponse(); const body={binding_input:f.binding,semantic_payload:f.payload}; await renderNatal(trustedRequest('render-natal', body),res); assert.equal(res.statusCode,200); assert.equal(res.body.ok,true); assert.equal(res.body.render.final_delivery_authorized,false); const raw=JSON.stringify(res.body); assert.equal(raw.includes('semantic_payload'),false); assert.equal(raw.includes('evidence_bindings'),false);
});

test('render-natal API rejects non-POST', async () => { const res=fakeResponse(); await renderNatal({method:'GET'},res); assert.equal(res.statusCode,405); assert.equal(res.body.code,'METHOD_NOT_ALLOWED'); });
