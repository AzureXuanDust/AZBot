import path from 'node:path';
import { promises as fs } from 'node:fs';
import { exists, listFiles, readJson, toPosix, writeJson } from './util.mjs';

const BELFAST_ARRAY_FIELD_NORMALIZERS = new Map([
  ['ShareCfg/guildset.json', ['key_args']],
  ['ShareCfg/furniture_data_template.json', ['size']],
  ['sharecfgdata/item_virtual_data_statistics.json', ['display_icon']],
  ['ShareCfg/island_shop_template.json', ['goods_id']],
  ['sharecfgdata/island_shop_template.json', ['goods_id']],
  ['ShareCfg/island_shop_normal_template.json', ['refresh_player']],
  ['sharecfgdata/island_shop_normal_template.json', ['refresh_player']],
]);

const BELFAST_SCALAR_ARRAY_FIELD_NORMALIZERS = new Map([
  ['ShareCfg/guild_contribution_template.json', ['consume']],
]);

const BELFAST_EMPTY_OBJECT_FILES = [
  'ShareCfg/drop_data_template.json',
  'sharecfgdata/drop_data_template.json',
  'ShareCfg/island_fish_bait.json',
  'sharecfgdata/island_fish_bait.json',
  'ShareCfg/island_npc.json',
  'sharecfgdata/island_npc.json',
  'ShareCfg/lover_letter_text.json',
];

const BELFAST_MANAGED_ROOT_FILES = new Set([
  'build_pools.json',
  'build_times.json',
  'requisition_ships.json',
  'versions.json',
  'activity_build_pool_overrides.json',
]);

const BELFAST_SHARECFGDATA_MIRRORS = [
  'drop_data_restore.json',
  'friendly_data_template.json',
  'gameset.json',
  'island_achievement.json',
  'island_action_feedback.json',
  'island_buff_template.json',
  'island_card_diy.json',
  'island_card_label.json',
  'island_chara_level.json',
  'island_chara_skill.json',
  'island_chara_template.json',
  'island_collect_fragment.json',
  'island_collection.json',
  'island_collection_reward.json',
  'island_dress_colordiff_template.json',
  'island_exchange_template.json',
  'island_fish.json',
  'island_fish_point.json',
  'island_formula.json',
  'island_illustrated_guide.json',
  'island_item_data_template.json',
  'island_level.json',
  'island_map.json',
  'island_production_slot.json',
  'island_season.json',
  'island_set.json',
  'island_shop_goods.json',
  'island_shop_normal_template.json',
  'island_shop_template.json',
  'island_skin_colordiff_template.json',
  'island_skin_template.json',
  'island_storage_level.json',
  'island_strollnpc.json',
  'island_task.json',
  'island_task_target.json',
  'island_technology_template.json',
  'island_wild_gather.json',
  'island_world_objects.json',
  'ship_strengthen_meta.json',
  'world_chapter_random.json',
  'world_task_data.json',
];

export async function applyBelfastFormat(outRoot, servers, templateRoot = null, hints = null, luaRoot = null) {
  for (const server of servers) {
    await coerceServerFiles(outRoot, server, hints);
    await stripServerIndexKeys(outRoot, server, hints);
    await mirrorServerFiles(outRoot, server, hints);
    await writeEmptyObjectFiles(outRoot, server, hints);
    await normalizeServerFiles(outRoot, server, hints);
  }
  await writeBelfastRootFiles(outRoot, servers, templateRoot, hints, luaRoot);
  if (templateRoot && hints) {
    await copyMissingTemplateFiles(outRoot, templateRoot, hints, servers);
    await pruneTemplateExtraFiles(outRoot, hints, servers);
  }
}

export function isBelfastManagedRootFile(rel) {
  return BELFAST_MANAGED_ROOT_FILES.has(rel);
}

