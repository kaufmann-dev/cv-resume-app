import { z } from 'zod';

// JSON Patch (RFC 6902) over the document `{ sections: [...] }`.
// Paths are JSON Pointers relative to the document root, e.g. `/sections/0/title/en`.
export const patchOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), path: z.string().min(1), value: z.unknown() }).strict(),
  z.object({ op: z.literal('remove'), path: z.string().min(1) }).strict(),
  z.object({ op: z.literal('replace'), path: z.string().min(1), value: z.unknown() }).strict(),
  z.object({ op: z.literal('move'), from: z.string().min(1), path: z.string().min(1) }).strict(),
  z.object({ op: z.literal('copy'), from: z.string().min(1), path: z.string().min(1) }).strict(),
  z.object({ op: z.literal('test'), path: z.string().min(1), value: z.unknown() }).strict()
]);

function parsePointer(pointer) {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error(`invalid pointer "${pointer}": must start with "/"`);
  return pointer.split('/').slice(1).map(segment => {
    if (/~(?![01])/.test(segment)) throw new Error(`invalid pointer "${pointer}": bad escape in "${segment}"`);
    return segment.replace(/~1/g, '/').replace(/~0/g, '~');
  });
}

function arrayIndex(key, length, allowEnd, context) {
  if (key === '-') {
    if (!allowEnd) throw new Error(`${context}: "-" is only valid for "add"`);
    return length;
  }
  if (!/^(0|[1-9][0-9]*)$/.test(key)) throw new Error(`${context}: "${key}" is not a valid array index`);
  const index = Number(key);
  if (index > length || (!allowEnd && index === length)) {
    throw new Error(`${context}: index ${index} is out of bounds (length ${length})`);
  }
  return index;
}

function resolve(document, segments, context) {
  let node = document;
  for (const segment of segments) {
    if (Array.isArray(node)) node = node[arrayIndex(segment, node.length, false, context)];
    else if (node && typeof node === 'object') {
      if (!Object.hasOwn(node, segment)) throw new Error(`${context}: "${segment}" does not exist`);
      node = node[segment];
    } else throw new Error(`${context}: cannot descend into a non-object`);
  }
  return node;
}

function deepEqual(left, right) {
  if (left === right) return true;
  if (typeof left !== typeof right || !left || !right || typeof left !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every(key => Object.hasOwn(right, key) && deepEqual(left[key], right[key]));
}

export function applyJsonPatch(document, operations) {
  const patched = structuredClone(document);
  const changes = [];
  operations.forEach((operation, position) => {
    const label = `operation #${position + 1} (${operation.op} "${operation.path ?? operation.from}")`;
    if (operation.op === 'test') {
      const actual = resolve(patched, parsePointer(operation.path), label);
      if (!deepEqual(actual, operation.value)) {
        throw new Error(`${label}: value does not match (test failed)`);
      }
      changes.push({ op: 'test', path: operation.path });
      return;
    }
    const value = operation.op === 'move' || operation.op === 'copy'
      ? structuredClone(resolve(patched, parsePointer(operation.from), label))
      : structuredClone(operation.value);
    if (operation.op === 'move') removeAt(patched, parsePointer(operation.from), label);
    if (operation.op === 'remove') {
      changes.push({ op: 'remove', path: operation.path, before: removeAt(patched, parsePointer(operation.path), label) });
    } else if (operation.op === 'replace') {
      changes.push({ op: 'replace', path: operation.path, before: replaceAt(patched, parsePointer(operation.path), value, label), after: value });
    } else {
      insertAt(patched, parsePointer(operation.path), value, label);
      changes.push({ ...(operation.from ? { op: operation.op, from: operation.from } : { op: 'add' }), path: operation.path, after: value });
    }
  });
  return { patched, changes };
}

function parentOf(document, segments, label) {
  if (!segments.length) throw new Error(`${label}: this operation needs a path below the document root`);
  return { parent: resolve(document, segments.slice(0, -1), label), key: segments.at(-1) };
}

function removeAt(document, segments, label) {
  if (!segments.length) throw new Error(`${label}: cannot remove the document root`);
  const { parent, key } = parentOf(document, segments, label);
  if (Array.isArray(parent)) return parent.splice(arrayIndex(key, parent.length, false, label), 1)[0];
  if (parent && typeof parent === 'object') {
    if (!Object.hasOwn(parent, key)) throw new Error(`${label}: "${key}" does not exist`);
    const removed = parent[key];
    delete parent[key];
    return removed;
  }
  throw new Error(`${label}: cannot remove from a non-object`);
}

function replaceAt(document, segments, value, label) {
  if (!segments.length) throw new Error(`${label}: use replace_document to replace the whole document`);
  const { parent, key } = parentOf(document, segments, label);
  if (Array.isArray(parent)) {
    const index = arrayIndex(key, parent.length, false, label);
    const before = parent[index];
    parent[index] = value;
    return before;
  }
  if (parent && typeof parent === 'object') {
    if (!Object.hasOwn(parent, key)) throw new Error(`${label}: "${key}" does not exist`);
    const before = parent[key];
    parent[key] = value;
    return before;
  }
  throw new Error(`${label}: cannot replace inside a non-object`);
}

function insertAt(document, segments, value, label) {
  if (!segments.length) throw new Error(`${label}: use replace_document to replace the whole document`);
  const { parent, key } = parentOf(document, segments, label);
  if (Array.isArray(parent)) parent.splice(arrayIndex(key, parent.length, true, label), 0, value);
  else if (parent && typeof parent === 'object') parent[key] = value;
  else throw new Error(`${label}: cannot insert into a non-object`);
}
