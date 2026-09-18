# GrandMastrolog Delivery Runtime

This directory contains the governed GrandMastrolog Natal delivery runtime.

## Canonical model boundary

The runtime is provider-adapted and fail-closed.

- Canonical provider: Google Gemini API
- Canonical default model: `gemini-3.1-flash-lite`
- Provider API: Gemini Interactions API
- Structured output: JSON Schema response format
- Maximum provider output budget: 8192 tokens
- Visible layout owner: deterministic GrandMastrolog renderer
- Final semantic authority: server-side `gm.natal.v1` validator

The model does not own chart calculation, placements, inclusion flags, calibration,
metadata, visible Markdown layout, or final delivery authority. Those are bound
from verified server evidence and canonical runtime rules.

## Deterministic semantic normalization

Provider output passes through a formatting-only normalizer before the canonical
semantic validator. It may remove presentation-only Markdown markers such as
bold/backtick/heading/list/block-quote syntax. It must preserve the lexical
letter/number token sequence exactly. Any lexical drift fails closed.

Links, HTML and other unsafe semantic markup are not repaired and remain subject
to rejection by the downstream contract.

## Required runtime secrets

- `GM_API_SECRET`: internal GrandMastrolog trust/request-signing secret.
- `GEMINI_API_KEY`: provider credential for the Gemini API.

These secrets are not interchangeable.

Optional freeze variables:

- `GM_MODEL_PROVIDER` may be unset or exactly `google`.
- `GM_MODEL` may be unset or exactly `gemini-3.1-flash-lite`.

Any conflicting override fails closed.

## Delivery path

Verified astro evidence -> provider-neutral semantic generation schema -> Gemini
semantic candidate -> deterministic format normalization -> server canonical
binding -> `gm.natal.v1` validation -> canonical renderer -> final delivery
validator.

Raw model output is never authorized as user-visible final delivery.

## Acceptance

A release candidate must pass the delivery-runtime regression suite, integration
regression, frozen M1A-5 semantic-quality corpus, and counterexample specificity
gate before production migration.
