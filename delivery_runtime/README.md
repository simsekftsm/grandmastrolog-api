# GrandMastrolog Delivery Runtime — M1A-4

This directory is the isolated GrandMastrolog delivery-runtime boundary. It preserves the unrelated existing GrandMastrolog API behavior while enforcing the accepted delivery path.

## Current accepted runtime scope

- `GET /api/health` reports the active M1A-4 capabilities and deployment/source provenance.
- `POST /api/model-natal` accepts the strict `gm.natal.v1` structured semantic contract and fails closed on invalid or unsafe model output.
- `POST /api/render-natal` applies the deterministic canonical renderer.
- Trust/provenance checks are mandatory for privileged delivery surfaces.
- Final delivery is gated by the delivery validator and production authorization.
- Raw model output is not an authorized delivery path.

## Acceptance

Release acceptance is valid only when the exact runtime candidate and the bound production deployment pass the required regressions and live probes. Pre-merge evidence is not inherited by a different post-merge candidate.
