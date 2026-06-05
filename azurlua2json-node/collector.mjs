import path from 'node:path';
import { availableParallelism } from 'node:os';
import { promises as fs } from 'node:fs';
import { dumpJson, shapeKey, toJsonValue } from './shape.mjs';
import { exists, listDirFiles, mapLimit, numericSuffix, readText, stemOf } from './util.mjs';
import { LuaParseError, LuaTable, extractReturnTable, iterAssignments, iterRootTableAssignments } from './lua.mjs';

export class CollectError extends Error {}

export class Collector {
  constructor(luaRoot, templateRoot, outRoot, hints) {
    this.luaRoot = luaRoot;
    this.templateRoot = templateRoot;
    this.outRoot = outRoot;
    this.hints = hints;
    this.warnings = [];
    this.concurrency = Math.max(2, Math.min(availableParallelism?.() ?? 4, 8));
  }

  async collectServer(server, samples = false) {
    const luaServer = path.join(this.luaRoot, server);
    if (!(await exists(luaServer))) throw new CollectError(`找不到 Lua 区服目录: ${luaServer}`);
    await this.writeRootPlaceholders(server);
    if (samples) {
      await this.collectSharecfgFile(server, path.join(luaServer, 'sharecfg', 'activity_banner.lua'));
      await this.collectSharecfgdataGroup(server, 'weapon_property');
      await this.collectGamecfgDir(server, 'buff');
      await this.collectGamecfgDir(server, 'skill');
      return;
    }
    await this.collectRequiredSharecfgFiles(server);
    await this.collectSharecfg(server);
    await this.collectSharecfgdata(server);
    const gameFiles = this.hints.serverFiles(server, 'GameCfg');
    const gameNames = gameFiles.length > 0
      ? gameFiles.map((rel) => path.basename(rel, '.json'))
      : ['buff', 'skill', 'card', 'dorm', 'dungeon', 'story', 'storyjp'];
    for (const name of gameNames) {
      await this.collectGamecfgDir(server, name);
    }
  }

  async collectRequiredSharecfgFiles(server) {
    const src = path.join(this.luaRoot, server, 'sharecfg');
    const required = ['ship_data_create_exchange', 'ship_data_create_material'];
    for (const stem of required) {
      const file = path.join(src, `${stem}.lua`);
      if (await exists(file)) await this.collectSharecfgFile(server, file);
    }
  }

  rel(server, ...parts) {
    return [server, ...parts].join('/');
  }

  async writeRootPlaceholders(server) {
    const writes = [];
    for (const name of ['buffCfg.json', 'skillCfg.json']) {
      const rel = this.rel(server, name);
      if (!this.hints.hasFile(rel)) continue;
      writes.push(dumpJson(path.join(this.outRoot, rel), this.hints.wantsArray(rel) ? [] : {}));
    }
    await Promise.all(writes);
  }

  async collectSharecfg(server) {
    const src = path.join(this.luaRoot, server, 'sharecfg');
    if (!(await exists(src))) return;
    const templateFiles = this.hints.serverFiles(server, 'ShareCfg');
    if (templateFiles.length > 0) {
      const luaFiles = await filesByLowerStem(src);
      const targets = templateFiles
        .filter((rel) => rel.startsWith('ShareCfg/'))
        .map((rel) => path.basename(rel, '.json'))
        .map((stem) => luaFiles.get(stem.toLowerCase()) ?? path.join(src, `${stem}.lua`));
      await mapLimit(targets, this.concurrency, (file) => this.collectSharecfgFile(server, file));
      return;
    }
    const files = await listDirFiles(src, '.lua');
    const kept = [];
    for (const file of files) {
      if (!(await this.isSharecfgSplitFile(server, src, file))) kept.push(file);
    }
    await mapLimit(kept, this.concurrency, (file) => this.collectSharecfgFile(server, file));
  }