export function buildActivityBuildPoolOverrides({ activityTemplates, materials, exchanges, activityShipCreates = [], nameCodes, shipStats, buildPools = [], now = Math.floor(Date.now() / 1000) }) {
  const materialByID = buildIndexByID(materials);
  const exchangeByID = buildIndexByID(exchanges);
  const prayCandidatesByCreateID = buildPrayPoolCandidatesByCreateID(activityShipCreates, shipStats);
  const statsByName = buildShipStatsNameIndex(shipStats);
  const nameCodeMap = buildNameCodeMap(nameCodes);
  const statsByID = buildShipStatsIDIndex(shipStats);
  const poolByShipID = buildShipPoolIndex(buildPools);
  const overrides = [];

  for (const activity of asArray(activityTemplates)) {
    const type = positiveInteger(activity?.type);
    if (type !== 1) continue;
    if (!isActivityActiveAtTime(activity?.time, now)) continue;
    const activityID = positiveInteger(activity?.id);
    const createID = positiveInteger(activity?.config_id);
    if (!activityID || !createID) continue;
    const material = materialByID.get(createID);
    if (!material) continue;

    const ships = new Map();
    const pickupRates = extractRateTipShipRates(material.rate_tip, nameCodeMap);
    for (const [name, rate] of pickupRates.entries()) {
      const ids = statsByName.get(name) ?? [];
      for (const shipID of ids) {
        const stat = statsByID.get(shipID);
        if (!stat) continue;
        upsertActivityOverrideShip(ships, {
          ship_id: shipID,
          is_pickup: true,
          rate_tenth_percent: rate,
          source: 'rate_tip',
          rarity: positiveInteger(stat.rarity ?? stat.rarity_id ?? stat.rarityID),
        });
      }
    }

    const exchange = exchangeByID.get(activityID);
    if (Array.isArray(exchange?.exchange_ship_id)) {
      for (const shipID of exchange.exchange_ship_id.map(positiveInteger).filter(Boolean)) {
        const stat = statsByID.get(shipID);
        upsertActivityOverrideShip(ships, {
          ship_id: shipID,
          is_pickup: true,
          source: 'exchange',
          rarity: positiveInteger(stat?.rarity ?? stat?.rarity_id ?? stat?.rarityID),
        });
      }
    }

    const basePoolID = positiveInteger(material.ship_icon);
    if (basePoolID) {
      for (const shipID of prayCandidatesByCreateID.get(inferredPrayCreateID(basePoolID)) ?? []) {
        upsertActivityOverrideShip(ships, {
          ship_id: shipID,
          is_pickup: false,
          source: 'inferred_pray_pool',
          rarity: positiveInteger(statsByID.get(shipID)?.rarity ?? statsByID.get(shipID)?.rarity_id ?? statsByID.get(shipID)?.rarityID),
        });
      }
      for (const stat of shipDataValues(shipStats)) {
        const shipID = positiveInteger(stat?.id);
        const poolID = positiveInteger(stat?.pool_id ?? stat?.poolId ?? stat?.pool) ?? poolByShipID.get(shipID) ?? null;
        const rarity = positiveInteger(stat?.rarity ?? stat?.rarity_id ?? stat?.rarityID);
        if (!shipID || poolID !== basePoolID || !rarity) continue;
        if (rarity > 5) continue;
        upsertActivityOverrideShip(ships, {
          ship_id: shipID,
          is_pickup: false,
          source: 'inferred_base_pool',
          rarity,
        });
      }
    }

    const sortedShips = [...ships.values()]
      .sort((a, b) => {
        if (Boolean(b.is_pickup) !== Boolean(a.is_pickup)) return Number(b.is_pickup) - Number(a.is_pickup);
        return a.ship_id - b.ship_id;
      })
      .map(({ rarity, ...ship }) => ship);

    if (sortedShips.length > 0) {
      overrides.push({
        activity_id: activityID,
        create_id: createID,
        ships: sortedShips,
      });
    }
  }

  return overrides.sort((a, b) => a.activity_id - b.activity_id || a.create_id - b.create_id);
}

