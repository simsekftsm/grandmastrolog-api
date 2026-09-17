import http from 'http';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { spawn } from 'child_process';
import { buildNatalBindingInput, stableSerialize } from './gm_integration/natal-evidence.js';

const EXTERNAL_PORT = Number(process.env.PORT || 3000);
const LEGACY_PORT = Number(process.env.GM_LEGACY_INTERNAL_PORT || 3101);
const GM_API_SECRET = String(process.env.GM_API_SECRET || '');
const DELIVERY_URL = String(
  process.env.GM_DELIVERY_RUNTIME_URL ||
  'https://grandmastrolog-delivery-runtime.vercel.app/api/e2e-natal'
);
const MAX_BODY_BYTES = 128 * 1024;
const TRUST_SOURCE = 'grandmastrolog-api';
const TRUST_VERSION = 'gm-trust-v1';

let legacyReady = false;
let shuttingDown = false;

function safeEqual(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function extractCredential(req) {
  const direct = String(req.headers['x-gm-secret'] || '').trim();
  const auth = String(req.headers.authorization || '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return direct || (match ? match[1].trim() : '');
}

function isAuthorized(req) {
  if (!GM_API_SECRET) return false;
  const credential = extractCredential(req);
  return Boolean(credential) && safeEqual(credential, GM_API_SECRET);
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) throw new Error('REQUEST_BODY_REQUIRED');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('REQUEST_JSON_INVALID');
  }
}

function bodyDigest(body) {
  return createHash('sha256').update(stableSerialize(body), 'utf8').digest('hex');
}

function trustHeaders(routeId, body) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = [
    TRUST_VERSION,
    'POST',
    routeId,
    TRUST_SOURCE,
    timestamp,
    bodyDigest(body)
  ].join('\n');
  const signature = createHmac('sha256', GM_API_SECRET).update(payload, 'utf8').digest('hex');
  return {
    authorization: `Bearer ${GM_API_SECRET}`,
    'content-type': 'application/json',
    'x-gm-evidence-source': TRUST_SOURCE,
    'x-gm-evidence-timestamp': timestamp,
    'x-gm-evidence-signature': signature
  };
}

function assertRequestShape(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('REQUEST_OBJECT_REQUIRED');
  const allowed = new Set(['request_id', 'birth']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw new Error(`REQUEST_UNKNOWN_FIELD:${key}`);
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'request_id')) throw new Error('REQUEST_ID_REQUIRED');
  if (!Object.prototype.hasOwnProperty.call(body, 'birth')) throw new Error('BIRTH_REQUIRED');
}

