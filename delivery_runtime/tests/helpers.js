'use strict';

const {
  PLACEMENT_ORDER, PRE_SEAL_SECTION_ORDER, MAIN_LIFE_SECTION_ORDER, SPECIAL_ORDER
} = require('../lib/natal-contract');

function evidenceCatalog() {
  const signs = ['Balık','Başak','Aslan','Balık','Kova','Oğlak','Yengeç','Oğlak','Oğlak','Oğlak','Akrep','Kova','Boğa'];
  const placements = PLACEMENT_ORDER.map((point, i) => ({
    evidence_id: `ev_${point}`,
    source_ref: `astro://verified/${point}`,
    kind: 'placement',
    subject_id: point,
    semantic_value: `${point} verified placement`,
    sign: signs[i],
    degree: `${10 + i}°00′`,
    house: (point === 'ascendant' || point === 'mc') ? '' : `${(i % 12) + 1}. ev`,
    retrograde: point === 'pluto' || point === 'north_node',
    verification_state: 'verified'
  }));
  const semanticIds = [
    'ayin_gokyuzu_haritasi', ...PRE_SEAL_SECTION_ORDER, ...MAIN_LIFE_SECTION_ORDER,
    ...SPECIAL_ORDER
  ];
  const indicators = semanticIds.map((subject) => ({
    evidence_id: `ev_${subject}`,
    source_ref: `astro://verified/indicator/${subject}`,
    kind: 'indicator',
    subject_id: subject,
    semantic_value: `${subject} için doğrulanmış gösterge`,
    sign: '', degree: '', house: '', retrograde: false,
    verification_state: 'verified'
  }));
  return [...placements, ...indicators];
}

function availability(overrides = {}) {
  return {
    ayin_gokyuzu_haritasi: false,
    element_dengen: false,
    sinerji: false,
    senin_yolun: false,
    hellenistic: false,
    jyotish: false,
    esoteric: false,
    sade_sati: false,
    rahu_ketu: false,
    retrogrades: false,
    lilith: false,
    chiron: false,
    vertex: false,
    part_of_fortune: false,
    fixed_stars: false,
    ...overrides
  };
}

function bindingInput(av = availability()) {
  return {
    request_id: 'test-1',
    semantic_input: 'Doğrulanmış verilerden ilk Natal semantik sözleşmesini üret.',
    availability: av,
    verified_evidence: evidenceCatalog()
  };
}

function section(sectionId, included) {
  return {
    section_id: sectionId,
    included,
    body_paragraphs: included ? [`${sectionId} için düz semantik içerik.`] : [],
    hat_evidence_refs: included ? [`ev_${sectionId}`] : []
  };
}

function validPayload(av = availability()) {
  const evidence = evidenceCatalog();
  const byId = new Map(evidence.map((x) => [x.evidence_id, x]));
  const placements = PLACEMENT_ORDER.map((point) => {
    const ev = byId.get(`ev_${point}`);
    return {
      point_id: point, sign: ev.sign, degree: ev.degree, house: ev.house,
      retrograde: ev.retrograde, evidence_id: ev.evidence_id
    };
  });
  const required = new Set(['profilin','haritanin_ozu','para_kariyer','iliskiler','aile','karmalar']);
  const pre = PRE_SEAL_SECTION_ORDER.map((id) => section(id, required.has(id) || Boolean(av[id])));
  const main = MAIN_LIFE_SECTION_ORDER.map((id) => section(id, true));
  const special = SPECIAL_ORDER.filter((id) => av[id]).map((id) => ({
    contribution_id: id,
    body_paragraphs: [`${id} için düz semantik katkı.`],
    evidence_refs: [`ev_${id}`]
  }));
  return {
    contract_version: 'gm.natal.v1',
    response_id: 'initial_natal',
    opening_id: 'natal_first_pass',
    prelude: {
      section_id: 'ayin_gokyuzu_haritasi',
      included: av.ayin_gokyuzu_haritasi,
      body_paragraphs: av.ayin_gokyuzu_haritasi ? ['Bu ay için düz semantik içerik.'] : [],
      hat_evidence_refs: av.ayin_gokyuzu_haritasi ? ['ev_ayin_gokyuzu_haritasi'] : []
    },
    natal_placements: placements,
    pre_seal_sections: pre,
    personal_seal: {
      seal_id: 'sun_asc_personal_seal',
      included: true,
      motto: 'Duyarlılığını görünür bir iradeyle taşırsın.',
      evidence_refs: ['ev_sun', 'ev_ascendant']
    },
    main_life_sections: main,
    first_calibration: { calibration_id: 'main_life_areas', required: true },
    special_contributions: special,
    second_calibration: { calibration_id: 'general_natal', required: true },
    return_identity: 'return_to_user_intent',
    validation_metadata: {
      schema_id: 'gm_natal_semantic_v1',
      schema_version: '1.0.0',
      evidence_policy: 'verified_only',
      visible_markup_owner: 'm1a3_deterministic_renderer'
    }
  };
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

module.exports = { evidenceCatalog, availability, bindingInput, validPayload, clone };
