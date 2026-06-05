import { promises as fs } from 'node:fs';
import path from 'node:path';

export const SERVERS = ['CN', 'EN', 'JP', 'KR', 'TW'];

export function toPosix(value) {
  return value.split(path.sep).join('/');
}

export async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function listFiles(dir, suffix = '') {
  const out = [];
  async function walk(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (!suffix || full.endsWith(suffix)) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  out.sort();
  return out;
}

export async function listDirFiles(dir, suffix = '') {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && (!suffix || entry.name.endsWith(suffix)))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

export async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

export async function readJson(filePath) {
  return JSON.parse(await readText(filePath));
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function prepareOutDir(out, force) {
  if (await exists(out)) {
    if (!force) {
      throw new Error(`输出目录已存在，请换 --out 或加 --force: ${out}`);
    }
    await fs.rm(out, { recursive: true, force: true });
  }
  await fs.mkdir(out, { recursive: true });
}

export function numericSuffix(stem) {
  const match = /_(\d+)$/.exec(stem);
  return match ? Number(match[1]) : 0;
}

export function stemOf(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