async function handleNatalDeliver(req, res) {
  if (!GM_API_SECRET) {
    return json(res, 503, { ok: false, code: 'TRUST_MATERIAL_UNAVAILABLE' });
  }
  if (!isAuthorized(req)) {
    return json(res, 401, { ok: false, code: 'UNAUTHORIZED' });
  }

  let body;
  try {
    body = await readJson(req);
    assertRequestShape(body);
  } catch (error) {
    return json(res, 400, { ok: false, code: String(error.message || 'INVALID_REQUEST') });
  }

  let evidence;
  try {
    evidence = buildNatalBindingInput(body);
  } catch (error) {
    return json(res, 422, {
      ok: false,
      code: 'ASTRO_SOURCE_FAIL',
      source: 'grandmastrolog-api',
      detail_code: String(error.message || 'ASTRO_SOURCE_UNKNOWN')
    });
  }

  const deliveryBody = { binding_input: evidence.binding_input };
  let upstream;
  try {
    upstream = await fetch(DELIVERY_URL, {
      method: 'POST',
      headers: trustHeaders('e2e-natal', deliveryBody),
      body: JSON.stringify(deliveryBody),
      signal: AbortSignal.timeout(Number(process.env.GM_DELIVERY_TIMEOUT_MS || 70000))
    });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError';
    return json(res, timeout ? 504 : 502, {
      ok: false,
      code: timeout ? 'DELIVERY_RUNTIME_TIMEOUT' : 'DELIVERY_RUNTIME_UNAVAILABLE'
    });
  }

  let result;
  try {
    result = await upstream.json();
  } catch {
    return json(res, 502, { ok: false, code: 'DELIVERY_RUNTIME_INVALID_RESPONSE' });
  }

  if (!upstream.ok || !result?.ok) {
    return json(res, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, {
      ok: false,
      code: String(result?.code || 'DELIVERY_RUNTIME_REJECTED')
    });
  }

  const delivery = result.delivery;
  if (
    result.delivery_validator_enabled !== true ||
    result.final_delivery_authorized !== true ||
    delivery?.delivery_state !== 'final_delivery_validated' ||
    typeof delivery?.canonical_markdown !== 'string' ||
    !delivery.canonical_markdown
  ) {
    return json(res, 502, { ok: false, code: 'FINAL_DELIVERY_INVARIANT_FAILED' });
  }

  return json(res, 200, {
    ok: true,
    request_id: body.request_id,
    contract_version: delivery.contract_version,
    delivery_state: delivery.delivery_state,
    delivery_validator_enabled: true,
    final_delivery_authorized: true,
    output: delivery.canonical_markdown,
    visual_attachments: delivery.visual_attachments,
    evidence_sha256: evidence.evidence_sha256,
    provenance: {
      railway: {
        source: 'grandmastrolog-api',
        engine: evidence.engine,
        commit: String(process.env.RAILWAY_GIT_COMMIT_SHA || process.env.RAILWAY_GIT_COMMIT || ''),
        deployment_id: String(process.env.RAILWAY_DEPLOYMENT_ID || '')
      },
      delivery_runtime: delivery.provenance,
      contract_sha256: delivery.contract_sha256,
      canonical_markdown_sha256: delivery.canonical_markdown_sha256,
      delivery_binding_sha256: delivery.delivery_binding_sha256
    }
  });
}

function proxyLegacy(req, res) {
  if (!legacyReady) {
    return json(res, 503, { ok: false, error: 'Legacy GrandMastrolog API is starting.' });
  }
  const headers = { ...req.headers, host: `127.0.0.1:${LEGACY_PORT}` };
  delete headers.connection;
  const proxy = http.request({
    hostname: '127.0.0.1',
    port: LEGACY_PORT,
    path: req.url,
    method: req.method,
    headers
  }, (upstream) => {
    const responseHeaders = { ...upstream.headers };
    delete responseHeaders.connection;
    res.writeHead(upstream.statusCode || 502, responseHeaders);
    upstream.pipe(res);
  });
  proxy.on('error', () => {
    if (!res.headersSent) json(res, 502, { ok: false, error: 'Legacy GrandMastrolog API unavailable.' });
    else res.destroy();
  });
  req.pipe(proxy);
}

async function pollLegacy() {
  for (let attempt = 0; attempt < 100 && !shuttingDown; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${LEGACY_PORT}/health`, {
        signal: AbortSignal.timeout(1000)
      });
      if (response.ok) {
        legacyReady = true;
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

const legacy = spawn(process.execPath, ['index.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(LEGACY_PORT) },
  stdio: ['ignore', 'inherit', 'inherit']
});
legacy.on('exit', (code, signal) => {
  legacyReady = false;
  if (!shuttingDown) console.error(`Legacy GrandMastrolog API exited: code=${code} signal=${signal}`);
});
pollLegacy().catch((error) => console.error('Legacy readiness probe failed:', error));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/integration/health') {
    return json(res, 200, {
      ok: true,
      service: 'grandmastrolog-api-integration',
      legacy_ready: legacyReady,
      evidence_engine: 'grandmastrolog_swisseph_natal_v1',
      delivery_runtime_url: DELIVERY_URL,
      railway_commit: String(process.env.RAILWAY_GIT_COMMIT_SHA || process.env.RAILWAY_GIT_COMMIT || ''),
      railway_deployment_id: String(process.env.RAILWAY_DEPLOYMENT_ID || '')
    });
  }
  if (req.method === 'POST' && url.pathname === '/natal/deliver') {
    return handleNatalDeliver(req, res);
  }
  return proxyLegacy(req, res);
});

server.listen(EXTERNAL_PORT, () => {
  console.log(`GrandMastrolog integration gateway running on port ${EXTERNAL_PORT}; legacy=${LEGACY_PORT}`);
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => process.exit(0));
  legacy.kill(signal);
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