function isActivityActiveAtTime(timeConfig, now) {
  if (timeConfig === 'stop') return false;
  if (timeConfig === 'always') return true;
  if (!Array.isArray(timeConfig) || timeConfig[0] !== 'timer') return true;
  const start = parseLuaActivityTimestamp(timeConfig[1]);
  const end = parseLuaActivityTimestamp(timeConfig[2]);
  if (start == null || end == null) return true;
  return now >= start && now <= end;
}

function parseLuaActivityTimestamp(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const date = Array.isArray(value[0]) ? value[0] : null;
  const time = Array.isArray(value[1]) ? value[1] : null;
  if (!date || !time || date.length < 3 || time.length < 3) return null;
  const [year, month, day] = date.map(positiveInteger);
  const [hour, minute, second] = time.map((part) => typeof part === 'number' ? part : positiveInteger(part));
  if (!year || !month || !day || hour == null || minute == null || second == null) return null;
  return Math.floor(Date.UTC(year, month - 1, day, hour, minute, second) / 1000);
}

async function coerceServerFiles(outRoot, server, hints) {
  if (!hints) return;
  const serverRoot = path.join(outRoot, server);
  if (!(await exists(serverRoot))) return;
  const files = await listFiles(serverRoot, '.json');
  await Promise.all(files.map(async (file) => {
    const rel = `${server}/${toPosix(path.relative(serverRoot, file))}`;
    if (!hints.hasFile(rel)) return;
    if (hints.wantsArray(rel)) await objectFileToArray(file);
  }));
}

async function objectFileToArray(filePath) {
  if (!(await exists(filePath))) return;
  const data = await readJson(filePath);
  if (Array.isArray(data)) return;
  if (!data || typeof data !== 'object') return;
  await writeJson(filePath, objectToSortedArray(data));
}

async function mirrorServerFiles(outRoot, server, hints) {
  for (const name of BELFAST_SHARECFGDATA_MIRRORS) {
    const rel = `${server}/sharecfgdata/${name}`;
    if (hints && !hints.hasFile(rel)) continue;
    const target = path.join(outRoot, server, 'sharecfgdata', name);
    if (await exists(target)) continue;
    const source = path.join(outRoot, server, 'ShareCfg', name);
    if (!(await exists(source))) continue;
    await writeJson(target, await readJson(source));
  }
}

async function writeEmptyObjectFiles(outRoot, server, hints) {
  for (const rel of BELFAST_EMPTY_OBJECT_FILES) {
    const fullRel = `${server}/${rel}`;
    if (hints && !hints.hasFile(fullRel)) continue;
    const filePath = path.join(outRoot, server, ...rel.split('/'));
    if (await exists(filePath)) continue;
    await writeJson(filePath, hints?.wantsArray(fullRel) ? [] : {});
  }
}

async function normalizeServerFiles(outRoot, server, hints) {
  for (const [rel, fields] of BELFAST_ARRAY_FIELD_NORMALIZERS) {
    const fullRel = `${server}/${rel}`;
    if (hints && !hints.hasFile(fullRel)) continue;
    const filePath = path.join(outRoot, server, ...rel.split('/'));
    if (!(await exists(filePath))) continue;
    const data = await readJson(filePath);
    if (normalizeEmptyStringArrayFields(data, fields)) await writeJson(filePath, data);
  }
  for (const [rel, fields] of BELFAST_SCALAR_ARRAY_FIELD_NORMALIZERS) {
    const fullRel = `${server}/${rel}`;
    if (hints && !hints.hasFile(fullRel)) continue;
    const filePath = path.join(outRoot, server, ...rel.split('/'));
    if (!(await exists(filePath))) continue;
    const data = await readJson(filePath);
    if (normalizeScalarArrayFields(data, fields)) await writeJson(filePath, data);
  }
}

