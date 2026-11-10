export class CanonicalJsonError extends TypeError {
  constructor(message, path = '$') {
    super(`${message} at ${path}`);
    this.name = 'CanonicalJsonError';
    this.path = path;
  }
}

function serialize(value, path, seen) {
  if (value === null) return 'null';

  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError('Non-finite numbers are not valid JSON', path);
    }
    return JSON.stringify(value);
  }

  if (typeof value !== 'object') {
    throw new CanonicalJsonError(`Unsupported JSON value type ${typeof value}`, path);
  }

  if (seen.has(value)) {
    throw new CanonicalJsonError('Circular references are not valid JSON', path);
  }
  seen.add(value);

  let result;
  if (Array.isArray(value)) {
    const items = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new CanonicalJsonError('Sparse arrays are not valid canonical JSON', `${path}[${index}]`);
      }
      items.push(serialize(value[index], `${path}[${index}]`, seen));
    }
    result = `[${items.join(',')}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalJsonError('Only plain objects are supported', path);
    }

    const keys = Object.keys(value).sort();
    const pairs = keys.map((key) => {
      const item = value[key];
      if (item === undefined) {
        throw new CanonicalJsonError('Undefined object properties are not valid JSON', `${path}.${key}`);
      }
      return `${JSON.stringify(key)}:${serialize(item, `${path}.${key}`, seen)}`;
    });
    result = `{${pairs.join(',')}}`;
  }

  seen.delete(value);
  return result;
}

/**
 * RFC 8785 / JSON Canonicalization Scheme for ordinary JSON data.
 * JavaScript's JSON primitive serialization and UTF-16 key ordering match JCS.
 */
export function canonicalize(value) {
  return serialize(value, '$', new Set());
}
