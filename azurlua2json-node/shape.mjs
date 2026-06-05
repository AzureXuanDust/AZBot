import path from 'node:path';
import { LUA_NIL, LuaTable } from './lua.mjs';
import { listFiles, readJson, writeJson, toPosix } from './util.mjs';

export class ShapeHints {
  constructor() {
    this.emptyArrays = new Set();
    this.topArrays = new Set();
    this.files = new Set();
    this.topObjectNumericKeys = new Set();
    this.topObjectIndexOnly = new Set();
    this.sharecfgNames = new Map();
    this.pathShapes = new Map();
  }

  static async load(templateRoot) {
    const hints = new ShapeHints();
    if (!templateRoot) return hints;
    let files;
    try {
      files = await listFiles(templateRoot, '.json');
    } catch {
      return hints;
    }
    for (const file of files) {
      let data;
      try {
        data = await readJson(file);
      } catch {
        continue;
      }
      const rel = toPosix(path.relative(templateRoot, file));
      hints.files.add(rel);
      hints.recordShapes(rel, data);
      if (Array.isArray(data)) {
        hints.topArrays.add(rel);
        if (data.length === 0) hints.emptyArrays.add(rel);
      } else if (data && typeof data === 'object') {
        if (Object.keys(data).some((key) => /^\d+$/.test(key))) hints.topObjectNumericKeys.add(rel);
        if (Object.keys(data).length > 0 && Object.keys(data).every((key) => key === 'all' || key.startsWith('get_id_list_by_'))) {
          hints.topObjectIndexOnly.add(rel);
        }
      }
      const parts = rel.split('/');
      if (parts.length === 3 && parts[1] === 'ShareCfg') {
        const stem = path.basename(parts[2], '.json');
        if (!hints.sharecfgNames.has(parts[0])) hints.sharecfgNames.set(parts[0], new Map());
        hints.sharecfgNames.get(parts[0]).set(stem.toLowerCase(), stem);
      }
    }
    return hints;
  }

  recordShapes(relPath, value, shapePath = '', fromArray = false) {
    const shape = Array.isArray(value) ? 'array' : value && typeof value === 'object' ? 'object' : null;
    if (shape) this.addPathShape(relPath, shapePath, shape, fromArray);
    if (Array.isArray(value)) {
      for (const child of value) {
        this.recordShapes(relPath, child, `${shapePath}/*`, true);
      }
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        this.recordShapes(relPath, child, `${shapePath}/${shapeKey(key)}`, false);
      }
    }
  }

  addPathShape(relPath, shapePath, shape, fromArray = false) {
    const keys = [`${relPath}#${shapePath}`];
    if (!fromArray) {
      const wildcard = wildcardShapePath(shapePath);
      if (wildcard !== shapePath) keys.push(`${relPath}#${wildcard}`);
    }
    for (const key of keys) {
      const old = this.pathShapes.get(key);
      this.pathShapes.set(key, old && old !== shape ? 'mixed' : shape);
    }
  }

  hasFile(relPath) {
    return this.files.size === 0 || this.files.has(relPath);
  }

  rootFiles() {
    return [...this.files].filter((rel) => !rel.includes('/')).sort();
  }

  serverFiles(server, prefix = '') {
    const base = prefix ? `${server}/${prefix.replace(/\/$/, '')}/` : `${server}/`;
    return [...this.files]
      .filter((rel) => rel.startsWith(base))
      .map((rel) => rel.slice(`${server}/`.length))
      .sort();
  }

  wantsArray(relPath) {
    return this.topArrays.has(relPath);
  }

  wantsEmptyArray(relPath) {
    return this.emptyArrays.has(relPath);
  }

  wantsTopObjectNumericKeys(relPath) {
    return this.topObjectNumericKeys.has(relPath);
  }

  wantsTopObjectIndexOnly(relPath) {
    return this.topObjectIndexOnly.has(relPath);
  }

  pathShape(relPath, shapePath) {
    const exact = this.pathShapes.get(`${relPath}#${shapePath}`);
    if (exact && exact !== 'mixed') return exact;
    const wildcard = this.pathShapes.get(`${relPath}#${wildcardShapePath(shapePath)}`);
    return wildcard && wildcard !== 'mixed' ? wildcard : null;
  }

  wantsPathArray(relPath, shapePath) {
    return this.pathShape(relPath, shapePath) === 'array';
  }

  wantsPathObject(relPath, shapePath) {
    return this.pathShape(relPath, shapePath) === 'object';
  }

  sharecfgOutputName(server, stem) {
    return this.sharecfgNames.get(server)?.get(stem.toLowerCase()) ?? stem;
  }
}

export function toJsonValue(value, relPath = null, hints = null, shapePath = '') {
  if (value === LUA_NIL) return undefined;
  if (relPath && hints && value === '') {
    if (hints.wantsPathArray(relPath, shapePath)) return [];
    if (hints.wantsPathObject(relPath, shapePath)) return {};
  }
  if (value instanceof LuaTable) return tableToJson(value, relPath, hints, shapePath);
  return value;
}

export function tableToJson(table, relPath = null, hints = null, shapePath = '') {
  if (table.entries.length === 0) return [];
  const explicit = new Map();
  let arrayIndex = 1;
  for (const [rawKey, value] of table.entries) {
    const key = rawKey === null ? arrayIndex++ : rawKey;
    if (value !== LUA_NIL) explicit.set(key, value);
  }
  const keys = [...explicit.keys()];
  if (keys.length === 0) return [];
  if (relPath && hints && hints.wantsPathArray(relPath, shapePath) && keys.length === 1 && keys[0] === 'effect_list') {
    return toJsonValue(explicit.get('effect_list'), relPath, hints, shapePath);
  }
  if (keys.length > 0 && keys.every((key) => Number.isInteger(key) && key >= 1)) {
    const sorted = [...keys].sort((a, b) => a - b);
    const maxKey = sorted[sorted.length - 1];
    let shouldBeArray = sorted.length === maxKey && sorted.every((key, index) => key === index + 1);
    if (relPath && hints) {
      if (!shapePath) shouldBeArray = shouldBeArray && hints.wantsArray(relPath);
      if (hints.wantsPathObject(relPath, shapePath)) shouldBeArray = false;
    }
    if (shouldBeArray) {
      return Array.from({ length: maxKey }, (_, index) => toJsonValue(explicit.get(index + 1), relPath, hints, `${shapePath}/*`));
    }
  }
  const result = {};
  for (const key of keys.sort(jsonKeySort)) {
    result[String(key)] = toJsonValue(explicit.get(key), relPath, hints, `${shapePath}/${shapeKey(key)}`);
  }
  return result;
}

export async function dumpJson(filePath, value) {
  await writeJson(filePath, value);
}

export function shapeKey(key) {
  return String(key);
}

function wildcardShapePath(shapePath) {
  return shapePath
    .split('/')
    .map((part) => (/^-?\d+$/.test(part) ? '*' : part))
    .join('/');
}

function jsonKeySort(a, b) {
  const ak = sortKey(a);
  const bk = sortKey(b);
  if (ak[0] !== bk[0]) return ak[0] - bk[0];
  if (ak[1] < bk[1]) return -1;
  if (ak[1] > bk[1]) return 1;
  return 0;
}

function sortKey(key) {
  if (Number.isInteger(key)) return [0, key];
  if (typeof key === 'string' && /^-?\d+$/.test(key)) return [0, Number.parseInt(key, 10)];
  return [1, String(key)];
}
