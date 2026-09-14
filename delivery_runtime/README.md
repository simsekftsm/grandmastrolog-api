# GrandMastrolog Delivery Runtime — M1A-1

This directory is an isolated delivery-runtime root. It does not change the existing GrandMastrolog learning/memory API behavior.

## Scope

M1A-1 establishes one thing only: a mandatory HTTP delivery boundary that is fail-closed by default.

- `GET /api/health` proves the runtime is alive and reports stage capabilities.
- `POST /api/delivery` deliberately returns `503 M1A_1_FOUNDATION_ONLY`.
- Raw model text is never forwarded at this stage.

M1A-1 does **not** implement the M1A-2 structured output contract, M1A-3 canonical renderer, M1A-4 delivery validator, or any R2/R3/R4 behavior.

## Acceptance

`npm test` must pass. The delivery endpoint must continue to reject every raw output until the later gates are explicitly implemented and independently accepted.