function normalizeEmptyStringArrayFields(data, fields) {
  if (!data || typeof data !== 'object') return false;
  const fieldSet = new Set(fields);
  let changed = false;

  function visit(value) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (fieldSet.has(key) && child === '') {
        value[key] = [];
        changed = true;
      } else {
        visit(child);
      }
    }
  }

  visit(data);
  return changed;
}

function normalizeScalarArrayFields(data, fields) {
  if (!data || typeof data !== 'object') return false;
  const fieldSet = new Set(fields);
  let changed = false;

  function visit(value) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (fieldSet.has(key) && child !== '' && !Array.isArray(child)) {
        value[key] = [child];
        changed = true;
      } else {
        visit(child);
      }
    }
  }

  visit(data);
  return changed;
}

async function stripServerIndexKeys(outRoot, server, hints) {
  const serverRoot = path.join(outRoot, server);
  if (!(await exists(serverRoot))) return;
  const files = await listFiles(serverRoot, '.json');
  await Promise.all(files.map(async (file) => {
    const rel = `${server}/${toPosix(path.relative(serverRoot, file))}`;
    if (hints && !hints.hasFile(rel)) return;
    if (hints?.wantsTopObjectIndexOnly(rel)) return;
    await stripIndexKeys(file);
  }));
}

async function stripIndexKeys(filePath) {
  if (!(await exists(filePath))) return;
  const data = await readJson(filePath);
  if (Array.isArray(data) || !data || typeof data !== 'object') return;
  const entries = Object.entries(data);
  const filtered = entries.filter(([key]) => isEntityKey(key));
  if (filtered.length === entries.length) return;
  const stripped = {};
  for (const [key, value] of filtered.sort(([a], [b]) => jsonKeySort(a, b))) stripped[key] = value;
  await writeJson(filePath, stripped);
}

function objectToSortedArray(data) {
  return Object.entries(data)
    .filter(([key]) => isEntityKey(key))
    .sort(([a], [b]) => jsonKeySort(a, b))
    .map(([, value]) => value);
}

async function writeBelfastRootFiles(outRoot, servers, templateRoot, hints, luaRoot) {
  const buildPools = await resolveBuildPools(outRoot, servers, templateRoot);
  await writeJson(path.join(outRoot, 'build_pools.json'), buildPools);
  await writeJson(path.join(outRoot, 'build_times.json'), await rootObjectValue('build_times.json', templateRoot, hints, () => collectBuildTimes(outRoot, servers)));
  await writeJson(path.join(outRoot, 'requisition_ships.json'), await collectRequisitionShips(outRoot, servers));
  await writeJson(path.join(outRoot, 'activity_build_pool_overrides.json'), await collectActivityBuildPoolOverridesFile(outRoot, servers, buildPools));

  const template = templateRoot ? path.join(templateRoot, 'versions.json') : null;
  const templateValue = template && await exists(template) ? await readJson(template) : null;
  const fallbackVersions = await collectVersions(templateRoot, servers, luaRoot);
  const versions = templateValue && typeof templateValue === 'object' && !Array.isArray(templateValue)
    ? { ...templateValue, ...fallbackVersions }
    : fallbackVersions;
  await writeJson(
    path.join(outRoot, 'versions.json'),
    versions,
  );
}

async function collectActivityBuildPoolOverridesFile(outRoot, servers, buildPools) {
  for (const server of servers) {
    const activityTemplates = await readServerJson(outRoot, server, 'ShareCfg/activity_template.json');
    const materials = await readServerJson(outRoot, server, 'ShareCfg/ship_data_create_material.json');
    const exchanges = await readServerJson(outRoot, server, 'ShareCfg/ship_data_create_exchange.json');
    const activityShipCreates = await readServerJson(outRoot, server, 'ShareCfg/activity_ship_create.json');
    const stats = await readServerJson(outRoot, server, 'sharecfgdata/ship_data_statistics.json')
      ?? await readServerJson(outRoot, server, 'ShareCfg/ship_data_statistics.json');
    const nameCodes = await readServerJson(outRoot, server, 'ShareCfg/name_code.json');
    if (!activityTemplates || !materials || !exchanges || !stats || !nameCodes) continue;
    const overrides = buildActivityBuildPoolOverrides({
      activityTemplates,
      materials,
      exchanges,
      activityShipCreates,
      nameCodes,
      shipStats: stats,
      buildPools,
    });
    if (overrides.length > 0) return overrides;
  }
  return [];
}

