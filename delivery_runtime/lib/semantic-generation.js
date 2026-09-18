'use strict';

const { SCHEMA_ID, SPECIAL_ORDER, modelInstructions } = require('./natal-contract');

function compactProviderSchema(verifiedEvidence, availability) {
  const expectedSpecials = SPECIAL_ORDER.filter((id) => availability && availability[id] === true);

  const refs = (min, max) => ({
    type: 'array',
    minItems: min,
    maxItems: max,
    items: { type: 'string' }
  });

  const paragraphs = (max) => ({
    type: 'array',
    minItems: 1,
    maxItems: max,
    items: { type: 'string' }
  });

  const section = {
    type: 'object',
    additionalProperties: false,
    required: ['section_id', 'body_paragraphs', 'hat_evidence_refs'],
    properties: {
      section_id: {
        type: 'string',
        enum: [
          'profilin', 'haritanin_ozu', 'element_dengen', 'sinerji', 'senin_yolun',
          'para_kariyer', 'iliskiler', 'aile', 'karmalar'
        ]
      },
      body_paragraphs: paragraphs(6),
      hat_evidence_refs: refs(1, 12)
    }
  };

  const specialContributionId = expectedSpecials.length
    ? { type: 'string', enum: expectedSpecials }
    : { type: 'string' };

  const special = {
    type: 'object',
    additionalProperties: false,
    required: ['contribution_id', 'body_paragraphs', 'evidence_refs'],
    properties: {
      contribution_id: specialContributionId,
      body_paragraphs: paragraphs(4),
      evidence_refs: refs(1, 12)
    }
  };

  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'prelude', 'pre_seal_sections', 'personal_seal',
      'main_life_sections', 'special_contributions'
    ],
    properties: {
      prelude: {
        type: 'object',
        additionalProperties: false,
        required: ['body_paragraphs', 'hat_evidence_refs'],
        properties: {
          body_paragraphs: paragraphs(4),
          hat_evidence_refs: refs(1, 12)
        }
      },
      pre_seal_sections: {
        type: 'array',
        minItems: 5,
        maxItems: 5,
        items: section
      },
      personal_seal: {
        type: 'object',
        additionalProperties: false,
        required: ['motto'],
        properties: { motto: { type: 'string' } }
      },
      main_life_sections: {
        type: 'array',
        minItems: 4,
        maxItems: 4,
        items: section
      },
      special_contributions: {
        type: 'array',
        minItems: expectedSpecials.length,
        maxItems: expectedSpecials.length,
        items: special
      }
    }
  };
}

function providerGenerationFormat(verifiedEvidence, availability) {
  return {
    type: 'json_schema',
    name: `${SCHEMA_ID}_provider_generation`,
    description: 'Provider-neutral GrandMastrolog semantic candidate. Canonical identities, placements, inclusion, calibration, metadata, rendering and final validation remain server-owned.',
    schema: compactProviderSchema(verifiedEvidence, availability),
    strict: true
  };
}

function providerModelInstructions(availability, verifiedEvidence) {
  return [
    modelInstructions(availability, verifiedEvidence),
    'PROVIDER-NEUTRAL BINDING RULE: output only semantic candidate content required by the supplied provider schema.',
    'Final identities, natal placements, inclusion flags, calibration, metadata, visible layout and delivery authority are server-owned.',
    'Use only VERIFIED_EVIDENCE ids when citing evidence. Unverified or invented references will be discarded and the strict downstream contract can reject the candidate.',
    'Do not emit Markdown, headings, bullets, blockquotes, links, HTML or Hat markup inside semantic prose.',
    'Keep each section semantically distinct; do not spread one generic synthesis across the whole chart.'
  ].join('\n');
}

module.exports = { compactProviderSchema, providerGenerationFormat, providerModelInstructions };