  async collectSharecfgFile(server, filePath) {
    const stem = stemOf(filePath);
    const outputName = this.hints.sharecfgOutputName(server, stem);
    const rel = this.rel(server, 'ShareCfg', `${outputName}.json`);
    if (!this.hints.hasFile(rel) && !this.isRequiredRootDependency(rel)) return;
    if (!(await exists(filePath))) {
      this.warnings.push(`跳过缺失文件: ${filePath}`);
      return;
    }
    const text = await readText(filePath);
    const data = {};
    let directValue = null;
    const isStream = text.includes('__stream__ = true');
    const tableNames = new Set([stem, outputName]);
    let assignments;
    try {
      assignments = await iterAssignments(filePath);
    } catch (error) {
      if (error instanceof LuaParseError) this.warnings.push(`解析失败 ${filePath}: ${error.message}`);
      else this.warnings.push(`解析失败 ${filePath}: ${error}`);
      return;
    }
    for (const [lhs, rhs] of assignments) {
      if (lhs.length === 2 && lhs[0] === 'pg') {
        tableNames.add(String(lhs[1]));
        directValue = rhs;
      } else if (lhs.length >= 3 && lhs[0] === 'pg' && tableNames.has(String(lhs[1])) && typeof lhs[2] === 'string') {
        const key = lhs[2];
        if (key === '__stream__' && rhs === true) continue;
        if (key.startsWith('__')) continue;
        this.setData(data, key, rhs, rel);
      } else if (lhs.length === 3 && lhs[0] === 'pg' && lhs[1] === 'base' && tableNames.has(String(lhs[2]))) {
        this.mergeTableEntries(data, rhs, rel);
      } else if (lhs.length >= 4 && lhs[0] === 'pg' && lhs[1] === 'base' && tableNames.has(String(lhs[2]))) {
        this.setData(data, String(lhs[3]), rhs, rel);
      } else if (lhs.length === 4 && lhs[0] === '_G' && lhs[1] === 'pg' && lhs[2] === 'base' && tableNames.has(String(lhs[3]))) {
        this.mergeTableEntries(data, rhs, rel);
      } else if (lhs.length >= 5 && lhs[0] === '_G' && lhs[1] === 'pg' && lhs[2] === 'base' && tableNames.has(String(lhs[3]))) {
        this.setData(data, String(lhs[4]), rhs, rel);
      }
    }
    const wordData = await this.collectWordSublist(path.dirname(filePath), stem);
    const streamData = isStream ? await this.collectSharecfgdataMapping(server, stem) : null;
    if (wordData) {
      await dumpJson(path.join(this.outRoot, rel), this.coerceTopLevel(rel, wordData));
    } else if (streamData) {
      await this.dumpMapping(path.join(this.outRoot, rel), rel, streamData);
    } else if (Object.keys(data).length > 0) {
      await this.dumpMapping(path.join(this.outRoot, rel), rel, data);
    } else if (directValue !== null) {
      await dumpJson(path.join(this.outRoot, rel), this.coerceTopLevel(rel, toJsonValue(directValue, rel, this.hints)));
    } else {
      try {
        const returned = await extractReturnTable(filePath);
        await dumpJson(path.join(this.outRoot, rel), this.coerceTopLevel(rel, toJsonValue(returned, rel, this.hints)));
      } catch {
        this.warnings.push(`未收集到 ShareCfg 数据: ${filePath}`);
      }
    }
  }

  isRequiredRootDependency(rel) {
    return rel.endsWith('ShareCfg/ship_data_create_exchange.json') || rel.endsWith('ShareCfg/ship_data_create_material.json');
  }

  async collectWordSublist(sharecfgDir, stem) {
    if (stem !== 'word_template' && stem !== 'word_legal_template') return null;
    const subdir = path.join(sharecfgDir, stem === 'word_template' ? 'word_sublist' : 'word_legal_sublist');
    if (!(await exists(subdir))) return null;
    const files = (await listDirFiles(subdir, '.lua'))
      .filter((file) => stemOf(file).startsWith(`${stem}_`))
      .sort((a, b) => numericSuffix(stemOf(a)) - numericSuffix(stemOf(b)));
    const merged = {};
    for (const file of files) {
      let assignments;
      try {
        assignments = await iterRootTableAssignments(file, 'uv0');
      } catch (error) {
        this.warnings.push(`解析失败 ${file}: ${error.message ?? error}`);
        continue;
      }
      for (const [lhs, rhs] of assignments) {
        let cursor = merged;
        for (const part of lhs.slice(1, -1)) {
          const key = String(part);
          cursor[key] ??= {};
          cursor = cursor[key];
        }
        if (lhs.length >= 2) {
          const value = toJsonValue(rhs, null, this.hints);
          if (value !== undefined) cursor[String(lhs[lhs.length - 1])] = value;
        }
      }
    }
    return Object.keys(merged).length > 0 ? merged : null;
  }