async function rootObjectValue(rel, templateRoot, hints, collect) {
  const template = templateRoot ? path.join(templateRoot, rel) : null;
  const templateValue = template && await exists(template) ? await readJson(template) : null;
  const collected = await collect();
  if (
    !hints?.wantsTopObjectNumericKeys(rel)
    && templateValue
    && typeof templateValue === 'object'
    && !Array.isArray(templateValue)
    && !isEmptyObject(templateValue)
  ) return templateValue;
  if (templateValue && isEmptyObject(collected) && !isEmptyObject(templateValue)) return templateValue;
  return collected;
}

function isEmptyObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
}

async function copyMissingTemplateFiles(outRoot, templateRoot, hints, servers) {
  for (const rel of hints.files) {
    if (isServerRel(rel) && !servers.includes(rel.split('/')[0])) continue;
    const target = path.join(outRoot, ...rel.split('/'));
    if (await exists(target)) continue;
    const source = path.join(templateRoot, ...rel.split('/'));
    if (await exists(source)) await writeJson(target, await readJson(source));
  }
}

async function pruneTemplateExtraFiles(outRoot, hints, servers) {
  if (!(await exists(outRoot))) return;
  for (const file of await listFiles(outRoot, '.json')) {
    const rel = toPosix(path.relative(outRoot, file));
    if (isServerRel(rel) && !servers.includes(rel.split('/')[0])) continue;
    if (isBelfastManagedRootFile(rel)) continue;
    if (hints.hasFile(rel)) continue;
    await fs.rm(file, { force: true });
  }
}

function isServerRel(rel) {
  return /^[A-Z]{2}\//.test(rel);
}

async function collectBuildPools(outRoot, servers) {
  for (const server of servers) {
    const data = await readServerJson(outRoot, server, 'sharecfgdata/ship_data_statistics.json');
    const pools = shipDataValues(data)
      .map((ship) => positiveInteger(ship.id))
      .filter(Boolean)
      .sort((a, b) => a - b);
    if (pools.length > 0) return pools;
  }
  return [];
}

async function collectBuildTimes(outRoot, servers) {
  for (const server of servers) {
    const data = await readServerJson(outRoot, server, 'sharecfgdata/ship_data_statistics.json');
    const times = {};
    for (const ship of shipDataValues(data)) {
      const id = positiveInteger(ship.id);
      const time = positiveInteger(ship.build_time ?? ship.buildTime ?? ship.buildtime ?? ship.create_time ?? ship.createTime);
      if (id && time) times[String(id)] = time;
    }
    if (Object.keys(times).length > 0) return sortObjectByNumericKey(times);
  }
  return {};
}

async function collectRequisitionShips(outRoot, servers) {
  for (const server of servers) {
    const data = await readServerJson(outRoot, server, 'ShareCfg/ship_data_create_exchange.json');
    const regular = Array.isArray(data) ? data.find((entry) => entry?.id === 1) : data?.['1'];
    if (Array.isArray(regular?.exchange_ship_id)) {
      return [...new Set(regular.exchange_ship_id.map(positiveInteger).filter(Boolean))].sort((a, b) => a - b);
    }
  }
  return [];
}

async function collectVersions(templateRoot, servers, luaRoot = null) {
  const versions = {};
  for (const server of servers) {
    const version = await readVersionFromSources(templateRoot, server, luaRoot);
    versions[server] = version ?? '0';
  }
  return versions;
}

