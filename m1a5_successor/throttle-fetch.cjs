'use strict';

const originalFetch = globalThis.fetch;
let lastNatalStart = 0;
const MIN_START_GAP_MS = 70000;

if (typeof originalFetch !== 'function') {
  throw new Error('GLOBAL_FETCH_UNAVAILABLE');
}

globalThis.fetch = async function throttledFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : String(input?.url || input || '');
  const method = String(init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
  const isNatalDelivery = method === 'POST' && /\/natal\/deliver(?:$|\?)/.test(url);

  if (isNatalDelivery) {
    const now = Date.now();
    const waitMs = Math.max(0, MIN_START_GAP_MS - (now - lastNatalStart));
    if (waitMs > 0) {
      console.log('M1A5_SUCCESSOR_THROTTLE_WAIT_MS=' + waitMs);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastNatalStart = Date.now();
    console.log('M1A5_SUCCESSOR_NATAL_CALL_START=' + new Date(lastNatalStart).toISOString());
  }

  return originalFetch(input, init);
};
