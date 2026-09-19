'use strict';

const {
  ContractValidationError,
  CONTRACT_VERSION,
  SCHEMA_ID,
  SCHEMA_VERSION,
  PLACEMENT_ORDER,
  PRE_SEAL_SECTION_ORDER,
  MAIN_LIFE_SECTION_ORDER,
  SPECIAL_ORDER
} = require('./natal-contract');

const REQUIRED_SECTIONS = new Set([
  'profilin', 'haritanin_ozu', 'para_kariyer', 'iliskiler', 'aile', 'karmalar'
]);

function fail(code, message, path = '$') {
  throw new ContractValidationError(code, message, path);
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uniqueBy(items, key, allowed, path) {
  const map = new Map();
  for (const item of arrayOrEmpty(items)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const id = item[key];
    if (!allowed.includes(id)) continue;
    if (map.has(id)) fail('MODEL_BINDING_DUPLICATE_IDENTITY', `Duplicate model identity: ${id}`, path);
    map.set(id, item);
  }
  return map;
}

function verifiedRefs(refs, evidenceMap, forced = []) {
  const out = [];
  const seen = new Set();
  for (const ref of [...forced, ...arrayOrEmpty(refs)]) {
    if (typeof ref !== 'string' || seen.has(ref)) continue;
    const evidence = evidenceMap.get(ref);
    if (!evidence || evidence.verification_state !== 'verified') continue;
    seen.add(ref);
    out.push(ref);
  }
  return out;
}

function exactPlacementEvidence(evidenceMap, subjectId) {
  const matches = [...evidenceMap.values()].filter((item) =>
    item.kind === 'placement' && item.subject_id === subjectId && item.verification_state === 'verified'
  );
  if (matches.length !== 1) {
    fail(
      'CANONICAL_PLACEMENT_EVIDENCE_CARDINALITY',
      `Expected exactly one verified placement evidence item for ${subjectId}.`,
      '$.verified_evidence'
    );
  }
  return matches[0];
}

function canonicalSection(source, sectionId, included, evidenceMap) {
  const src = objectOrEmpty(source);
  return {
    section_id: sectionId,
    included,
    body_paragraphs: included ? arrayOrEmpty(src.body_paragraphs) : [],
    hat_evidence_refs: included ? verifiedRefs(src.hat_evidence_refs, evidenceMap) : []
  };
}

function canonicalizeModelPayload(payload, evidenceMap, availability) {
  const src = objectOrEmpty(payload);
  const preludeSource = objectOrEmpty(src.prelude);
  const preludeIncluded = availability.ayin_gokyuzu_haritasi === true;

  const preSealById = uniqueBy(src.pre_seal_sections, 'section_id', PRE_SEAL_SECTION_ORDER, '$.pre_seal_sections');
  const mainById = uniqueBy(src.main_life_sections, 'section_id', MAIN_LIFE_SECTION_ORDER, '$.main_life_sections');
  const specialById = uniqueBy(src.special_contributions, 'contribution_id', SPECIAL_ORDER, '$.special_contributions');

  const placements = PLACEMENT_ORDER.map((pointId) => {
    const evidence = exactPlacementEvidence(evidenceMap, pointId);
    return {
      point_id: pointId,
      sign: evidence.sign,
      degree: evidence.degree,
      house: evidence.house,
      retrograde: evidence.retrograde,
      evidence_id: evidence.evidence_id
    };
  });

  const preSealSections = PRE_SEAL_SECTION_ORDER.map((sectionId) => {
    const included = REQUIRED_SECTIONS.has(sectionId) || availability[sectionId] === true;
    return canonicalSection(preSealById.get(sectionId), sectionId, included, evidenceMap);
  });

  const mainLifeSections = MAIN_LIFE_SECTION_ORDER.map((sectionId) =>
    canonicalSection(mainById.get(sectionId), sectionId, true, evidenceMap)
  );

  const sealSource = objectOrEmpty(src.personal_seal);
  const sunEvidence = exactPlacementEvidence(evidenceMap, 'sun');
  const ascEvidence = exactPlacementEvidence(evidenceMap, 'ascendant');

  const specialContributions = SPECIAL_ORDER
    .filter((contributionId) => availability[contributionId] === true)
    .map((contributionId) => {
      const item = objectOrEmpty(specialById.get(contributionId));
      return {
        contribution_id: contributionId,
        body_paragraphs: arrayOrEmpty(item.body_paragraphs),
        evidence_refs: verifiedRefs(item.evidence_refs, evidenceMap)
      };
    });

  return {
    contract_version: CONTRACT_VERSION,
    response_id: 'initial_natal',
    opening_id: 'natal_first_pass',
    prelude: {
      section_id: 'ayin_gokyuzu_haritasi',
      included: preludeIncluded,
      body_paragraphs: preludeIncluded ? arrayOrEmpty(preludeSource.body_paragraphs) : [],
      hat_evidence_refs: preludeIncluded ? verifiedRefs(preludeSource.hat_evidence_refs, evidenceMap) : []
    },
    natal_placements: placements,
    pre_seal_sections: preSealSections,
    personal_seal: {
      seal_id: 'sun_asc_personal_seal',
      included: true,
      motto: typeof sealSource.motto === 'string' ? sealSource.motto : '',
      evidence_refs: verifiedRefs(sealSource.evidence_refs, evidenceMap, [sunEvidence.evidence_id, ascEvidence.evidence_id]).slice(0, 12)
    },
    main_life_sections: mainLifeSections,
    first_calibration: { calibration_id: 'main_life_areas', required: true },
    special_contributions: specialContributions,
    second_calibration: { calibration_id: 'general_natal', required: true },
    return_identity: 'return_to_user_intent',
    validation_metadata: {
      schema_id: SCHEMA_ID,
      schema_version: SCHEMA_VERSION,
      evidence_policy: 'verified_only',
      visible_markup_owner: 'm1a3_deterministic_renderer'
    }
  };
}

module.exports = { canonicalizeModelPayload };
