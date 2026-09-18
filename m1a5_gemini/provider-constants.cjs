'use strict';
const schemaSource = require('../delivery_runtime/lib/groq-binding');
module.exports = Object.freeze({
  model: 'gemini-2.5-flash',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta2/interactions',
  max_output_tokens: 8192,
  api: 'interactions'
});