async function resolveBuildPools(outRoot, servers, templateRoot) {
  const template = templateRoot ? path.join(templateRoot, 'build_pools.json') : null;
  const templateValue = template && await exists(template) ? await readJson(template) : null;
  const knownShipIDs = new Set(await collectBuildPoolCandidateIDs(outRoot, servers));
  const activityOverlays = await collectActivityBuildPoolOverlays(outRoot, servers, knownShipIDs);

  if (Array.isArray(templateValue) && templateValue.length > 0) {
    const valid = [];
    const stale = [];
    for (const entry of templateValue) {
      const id = positiveInteger(entry?.id);
      const pool = positiveInteger(entry?.pool);
      if (!id || !pool) continue;
      if (knownShipIDs.has(id)) valid.push({ id, pool });
      else stale.push(id);
    }
    if (stale.length > 0) {
      console.warn(`警告: build_pools.json 中有 ${stale.length} 个条目在当前 ship_data_statistics 中不存在，已忽略，示例: ${stale.slice(0, 10).join(', ')}`);
    }
    return mergePoolMappingsWithActivityOverride(valid, activityOverlays).sort((a, b) => a.id - b.id || a.pool - b.pool);
  }

  throw new Error('无法生成 build_pools.json：当前 Lua 数据没有完整建造池成员来源，且模板 build_pools.json 不存在或为空');
}

async function collectActivityBuildPoolOverlays(outRoot, servers, knownShipIDs) {
  const overlays = [];
  for (const server of servers) {
    const activityTemplates = await readServerJson(outRoot, server, 'ShareCfg/activity_template.json');
    const materials = await readServerJson(outRoot, server, 'ShareCfg/ship_data_create_material.json');
    const exchanges = await readServerJson(outRoot, server, 'ShareCfg/ship_data_create_exchange.json');
    const stats = await readServerJson(outRoot, server, 'sharecfgdata/ship_data_statistics.json')
      ?? await readServerJson(outRoot, server, 'ShareCfg/ship_data_statistics.json');
    const nameCodes = await readServerJson(outRoot, server, 'ShareCfg/name_code.json');
    if (!activityTemplates || !materials || !exchanges || !stats || !nameCodes) continue;

    const materialByID = buildIndexByID(materials);
    const exchangeByID = buildIndexByID(exchanges);
    const statsByName = buildShipStatsNameIndex(stats);
    const nameCodeMap = buildNameCodeMap(nameCodes);

    for (const activity of asArray(activityTemplates)) {
      const type = positiveInteger(activity?.type);
      if (![1, 55, 82].includes(type)) continue;
      const poolID = positiveInteger(activity?.config_id);
      const activityID = positiveInteger(activity?.id);
      if (!poolID || !activityID) continue;
      const material = materialByID.get(poolID);
      if (!material) continue;

      const shipNames = extractRateTipShipNames(material.rate_tip, nameCodeMap);
      const exchange = exchangeByID.get(activityID);
      if (exchange?.exchange_ship_id) {
        for (const shipID of exchange.exchange_ship_id.map(positiveInteger).filter(Boolean)) {
          if (knownShipIDs.has(shipID)) overlays.push({ id: shipID, pool: poolID });
        }
      }
      for (const shipName of shipNames) {
        const ids = statsByName.get(shipName) ?? [];
        for (const shipID of ids) {
          if (knownShipIDs.has(shipID)) overlays.push({ id: shipID, pool: poolID });
        }
      }
    }
  }
  return dedupePoolMappings(overlays);
}

function asArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data)
    .filter(([key]) => isEntityKey(key))
    .map(([, value]) => value)
    .filter((value) => value && typeof value === 'object');
}

function buildIndexByID(data) {
  const out = new Map();
  for (const entry of asArray(data)) {
    const id = positiveInteger(entry?.id);
    if (id) out.set(id, entry);
  }
  return out;
}

function buildNameCodeMap(data) {
  const out = new Map();
  for (const entry of asArray(data)) {
    const id = positiveInteger(entry?.id);
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    if (id && name) out.set(id, name);
  }
  return out;
}

