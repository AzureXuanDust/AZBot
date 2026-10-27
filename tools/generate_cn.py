#!/usr/bin/env python3
"""Generate CN client tables from Lua and bundle the maintained server data unchanged."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile

from lupa.lua55 import LuaRuntime, lua_type

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / 'schema'
SERVER_SOURCE = ROOT / 'CN/server'
AUTO_DIRS = {'ShareCfg', 'sharecfgdata', 'GameCfg'}
RESOURCE_DIRS = AUTO_DIRS | {'server'}


def new_lua(name):
    lua = LuaRuntime(register_eval=False, register_builtins=False)
    lua.execute('os=nil; io=nil; package=nil; debug=nil; require=nil; dofile=nil; loadfile=nil; load=nil; python=nil')
    lua.execute('pg={base={}}; ShipType={MainShipType={4,5}}')
    lua.globals().pg.base[name] = lua.table()
    return lua


def execute(lua, source):
    # Adjacent decompiler IIFEs must be separated, otherwise Lua chains calls.
    text = source.read_text(encoding='utf-8-sig')
    text = re.sub(r'(?m)^(\s*)\(function\s*\(', r'\1;(function (', text)
    return lua.execute(text, name=str(source))


def to_json(value, force_object=False):
    if lua_type(value) != 'table':
        if lua_type(value) is not None:
            raise ValueError(f'Unsupported Lua value: {lua_type(value)}')
        if isinstance(value, float) and value.is_integer():
            return int(value)
        return value
    keys = list(value.keys())
    if not force_object and all(type(k) is int for k in keys) and sorted(keys) == list(range(1, len(keys) + 1)):
        return [to_json(value[i]) for i in range(1, len(keys) + 1)]
    return {str(k): to_json(value[k]) for k in keys}


def row_key(key):
    return (0, int(key)) if str(key).isdigit() else (1, str(key))


def encode_table(value):
    def compact(row):
        return json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
    if isinstance(value, list):
        lines = [compact(row) for row in value]
        opening, closing = '[', ']'
    else:
        lines = [compact(str(k)) + ':' + compact(value[k]) for k in sorted(value, key=row_key)]
        opening, closing = '{', '}'
    return (opening + '\r\n' + ',\r\n'.join(lines) + '\r\n' + closing + '\r\n').encode('utf-8')


def collect(lua_cn, relative, rule):
    folder, filename = relative.split('/')
    name = Path(filename).stem
    lua = new_lua(name)
    if folder == 'GameCfg':
        return {entry: to_json(execute(lua, lua_cn / 'gamecfg' / name / (entry + '.lua')))
                for entry in rule['entries']}
    split = sorted(p for p in (lua_cn / 'sharecfgdata').glob(name + '*.lua')
                   if re.fullmatch(re.escape(name) + r'(?:_\d+)?\.lua', p.name))
    if folder == 'sharecfgdata':
        sources = split
    else:
        main = next((p for p in (lua_cn / 'sharecfg').glob('*.lua') if p.stem.lower() == name.lower()), None)
        if main is None:
            raise FileNotFoundError(f'No Lua source for {relative}')
        sources = split if '__stream__ = true' in main.read_text(encoding='utf-8-sig') else [main]
    if not sources:
        raise FileNotFoundError(f'No Lua source for {relative}')
    for source in sources:
        execute(lua, source)
    table = lua.globals().pg.base[name]
    if not list(table.keys()):
        table = lua.globals().pg[name]
    if table is None:
        raise ValueError(f'No table produced for {relative}')
    rows = to_json(table, force_object=True)
    preserve = rule.get('indexes', [])
    rows = {k: v for k, v in rows.items()
            if k in preserve or (k != 'all' and not k.startswith(('__', 'get_id_list_by_')))}
    if not rows:
        raise ValueError(f'Empty table: {relative}')
    return [rows[k] for k in sorted(rows, key=row_key)] if rule.get('array') else rows


def inventory(cn, directories=RESOURCE_DIRS):
    return {p.relative_to(cn).as_posix(): {'size': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
            for p in sorted(cn.rglob('*')) if p.is_file() and p.relative_to(cn).parts[0] in directories}


def compare(expected, actual):
    return [f'{"missing" if key not in actual else "extra" if key not in expected else "different bytes"}: {key}'
            for key in sorted(expected.keys() | actual.keys()) if expected.get(key) != actual.get(key)]


def write_json(file, value):
    file.write_bytes((json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))


def generate(lua_root, output, reference_cn=None):
    spec = json.loads((SPEC / 'manifest.json').read_text(encoding='utf-8'))
    for relative, rule in spec['tables'].items():
        value = collect(lua_root / 'CN', relative, rule)
        file = output / 'CN' / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(encode_table(value))
    if reference_cn:
        files = inventory(output / 'CN', AUTO_DIRS)
        expected = inventory(reference_cn, AUTO_DIRS)
        differences = compare(expected, files)
        if differences:
            raise ValueError('CN byte comparison failed:\n' + '\n'.join(differences))
        # A reference directory permits a direct byte comparison in addition to SHA-256.
        assert all((output / 'CN' / rel).read_bytes() == (reference_cn / rel).read_bytes() for rel in expected)
        print(f'CN byte comparison passed: {len(files)} files')
    # Handwritten inputs are maintained in the repository and copied byte for byte.
    shutil.copytree(SERVER_SOURCE, output / 'CN/server')
    revision = subprocess.check_output(['git', '-C', str(lua_root), 'rev-parse', 'HEAD'], text=True).strip()
    version = (lua_root / 'versions/CN.txt').read_text(encoding='utf-8').strip()
    source = {'repository': 'AzurLaneTools/AzurLaneLuaScripts', 'commit': revision, 'version': version}
    write_json(output / 'source.json', {'AzurLaneLuaScripts': source})
    return sum(file.is_file() for file in (output / 'CN').rglob('*'))


def package(output, archive):
    cn = output / 'CN'
    if not cn.is_dir():
        raise FileNotFoundError(cn)
    archive.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for file in sorted(cn.rglob('*')):
            if not file.is_file():
                continue
            # Fixed timestamps and attributes make identical input produce identical ZIP bytes.
            item = zipfile.ZipInfo(file.relative_to(output).as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
            item.compress_type = zipfile.ZIP_DEFLATED
            item.external_attr = 0o100644 << 16
            bundle.writestr(item, file.read_bytes(), compresslevel=9)


def publish(staged, output, server_source):
    (output / 'CN').mkdir(parents=True, exist_ok=True)
    for name in sorted(RESOURCE_DIRS):
        target = output / 'CN' / name
        # In the repository, server is the maintained input itself. Never replace it
        # with the staging copy while regenerating the three automatic directories.
        if name == 'server' and target.resolve() == server_source.resolve():
            continue
        if target.exists():
            shutil.rmtree(target)
        (staged / 'CN' / name).rename(target)
    (staged / 'source.json').replace(output / 'source.json')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lua-root', type=Path, default=Path('AzurLaneLuaScripts'))
    parser.add_argument('--out', type=Path, default=ROOT)
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--reference-cn', type=Path)
    parser.add_argument('--zip', type=Path)
    parser.add_argument('--package-only', action='store_true')
    args = parser.parse_args()
    out, lua_root = args.out.resolve(), args.lua_root.resolve()
    if not args.package_only:
        destination = out / 'CN'
        inputs = [lua_root / 'CN', SPEC, args.reference_cn]
        if out != ROOT:
            inputs.append(SERVER_SOURCE)
        for source in filter(None, inputs):
            source = source.resolve()
            if source.is_relative_to(destination) or destination.is_relative_to(source):
                parser.error('Output CN must not overlap the Lua source, reference or schema')
        existing = [destination / name for name in RESOURCE_DIRS
                    if name != 'server' or destination / name != SERVER_SOURCE]
        if any(p.exists() for p in existing) and not args.force:
            parser.error('Output exists; use --force to replace generated files')
        out.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.cn-export-', dir=out) as staging:
            staged = Path(staging) / 'generated'
            staged.mkdir()
            count = generate(lua_root, staged, args.reference_cn)
            publish(staged, out, SERVER_SOURCE)
        print(f'Prepared {count} CN resource files -> {out}')
    if args.zip:
        package(out, args.zip)
        print(f'Packaged -> {args.zip}')


if __name__ == '__main__':
    main()
