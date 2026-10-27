import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

module = importlib.util.spec_from_file_location('generate_cn', Path(__file__).resolve().parents[1] / 'tools/generate_cn.py')
export = importlib.util.module_from_spec(module)
module.loader.exec_module(export)


class ExportTests(unittest.TestCase):
    def test_lua_semantics_preserve_strings_and_drop_undefined_values(self):
        lua = export.new_lua('example')
        value = lua.execute('return {text=[[\n正文\n第二行]], empty="", missing=UNDEFINED, list={UNDEFINED}, sparse={[2]=7}}')
        self.assertEqual(export.to_json(value), {'text': '正文\n第二行', 'empty': '', 'list': [], 'sparse': {'2': 7}})
        self.assertTrue(lua.eval('os == nil and io == nil and require == nil and python == nil'))

    def test_exact_row_order_fields_unicode_and_crlf(self):
        value = {'10': {'z': '', 'a': {'2': 2, '10': 10}}, '2': {'text': '中文\n', 'array': []}}
        expected = '{\r\n"2":{"array":[],"text":"中文\\n"},\r\n"10":{"a":{"10":10,"2":2},"z":""}\r\n}\r\n'
        self.assertEqual(export.encode_table(value), expected.encode('utf-8'))

    def test_story_exports_only_declared_indexes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            story = root / 'gamecfg/story'
            story.mkdir(parents=True)
            (story / 'index.lua').write_text('return {[100]="TEST"}', encoding='utf-8')
            (story / 'unrelated.lua').write_text('error("must not execute")', encoding='utf-8')
            result = export.collect(root, 'GameCfg/story.json', {'entries': ['index']})
            self.assertEqual(result, {'index': {'100': 'TEST'}})

    def test_broken_lua_fails_without_silent_partial_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'sharecfgdata').mkdir()
            (root / 'sharecfg').mkdir()
            (root / 'sharecfg/example.lua').write_text('pg.base.example = { [1] = {id=1}, invalid !!! }', encoding='utf-8')
            with self.assertRaises(Exception):
                export.collect(root, 'ShareCfg/example.json', {})

    def test_package_contains_only_cn_and_uses_current_handwritten_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            table = root / 'CN/ShareCfg/example.json'
            table.parent.mkdir(parents=True)
            table.write_bytes(b'{\r\n"1":{"id":1}\r\n}\r\n')
            server = root / 'CN/server/custom.json'
            server.parent.mkdir()
            server.write_bytes(b'handwritten\r\n')
            export.write_json(root / 'source.json', {'revision': 'test'})
            first, second = root / 'a.zip', root / 'b.zip'
            export.package(root, first)
            export.package(root, second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with zipfile.ZipFile(first) as archive:
                self.assertEqual(set(archive.namelist()), {'CN/ShareCfg/example.json', 'CN/server/custom.json'})
                self.assertEqual(archive.read('CN/ShareCfg/example.json'), table.read_bytes())
                self.assertEqual(archive.read('CN/server/custom.json'), b'handwritten\r\n')
            server.write_bytes(b'updated handwritten\n')
            export.package(root, root / 'changed.zip')
            with zipfile.ZipFile(root / 'changed.zip') as archive:
                self.assertEqual(archive.read('CN/server/custom.json'), b'updated handwritten\n')

    def test_handwritten_edits_do_not_change_lua_reference_comparison(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            table = root / 'ShareCfg/example.json'
            table.parent.mkdir()
            table.write_bytes(b'{}\r\n')
            server = root / 'server'
            server.mkdir()
            (server / 'old.txtpb').write_bytes(b'old')
            before = export.inventory(root)
            baseline = export.inventory(root, export.AUTO_DIRS)
            (server / 'old.txtpb').unlink()
            (server / 'new.sources.md').write_bytes(b'new\r\n')
            self.assertNotEqual(export.inventory(root), before)
            self.assertEqual(export.inventory(root, export.AUTO_DIRS), baseline)

    def test_repository_regeneration_keeps_maintained_server_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            staged = root / 'staged'
            output = root / 'output'
            for name in export.RESOURCE_DIRS:
                (staged / 'CN' / name).mkdir(parents=True)
                (staged / 'CN' / name / 'new.json').write_bytes(b'new')
                (output / 'CN' / name).mkdir(parents=True)
                (output / 'CN' / name / 'old.json').write_bytes(b'old')
            export.write_json(staged / 'source.json', {})
            server = output / 'CN/server'
            export.publish(staged, output, server)
            self.assertEqual((server / 'old.json').read_bytes(), b'old')
            self.assertFalse((server / 'new.json').exists())
            for name in export.AUTO_DIRS:
                self.assertEqual((output / 'CN' / name / 'new.json').read_bytes(), b'new')
                self.assertFalse((output / 'CN' / name / 'old.json').exists())


if __name__ == '__main__':
    unittest.main()