function buildShipStatsNameIndex(data) {
  const out = new Map();
  for (const ship of shipDataValues(data)) {
    const id = positiveInteger(ship?.id);
    const name = typeof ship?.name === 'string' ? ship.name.trim() : '';
    if (!id || !name || (id % 10) !== 1) continue;
    const ids = out.get(name) ?? [];
    ids.push(id);
    out.set(name, ids);
  }
  return out;
}

function buildShipStatsIDIndex(data) {
  const out = new Map();
  for (const ship of shipDataValues(data)) {
    const id = positiveInteger(ship?.id);
    if (id) out.set(id, ship);
  }
  return out;
}

function buildShipPoolIndex(data) {
  const out = new Map();
  for (const entry of Array.isArray(data) ? data : []) {
    const id = positiveInteger(entry?.id);
    const pool = positiveInteger(entry?.pool);
    if (id && pool) out.set(id, pool);
  }
  return out;
}

function buildPrayPoolCandidatesByCreateID(activityShipCreates, shipStats) {
  const out = new Map();
  const statsByID = buildShipStatsIDIndex(shipStats);
  for (const entry of asArray(activityShipCreates)) {
    const createID = positiveInteger(entry?.create_id);
    if (!createID || !Array.isArray(entry?.pickup_list)) continue;
    const shipIDs = [];
    for (const rawShipID of entry.pickup_list) {
      const shipID = positiveInteger(rawShipID);
      const stat = shipID ? statsByID.get(shipID) : null;
      const rarity = positiveInteger(stat?.rarity ?? stat?.rarity_id ?? stat?.rarityID);
      if (!shipID || (rarity != null && rarity > 3)) continue;
      shipIDs.push(shipID);
    }
    if (shipIDs.length > 0) out.set(createID, [...new Set(shipIDs)].sort((a, b) => a - b));
  }
  return out;
}

function inferredPrayCreateID(basePoolID) {
  if (basePoolID === 1) return 6;
  if (basePoolID === 2) return 7;
  if (basePoolID === 3) return 8;
  return null;
}

function extractRateTipShipNames(rateTip, nameCodeMap) {
  if (!Array.isArray(rateTip)) return [];
  const out = new Set();
  for (const rawLine of rateTip) {
    if (typeof rawLine !== 'string') continue;
    if (!rawLine.includes('up!')) continue;
    const nameCodeMatches = [...rawLine.matchAll(/\{namecode:(\d+)\}/g)];
    for (const match of nameCodeMatches) {
      const id = positiveInteger(match[1]);
      const resolved = id ? nameCodeMap.get(id) : null;
      if (resolved) out.add(resolved);
    }
    const plainText = rawLine.replace(/<[^>]+>/g, '').trim();
    const candidate = plainText.split('：')[0]?.trim();
    if (candidate && !candidate.startsWith('海上传奇舰船') && !candidate.startsWith('超稀有舰船') && !candidate.startsWith('精锐舰船') && !candidate.startsWith('稀有舰船') && !candidate.startsWith('普通舰船')) {
      out.add(candidate);
    }
  }
  return [...out];
}

function extractRateTipShipRates(rateTip, nameCodeMap) {
  const out = new Map();
  if (!Array.isArray(rateTip)) return out;
  for (const rawLine of rateTip) {
    if (typeof rawLine !== 'string') continue;
    const names = new Set();
    const nameCodeMatches = [...rawLine.matchAll(/\{namecode:(\d+)\}/g)];
    for (const match of nameCodeMatches) {
      const id = positiveInteger(match[1]);
      const resolved = id ? nameCodeMap.get(id) : null;
      if (resolved) names.add(resolved);
    }
    const plainText = rawLine.replace(/<[^>]+>/g, '').trim();
    const [namePart, ratePart] = plainText.split('：');
    const candidate = namePart?.trim();
    if (candidate && !candidate.startsWith('海上传奇舰船') && !candidate.startsWith('超稀有舰船') && !candidate.startsWith('精锐舰船') && !candidate.startsWith('稀有舰船') && !candidate.startsWith('普通舰船')) {
      names.add(candidate);
    }
    const rate = parseRateTenthPercent(ratePart);
    if (!rate || names.size === 0) continue;
    for (const name of names) out.set(name, rate);
  }
  return out;
}

