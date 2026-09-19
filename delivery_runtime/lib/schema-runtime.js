'use strict';

class SchemaValidationError extends Error {
  constructor(code, message, path = '$') {
    super(message);
    this.name = 'SchemaValidationError';
    this.code = code;
    this.path = path;
  }
}

function fail(code, message, path) {
  throw new SchemaValidationError(code, message, path);
}

function resolveRef(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) fail('SCHEMA_REF_UNSUPPORTED', 'Only local JSON Schema refs are supported.', '$');
  let node = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!node || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, key)) {
      fail('SCHEMA_REF_MISSING', `Missing schema ref ${ref}.`, '$');
    }
    node = node[key];
  }
  return node;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function validateNode(value, node, root, path) {
  if (node.$ref) return validateNode(value, resolveRef(root, node.$ref), root, path);

  if (Object.prototype.hasOwnProperty.call(node, 'const') && !Object.is(node.const, value)) {
    fail('SCHEMA_CONST', 'Value does not match schema const.', path);
  }

  if (node.enum && !node.enum.some((candidate) => Object.is(candidate, value))) {
    fail('SCHEMA_ENUM', 'Value is outside schema enum.', path);
  }

  if (node.type === 'object') {
    if (!isPlainObject(value)) fail('SCHEMA_TYPE', 'Expected object.', path);
    const properties = node.properties || {};
    const required = node.required || [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) fail('SCHEMA_REQUIRED', `Missing required field: ${key}`, `${path}.${key}`);
    }
    if (node.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) fail('SCHEMA_ADDITIONAL_PROPERTY', `Unknown field: ${key}`, `${path}.${key}`);
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) validateNode(value[key], child, root, `${path}.${key}`);
    }
    return;
  }

  if (node.type === 'array') {
    if (!Array.isArray(value)) fail('SCHEMA_TYPE', 'Expected array.', path);
    if (node.minItems !== undefined && value.length < node.minItems) fail('SCHEMA_ARRAY_SIZE', 'Array is below minItems.', path);
    if (node.maxItems !== undefined && value.length > node.maxItems) fail('SCHEMA_ARRAY_SIZE', 'Array exceeds maxItems.', path);
    if (node.uniqueItems === true) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) fail('SCHEMA_UNIQUE_ITEMS', 'Array contains duplicate items.', path);
        seen.add(key);
      }
    }
    if (node.items) value.forEach((item, i) => validateNode(item, node.items, root, `${path}[${i}]`));
    return;
  }

  if (node.type === 'string') {
    if (typeof value !== 'string') fail('SCHEMA_TYPE', 'Expected string.', path);
    if (node.minLength !== undefined && value.length < node.minLength) fail('SCHEMA_STRING_SIZE', 'String is below minLength.', path);
    if (node.maxLength !== undefined && value.length > node.maxLength) fail('SCHEMA_STRING_SIZE', 'String exceeds maxLength.', path);
    if (node.pattern !== undefined && !(new RegExp(node.pattern, 'u')).test(value)) fail('SCHEMA_PATTERN', 'String does not match schema pattern.', path);
    return;
  }

  if (node.type === 'boolean') {
    if (typeof value !== 'boolean') fail('SCHEMA_TYPE', 'Expected boolean.', path);
    return;
  }

  if (node.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('SCHEMA_TYPE', 'Expected finite number.', path);
    if (node.minimum !== undefined && value < node.minimum) fail('SCHEMA_NUMBER_RANGE', 'Number is below minimum.', path);
    if (node.maximum !== undefined && value > node.maximum) fail('SCHEMA_NUMBER_RANGE', 'Number exceeds maximum.', path);
    return;
  }

  if (node.type !== undefined) fail('SCHEMA_TYPE_UNSUPPORTED', `Unsupported schema type: ${node.type}`, path);
}

function validateAgainstSchema(value, schema) {
  validateNode(value, schema, schema, '$');
  return true;
}

module.exports = { SchemaValidationError, validateAgainstSchema };
