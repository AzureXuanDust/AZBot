#!/usr/bin/env node
import path from 'node:path';
import { applyBelfastFormat } from './belfast.mjs';
import { Collector } from './collector.mjs';
import { compareShapes, writeChangeReport } from './compare.mjs';
import { ShapeHints } from './shape.mjs';
import { SERVERS, prepareOutDir } from './util.mjs';

const defaults = {
  luaRoot: path.resolve('AzurLaneLuaScripts'),
  templateRoot: path.resolve('data'),
  out: path.resolve('out', 'AzurLaneData_lua_json_node'),
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const luaRoot = path.resolve(args.luaRoot ?? defaults.luaRoot);
  const templateRoot = args.templateRoot === null ? null : path.resolve(args.templateRoot ?? defaults.templateRoot);
  const out = path.resolve(args.out ?? defaults.out);
  const servers = args.server ? [args.server] : SERVERS;

  await prepareOutDir(out, Boolean(args.force));
  const hints = await ShapeHints.load(templateRoot);
  const collector = new Collector(luaRoot, templateRoot, out, hints);
  for (const server of servers) {
    await collector.collectServer(server, Boolean(args.samples));
  }
  for (const warning of collector.warnings) {
    console.warn(`警告: ${warning}`);
  }
  if (!args.raw) await applyBelfastFormat(out, servers, templateRoot, hints, luaRoot);
  if (templateRoot) {
    const report = await writeChangeReport(templateRoot, out, servers);
    console.log(`变更报告: ${report.reportPath}`);
    console.log(`内容变更: ${report.changed.length}, 缺失: ${report.missing.length}, 新增: ${report.added.length}`);
  }
  if (args.compare) {
    if (!templateRoot) throw new Error('--compare 需要 --template-root');
    const messages = await compareShapes(templateRoot, out, servers);
    if (messages.length === 0) console.log('结构对比通过');
    else for (const message of messages) console.log(message);
  }
  console.log(`输出完成: ${out}`);
}

function parseArgs(argv) {
  const out = { force: false, samples: false, compare: false, raw: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--lua-root') out.luaRoot = requireValue(argv, ++i, arg);
    else if (arg === '--template-root') out.templateRoot = requireValue(argv, ++i, arg);
    else if (arg === '--old-data-root') out.templateRoot = requireValue(argv, ++i, arg);
    else if (arg === '--no-old-data-root') out.templateRoot = null;
    else if (arg === '--out') out.out = requireValue(argv, ++i, arg);
    else if (arg === '--server') out.server = requireValue(argv, ++i, arg);
    else if (arg === '--force') out.force = true;
    else if (arg === '--samples') out.samples = true;
    else if (arg === '--compare') out.compare = true;
    else if (arg === '--raw') out.raw = true;
    else if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  if (out.server && !SERVERS.includes(out.server)) throw new Error(`未知区服: ${out.server}`);
  return out;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} 缺少值`);
  return value;
}

function printHelp() {
  console.log(`用法: node tools/azurlua2json-node/cli.mjs [选项]\n\n选项:\n  --lua-root <dir>       Lua 根目录，默认 AzurLaneLuaScripts\n  --template-root <dir>  JSON 结构模板根目录，默认 data\n  --old-data-root <dir>  兼容旧参数，等同 --template-root\n  --no-old-data-root     不加载结构模板 hints\n  --out <dir>            输出目录，默认 out/AzurLaneData_lua_json_node\n  --server <CN|EN|JP|KR|TW>  只处理指定区服\n  --force                覆盖输出目录\n  --samples              只生成样本文件\n  --compare              与模板 JSON 做结构对比\n  --raw                  保留原始形态，不执行模板后处理`);
}

main().catch((error) => {
  console.error(error.stack ?? error.message ?? String(error));
  process.exitCode = 1;
});