  async isSharecfgSplitFile(server, sharecfgDir, filePath) {
    const stem = stemOf(filePath);
    const match = /_(\d+)$/.exec(stem);
    if (!match) return false;
    const rel = this.rel(server, 'ShareCfg', `${this.hints.sharecfgOutputName(server, stem)}.json`);
    if (this.hints.hasFile(rel)) return false;
    const baseStem = stem.slice(0, -match[0].length);
    return exists(path.join(sharecfgDir, `${baseStem}.lua`));
  }

  mergeTableEntries(data, table, rel = null) {
    if (!(table instanceof LuaTable)) return;
    let arrayIndex = 1;
    for (const [rawKey, value] of table.entries) {
      const key = rawKey === null ? arrayIndex++ : rawKey;
      this.setData(data, String(key), value, rel);
    }
  }

  setData(data, key, rawValue, rel = null) {
    const value = toJsonValue(rawValue, rel, this.hints, `/${shapeKey(key)}`);
    if (value !== undefined) data[key] = value;
  }

  async collectSharecfgdataMapping(server, group) {
    const src = path.join(this.luaRoot, server, 'sharecfgdata');
    if (!(await exists(src))) return null;
    const files = (await listDirFiles(src, '.lua')).filter((file) => stemOf(file) === group || new RegExp(`^${escapeRegExp(group)}_\\d+$`).test(stemOf(file)));
    if (files.length === 0) return null;
    const rel = this.rel(server, 'ShareCfg', `${this.hints.sharecfgOutputName(server, group)}.json`);
    const data = {};
    for (const file of files.sort()) {
      let assignments;
      try {
        assignments = await iterAssignments(file);
      } catch (error) {
        this.warnings.push(`解析失败 ${file}: ${error.message ?? error}`);
        continue;
      }
      for (const [lhs, rhs] of assignments) {
        if (lhs.length >= 5 && arrayStartsWith(lhs, ['_G', 'pg', 'base', group])) {
          this.setData(data, String(lhs[4]), rhs, rel);
        } else if (lhs.length === 4 && arrayStartsWith(lhs, ['pg', 'base', group])) {
          this.setData(data, String(lhs[3]), rhs, rel);
        }
      }
    }
    return Object.keys(data).length > 0 ? data : null;
  }

  async dumpMapping(filePath, rel, data) {
    await dumpJson(filePath, this.coerceTopLevel(rel, data));
  }

  coerceTopLevel(rel, data) {
    if (this.hints.wantsArray(rel)) {
      if (Array.isArray(data)) return data;
      if (!data || typeof data !== 'object') return [];
      return mappingToEntityArray(this.stripTopLevelIndexes(data));
    }
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return data;
    if (this.hints.wantsTopObjectIndexOnly(rel)) return sortObjectByEntityKey(this.keepTopLevelIndexes(data));
    return sortObjectByEntityKey(this.stripTopLevelIndexes(data));
  }

