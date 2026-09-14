'use strict';

const {
  schema,
  SCHEMA_ID,
  SPECIAL_ORDER,
  modelInstructions
} = require('./natal-contract');

function uniqueVerifiedEvidenceIds(verifiedEvidence) {
  return [...new Set(
    (Array.isArray(verifiedEvidence) ? verifiedEvidence : [])
      .filter((item) => item && item.verification_state === 'verified' && typeof item.evidence_id === 'string')
      .map((item) => item.evidence_id)
  )];
}

function groqGenerationFormat(verifiedEvidence, availability) {
  const generationSchema = JSON.parse(JSON.stringify(schema));
  const evidenceIds = uniqueVerifiedEvidenceIds(verifiedEvidence);
  const expectedSpecials = SPECIAL_ORDER.filter((id) => availability && availability[id] === true);

  // The provider must always return candidate semantic content for every fixed
  // slot. Final inclusion is server-owned and excluded candidate content is
  // deterministically discarded by model-binding.js before validation.
  generationSchema.$defs.prelude.properties.body_paragraphs.minItems = 1;
  generationSchema.$defs.prelude.properties.hat_evidence_refs.minItems = 1;
  generationSchema.$defs.section.properties.body_paragraphs.minItems = 1;
  generationSchema.$defs.section.properties.hat_evidence_refs.minItems = 1;

  // Special contribution cardinality is also server-derived. This removes a
  // stochastic model decision without changing the canonical downstream schema.
  generationSchema.properties.special_contributions.minItems = expectedSpecials.length;
  generationSchema.properties.special_contributions.maxItems = expectedSpecials.length;
  if (expectedSpecials.length) {
    generationSchema.$defs.specialContribution.properties.contribution_id.enum = expectedSpecials;
  }

  // The model can cite only evidence that already passed the verified-input gate.
  if (evidenceIds.length) {
    generationSchema.$defs.prelude.properties.hat_evidence_refs.items.enum = evidenceIds;
    generationSchema.$defs.section.properties.hat_evidence_refs.items.enum = evidenceIds;
    generationSchema.$defs.personalSeal.properties.evidence_refs.items.enum = evidenceIds;
    generationSchema.$defs.specialContribution.properties.evidence_refs.items.enum = evidenceIds;
    generationSchema.$defs.placement.properties.evidence_id.enum = evidenceIds;
  }

  return {
    type: 'json_schema',
    name: `${SCHEMA_ID}_groq_generation`,
    description: 'Provider-generation object for GrandMastrolog M1A-2. Deterministic contract facts are rebound by the server before independent canonical validation.',
    schema: generationSchema,
    strict: true
  };
}

function groqModelInstructions(availability, verifiedEvidence) {
  return [
    modelInstructions(availability, verifiedEvidence),
    'PROVIDER BINDING RULE: final identities, placements, inclusion, calibration and metadata are server-owned.',
    'Always populate at least one plain semantic body paragraph and at least one verified evidence reference for every fixed prelude, pre-seal and main-life slot, even when an inclusion flag is false; excluded candidate content will be discarded by the server.',
    'Do not invent evidence references. Use only VERIFIED_EVIDENCE ids permitted by the strict generation schema.',
    'Keep fixed section arrays in the canonical order stated above. The server, not the model, owns the final section identity.',
    'For special_contributions, return exactly the number of entries permitted by the strict schema and keep them in canonical special order.'
  ].join('\n');
}

module.exports = { groqGenerationFormat, groqModelInstructions };
