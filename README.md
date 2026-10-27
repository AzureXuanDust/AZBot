# AZBot CN data

从 AzurLaneLuaScripts 生成当前 Belfast 使用的 CN 客户端表。生成器使用 Lua 5.5（Lupa 2.8）读取数据，输出 UTF-8、CRLF、每行一条记录；顶层数字 ID 按数值排序，记录内字段按字典序排序。字符串、空字符串、空表和 nil 按 Lua 语义处理。

`schema/manifest.json` 声明所需的 299 个表及三张剧情索引，不包含旧 JSON 模板或记录值。仓库与资源包都使用以下 CN 布局：

```text
CN/
├── GameCfg/
├── server/
├── ShareCfg/
└── sharecfgdata/
```

手写数据直接在 `CN/server` 维护，生成器只重建另外三个自动目录，不改写手写输入。打包时将整个 `CN` 原样放入 ZIP，启动器解压到 `Server/data`，同名文件直接覆盖，包外文件保留。提交 `CN/server` 的修改会触发发布，即使 Lua 仓库没有变化。

```powershell
python -m pip install -r requirements.txt
python -m unittest discover -s tests
python tools/generate_cn.py --lua-root ../AzurLaneLuaScripts --force --reference-cn D:/program/Projects/Github/belfast/data/CN
python tools/generate_cn.py --package-only --zip release/Resources-CN.zip
```

开发时可通过 `--reference-cn` 直接与 Belfast 的实际 CN 目录比较文件集合和原始字节。手写的 `server` 子目录不参与比较。参考目录始终只读，不会用于填充生成结果。

资源包根目录只有 `CN/`，没有额外清单、格式标记或版本描述文件。ZIP 的文件时间和属性固定，相同文件会得到相同的包。逐字节对比只用于生成器开发和回归测试，不参与启动器安装。

定时任务每次重新生成，自动表变化时发布；手写数据提交和显式强制运行也会发布。Lua revision 单独记录在不进入资源包的 `source.json`，其他区服更新不会只因 revision 变化触发资源发布。旧 Node 转换器及模板不再使用。
