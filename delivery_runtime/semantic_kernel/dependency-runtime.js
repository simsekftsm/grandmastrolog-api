'use strict';

const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.resolve(__dirname, relative));
}

function localSemanticDependencies() {
  const kernelBundle = Buffer.concat([
    read('./stable.js'),
    read('./pass-contracts.js'),
    read('./kernel.js'),
    read('../lib/schema-runtime.js'),
    read('./doctrine/natal-core.v1.json')
  ]);
  return {
    kernel_source: kernelBundle,
    astroir_schema: fs.readFileSync(path.resolve(__dirname, '../contracts/gm-astroir-v1.schema.json'))
  };
}

module.exports = { localSemanticDependencies };