  stripTopLevelIndexes(data) {
    const stripped = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === 'all' || key.startsWith('get_id_list_by_')) continue;
      stripped[key] = value;
    }
    return stripped;
  }

  keepTopLevelIndexes(data) {
    const kept = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === 'all' || key.startsWith('get_id_list_by_')) kept[key] = value;
    }
    return kept;
  }

  async collectSharecfgdata(server) {
    const src = path.join(this.luaRoot, server, 'sharecfgdata');
    if (!(await exists(src))) return;
    const templateFiles = this.hints.serverFiles(server, 'sharecfgdata');
    if (templateFiles.length > 0) {
      const groups = templateFiles
        .filter((rel) => rel.startsWith('sharecfgdata/'))
        .map((rel) => path.basename(rel, '.json'));
      await mapLimit(groups, this.concurrency, (group) => this.collectSharecfgdataGroup(server, group));
      return;
    }
    const files = await listDirFiles(src, '.lua');
    const groups = [...new Set(files.map((file) => groupName(stemOf(file))))].sort();
    await mapLimit(groups, this.concurrency, (group) => this.collectSharecfgdataGroup(server, group));
  }

  async collectSharecfgdataGroup(server, group) {
    const rel = this.rel(server, 'sharecfgdata', `${group}.json`);
    if (!this.hints.hasFile(rel)) return;
    const src = path.join(this.luaRoot, server, 'sharecfgdata');
    const files = (await listDirFiles(src, '.lua')).filter((file) => stemOf(file) === group || new RegExp(`^${escapeRegExp(group)}_\\d+$`).test(stemOf(file))).sort();
    if (files.length === 0) {
      this.warnings.push(`跳过缺失 sharecfgdata 分组: ${server}/${group}`);
      return;
    }
    const data = {};
    let topArray = null;
    for (const file of files) {
      let assignments;
      try {
        assignments = await iterAssignments(file);
      } catch (error) {
        this.warnings.push(`解析失败 ${file}: ${error.message ?? error}`);
        continue;
      }
      for (const [lhs, rhs] of assignments) {
        if (lhs.length >= 5 && arrayStartsWith(lhs, ['_G', 'pg', 'base', group])) {
          this.setData(data, String(lhs[4]), rhs, rel);
        } else if (lhs.length >= 4 && arrayStartsWith(lhs, ['pg', 'base', group])) {
          this.setData(data, String(lhs[3]), rhs, rel);
        } else if (lhs.length === 3 && arrayStartsWith(lhs, ['pg', group])) {
          this.setData(data, String(lhs[2]), rhs, rel);
        }
      }
      if (assignments.length === 0) {
        try {
          topArray = toJsonValue(await extractReturnTable(file), rel, this.hints);
        } catch {
        }
      }
    }
    if (Object.keys(data).length > 0) await this.dumpMapping(path.join(this.outRoot, rel), rel, data);
    else if (topArray !== null) await dumpJson(path.join(this.outRoot, rel), this.coerceTopLevel(rel, topArray));
    else this.warnings.push(`未收集到 sharecfgdata 数据: ${server}/${group}`);
  }

  async collectGamecfgDir(server, name) {
    const outName = name === 'storyjp' ? 'storyjp' : name;
    const rel = this.rel(server, 'GameCfg', `${outName}.json`);
    if (!this.hints.hasFile(rel)) return;
    const src = path.join(this.luaRoot, server, 'gamecfg', name);
    if (!(await exists(src))) return;
    const files = await listDirFiles(src, '.lua');
    const pairs = await mapLimit(files, this.concurrency, async (file) => {
      const stat = await fs.stat(file);
      if (stat.size === 0) return null;
      try {
        const value = await extractReturnTable(file);
        const key = stemOf(file);
        return [key, toJsonValue(value, rel, this.hints, `/${shapeKey(key)}`)];
      } catch (error) {
        this.warnings.push(`解析失败 ${file}: ${error.message ?? error}`);
        return null;
      }
    });
    const data = {};
    for (const pair of pairs) {
      if (pair) data[pair[0]] = pair[1];
    }
    if (Object.keys(data).length > 0) await this.dumpMapping(path.join(this.outRoot, rel), rel, data);
  }
}

async function filesByLowerStem(dir) {
  const out = new Map();
  for (const file of await listDirFiles(dir, '.lua')) out.set(stemOf(file).toLowerCase(), file);
  return out;
}

function mappingToEntityArray(data) {
  return Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => jsonKeySort(a, b))
    .map(([, value]) => value);
}

function sortObjectByEntityKey(data) {
  const out = {};
  for (const key of Object.keys(data).sort(jsonKeySort)) out[key] = data[key];
  return out;
}

function groupName(stem) {
  return stem.replace(/_\d+$/, '');
}

function arrayStartsWith(value, prefix) {
  return prefix.every((item, index) => value[index] === item);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function jsonKeySort(a, b) {
  const ai = /^\d+$/.test(a) ? Number.parseInt(a, 10) : null;
  const bi = /^\d+$/.test(b) ? Number.parseInt(b, 10) : null;
  if (ai !== null && bi !== null) return ai - bi;
  if (ai !== null) return -1;
  if (bi !== null) return 1;
  return a.localeCompare(b);
}
