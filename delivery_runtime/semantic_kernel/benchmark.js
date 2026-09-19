'use strict';

const { performance } = require('node:perf_hooks');
const { bindingInput, validPayload } = require('../tests/helpers');
const { validateBindingInput, makeValidatedEnvelope } = require('../lib/natal-contract');
const { renderCanonicalNatal } = require('../lib/natal-renderer');
const { buildFrozenNatalArtifact } = require('./kernel');
const { localSemanticDependencies } = require('./dependency-runtime');

const deps = {
  ephemeris_engine:{version:'bench-swisseph',sha256:'1'.repeat(64)},
  ephemeris_data:{version:'bench-ephe',sha256:'2'.repeat(64)},
  timezone_data:{version:'bench-tz',sha256:'3'.repeat(64)},
  calculation_implementation:{version:'bench-calc',sha256:'4'.repeat(64)},
  coordinate_canonicalization:{version:'bench-coord',sha256:'5'.repeat(64)},
  house_calculation:{version:'bench-house',sha256:'6'.repeat(64)}
};
const binding = bindingInput();
const payload = validPayload();
const ITER = 100;

function measure(fn) {
  const heap0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  let last;
  for (let i=0;i<ITER;i++) last=fn();
  const elapsed = performance.now()-t0;
  const heap1 = process.memoryUsage().heapUsed;
  return {
    iterations:ITER,
    total_ms:+elapsed.toFixed(3),
    avg_ms:+(elapsed/ITER).toFixed(4),
    heap_delta_bytes:heap1-heap0,
    last_artifact_bytes:Buffer.byteLength(JSON.stringify(last),'utf8')
  };
}

const legacy = measure(() => {
  const { evidenceMap, availability } = validateBindingInput(binding);
  const envelope = makeValidatedEnvelope(payload,evidenceMap,availability);
  return renderCanonicalNatal(binding,envelope.semantic_payload);
});
const kernel = measure(() => buildFrozenNatalArtifact({
  bindingInput:binding,
  semanticDependencies:deps,
  localDependencies:localSemanticDependencies()
}));

console.log(JSON.stringify({
  benchmark_id:'gm-semantic-kernel-rc-v1',
  scope:'local deterministic semantic build only; excludes network/model latency',
  legacy_contract_render:legacy,
  semantic_kernel_build:kernel,
  ratio_avg_ms: legacy.avg_ms ? +(kernel.avg_ms/legacy.avg_ms).toFixed(3) : null
},null,2));
