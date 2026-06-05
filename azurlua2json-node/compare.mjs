import path from 'node:path';
import { promises as fs } from 'node:fs';
import { ShapeHints } from './shape.mjs';
import { listFiles, readJson, toPosix } from './util.mjs';

export async function compareShapes(templateRoot, outRoot, servers) {
  const selectedServers = new Set(Array.isArray(servers) ? servers : [servers]);
  const templateFiles = await jsonFilesByRel(templateRoot, selectedServers);
  const outFiles = await jsonFilesByRel(outRoot, selectedServers);
  const hints = await ShapeHints.load(templateRoot);
  const messages = [];

  for (const rel of [...templateFiles.keys()].filter((rel) => !outFiles.has(rel)).sort().slice(0, 200)) {
    messages.push(`缺失文件: ${rel}`);
  }
  for (const rel of [...outFiles.keys()].filter((rel) => !templateFiles.has(rel)).sort().slice(0, 200)) {
    messages.push(`新增文件: ${rel}`);
  }

  const common = [...templateFiles.keys()].filter((rel) => outFiles.has(rel)).sort();
  for (const rel of common) {
    let templateData;
    let outData;
    try {
      templateData = await readJson(templateFiles.get(rel));
      outData = await readJson(outFiles.get(rel));
    } catch (error) {
      messages.push(`读取失败: ${rel}: ${error.message ?? error}`);
      continue;
    }
    const templateShape = shapeName(templateData);
    const outShape = shapeName(outData);
    if (templateShape !== outShape) {
      messages.push(`顶层结构不同: ${rel}: template=${templateShape} out=${outShape}`);
      continue;
    }
    if (templateData && outData && !Array.isArray(templateData) && !Array.isArray(outData) && typeof templateData === 'object' && typeof outData === 'object') {
      const templateNumeric = Object.keys(templateData).some((key) => /^\d+$/.test(key));
      const outNumeric = Object.keys(outData).some((key) => /^\d+$/.test(key));
      if (templateNumeric !== outNumeric) {
        messages.push(`数字 key 形态不同: ${rel}: template=${templateNumeric} out=${outNumeric}`);
      }
    }
    for (const message of findEmptyStringShapeMismatches(rel, outData, hints).slice(0, 50)) messages.push(message);
  }
  return messages;
}

async function jsonFilesByRel(root, selectedServers) {
  const out = new Map();
  for (const file of await listFiles(root, '.json')) {
    const rel = toPosix(path.relative(root, file));
    if (shouldCompare(rel, selectedServers)) out.set(rel, file);
  }
  return out;
}

function shouldCompare(rel, selectedServers) {
  const parts = rel.split('/');
  if (parts.length === 1) return true;
  if (/^[A-Z]{2}$/.test(parts[0])) return selectedServers.has(parts[0]);
  return true;
}

export async function writeChangeReport(templateRoot, outRoot, servers, reportPath = path.join(outRoot, 'change_report.txt')) {
  const selectedServers = new Set(Array.isArray(servers) ? servers : [servers]);
  const templateFiles = await jsonFilesByRel(templateRoot, selectedServers);
  const outFiles = await jsonFilesByRel(outRoot, selectedServers);
  const changed = [];
  const missing = [];
  const added = [];

  for (const rel of [...templateFiles.keys()].sort()) {
    if (!outFiles.has(rel)) {
      missing.push(rel);
      continue;
    }
    const templateText = await fs.readFile(templateFiles.get(rel), 'utf8');
    const outText = await fs.readFile(outFiles.get(rel), 'utf8');
    if (templateText !== outText) changed.push(rel);
  }
  for (const rel of [...outFiles.keys()].sort()) {
    if (!templateFiles.has(rel)) added.push(rel);
  }

  const lines = [
    `生成时间: ${new Date().toISOString()}`,
    `模板目录: ${templateRoot}`,
    `输出目录: ${outRoot}`,
    `区服: ${[...selectedServers].join(', ')}`,
    '',
    `内容变更文件数: ${changed.length}`,
    ...changed.map((rel) => `  M ${rel}`),
    '',
    `缺失文件数: ${missing.length}`,
    ...missing.map((rel) => `  D ${rel}`),
    '',
    `新增文件数: ${added.length}`,
    ...added.map((rel) => `  A ${rel}`),
    '',
  ];
  await fs.writeFile(reportPath, lines.join('\n'), 'utf8');
  return { changed, missing, added, reportPath };
}

function findEmptyStringShapeMismatches(rel, value, hints) {
  const messages = [];
  visit(value, '');
  return messages;

  function visit(current, shapePath) {
    if (current === '') {
      const shape = hints.pathShape(rel, shapePath);
      if (shape === 'array' || shape === 'object') {
        messages.push(`空字符串字段类型风险: ${rel}${shapePath}: template=${shape} out=string`);
      }
      return;
    }
    if (Array.isArray(current)) {
      for (const child of current) visit(child, `${shapePath}/*`);
      return;
    }
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) visit(child, `${shapePath}/${key}`);
  }
}

function shapeName(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}