function parseRateTenthPercent(rateText) {
  if (typeof rateText !== 'string') return null;
  const match = rateText.match(/([0-9]+(?:\.[0-9]+)?)%/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 10);
}

function upsertActivityOverrideShip(target, entry) {
  const existing = target.get(entry.ship_id);
  if (!existing) {
    target.set(entry.ship_id, { ...entry });
    return;
  }
  existing.is_pickup = existing.is_pickup || entry.is_pickup;
  if (entry.rate_tenth_percent != null) existing.rate_tenth_percent = entry.rate_tenth_percent;
  existing.source = mergeSources(existing.source, entry.source);
  if (entry.rarity != null) existing.rarity = entry.rarity;
}

function mergeSources(left, right) {
  const values = new Set(String(left ?? '').split(',').filter(Boolean));
  for (const value of String(right ?? '').split(',').filter(Boolean)) values.add(value);
  return [...values].sort().join(',');
}

async function collectBuildPoolCandidateIDs(outRoot, servers) {
  const ids = new Set();
  for (const server of servers) {
    const data = await readServerJson(outRoot, server, 'sharecfgdata/ship_data_statistics.json');
    for (const ship of shipDataValues(data)) {
      const id = positiveInteger(ship.id);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

async function readVersionFromSources(templateRoot, server, luaRoot = null) {
  const candidates = [
    luaRoot ? path.join(luaRoot, 'versions', `${server}.txt`) : null,
    templateRoot ? path.join(templateRoot, '..', 'AzurLaneLuaScripts', 'versions', `${server}.txt`) : null,
    templateRoot ? path.join(templateRoot, '..', 'AzurLaneData', 'versions', `${server}.txt`) : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue;
    const raw = (await fs.readFile(candidate, 'utf8')).trim();
    if (raw) return raw;
  }
  return null;
}

function dedupePoolMappings(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const key = `${entry.id}:${entry.pool}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function mergePoolMappingsWithActivityOverride(baseEntries, activityEntries) {
  if (!Array.isArray(activityEntries) || activityEntries.length === 0) {
    return dedupePoolMappings(baseEntries);
  }
  const activityShipIDs = new Set(activityEntries.map((entry) => positiveInteger(entry?.id)).filter(Boolean));
  const filteredBase = baseEntries.filter((entry) => !activityShipIDs.has(positiveInteger(entry?.id)));
  return dedupePoolMappings([...filteredBase, ...activityEntries]);
}

async function readServerJson(outRoot, server, rel) {
  const filePath = path.join(outRoot, server, ...rel.split('/'));
  if (!(await exists(filePath))) return null;
  return readJson(filePath);
}

function shipDataValues(data) {
  if (Array.isArray(data)) return data.filter((value) => value && typeof value === 'object');
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data)
    .filter(([key]) => isEntityKey(key))
    .map(([, value]) => value)
    .filter((value) => value && typeof value === 'object' && !Array.isArray(value));
}

function isEntityKey(key) {
  return key !== 'all' && !key.startsWith('get_id_list_by_');
}

function positiveInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number.parseInt(value, 10);
  return null;
}

function sortObjectByNumericKey(data) {
  const out = {};
  for (const key of Object.keys(data).sort(jsonKeySort)) out[key] = data[key];
  return out;
}

function jsonKeySort(a, b) {
  const ai = /^\d+$/.test(a) ? Number.parseInt(a, 10) : null;
  const bi = /^\d+$/.test(b) ? Number.parseInt(b, 10) : null;
  if (ai !== null && bi !== null) return ai - bi;
  if (ai !== null) return -1;
  if (bi !== null) return 1;
  return a.localeCompare(b);
}
