'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const validateNatal = require('../api/validate-natal');
const modelNatal = require('../api/model-natal');
const { bindingInput, validPayload } = require('./helpers');

function fakeResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: undefined,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    getHeader(name) { return headers.get(name.toLowerCase()); },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('validate-natal accepts canonical semantic payload without rendering', async () => {
  const res = fakeResponse();
  await validateNatal({ method:'POST', body:{ binding_input: bindingInput(), semantic_payload: validPayload() } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.contract.render_state, 'blocked_until_m1a3');
  assert.equal(JSON.stringify(res.body).includes('> ##'), false);
});

test('validate-natal rejects raw markup escape', async () => {
  const payload = validPayload(); payload.pre_seal_sections[0].body_paragraphs = ['> ## • PROFİLİN •'];
  const res = fakeResponse();
  await validateNatal({ method:'POST', body:{ binding_input: bindingInput(), semantic_payload: payload } }, res);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'MARKDOWN_ESCAPE');
});

test('validate-natal rejects method boundary', async () => {
  const res = fakeResponse();
  await validateNatal({ method:'GET' }, res);
  assert.equal(res.statusCode, 405);
});

test('model-natal fails closed when OpenAI secret is absent', async () => {
  const old = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const res = fakeResponse();
  await modelNatal({ method:'POST', body: bindingInput() }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'RUNTIME_SECRET_OR_MODEL_BINDING_UNAVAILABLE');
  if (old !== undefined) process.env.OPENAI_API_KEY = old;
});
