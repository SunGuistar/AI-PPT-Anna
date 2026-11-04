# focus-flow · AI PPT

基于 Anna 平台的 AI 演示文稿应用：输入主题，Anna LLM 生成结构化内容，在线预览、修改后一键导出**可编辑的 PPTX**（共 5 页：封面 1 + 正文 3 + 总结 1，统一简约排版）。

## 功能

- 输入 PPT 主题和补充要求，调用 Anna 平台 LLM 生成结构化内容（严格 JSON）
- 前端逐页预览（封面 + 3 页正文 + 1 页总结，与导出文件 1:1 对应），支持直接编辑标题与要点
- 导出统一简约排版的 16:9 PPTX，共 5 页（封面 1 + 正文 3 + 总结 1），纯文本框可在 PowerPoint / WPS 中继续编辑
- 异常处理：JSON 解析失败自动修复重试一次；页数自动补齐/截断；前后端双重内容校验；生成/导出失败给出明确错误提示

## 技术架构

- **前端**：原生 HTML / CSS / JavaScript（ES Module），通过 `@anna-ai/app-runtime` SDK 与宿主通信
  - `anna.llm.complete` — 生成内容
  - `anna.tools.invoke` — 调用后端 Executa 渲染 PPTX
  - `anna.files.download` — 平台官方文件交付（宿主顶层触发浏览器下载）
- **后端**：Python Executa（stdio JSON-RPC 插件）
  - `export_pptx`：校验 deck JSON → python-pptx 渲染 → 反向 RPC 上传 APS 文件存储（app scope）
- **数据格式**：JSON（`{title, subtitle, slides:[{title, bullets}]}`）

## 目录结构

```
my-focus-flow/
├── app.json                  # 应用名称/简介（发布元数据）
├── manifest.json             # Anna App 清单（host_api ACL、host_capabilities）
├── bundle/                   # 前端静态资源
│   ├── index.html
│   ├── app.js                # 主流程（生成/预览/导出）
│   └── deck-utils.js         # 纯函数：JSON 提取/规范化/prompt 构建
├── executas/focus-flow/      # Python Executa
│   ├── focus_flow_plugin.py  # ping / create_pptx(冒烟) / export_pptx
│   └── pyproject.toml        # 依赖 python-pptx
└── tests/                    # Mock 测试 + E2E（不消耗 AI 额度）
    ├── deck-utils.test.mjs
    ├── export-pptx.mock.test.py
    └── e2e-stage3.mjs
```

## 本地开发

```bash
anna-app login                # 登录 staging（一次性）
cd my-focus-flow
anna-app dev --storage aps    # 必须带 --storage aps（PPTX 上传依赖真实 APS 存储）
# 打开 http://localhost:5180/ ，刷新页面后使用
```

> 注意：harness 重启后浏览器页面需要刷新（会话与 harness 进程绑定）。

## 测试

```bash
node tests/deck-utils.test.mjs            # 前端解析逻辑（纯 Mock，16 例）
python tests/export-pptx.mock.test.py     # 插件渲染/校验（Mock host，5 例）
# 以下需要 harness 运行中，消耗极少 AI 额度（1 次 LLM 调用）：
node tests/e2e-stage3.mjs "你的主题"       # 真实 LLM → 导出 → 下载 全链路
anna-app validate --strict
```

## 已验证的关键机制

- LLM：`anna.llm.complete`（host 代理真实模型，计费 ~0.01 CU/次）
- 文件交付：插件反向 RPC `files/upload_begin` → 直连 PUT 预签名 URL（**必须携带 init 返回的签名 headers 与 `scope: "app"`**）→ `files/upload_complete`；前端 `anna.files.download` 由宿主顶层消费预签名 URL 触发浏览器保存
- 权限：manifest 需声明 `host_capabilities: ["aps.files"]` 及 `host_api.files/llm/tools`，否则生产环境不 mint storage token

## 发布（staging）

```bash
anna-app apps publish         # 或 anna-app publish（自动识别）
```

发布流程（`--dry-run` 可先行验证）：先发布 `app.json bundled_executas` 声明的
bundled Executa（`./executas/focus-flow`），再把平台分配的 tool_id 代入
manifest 中所有 `bundled:focus-flow` 引用，并生成 `bundle/anna-tool-ids.js`
供前端读取。发布与版本操作需要显式授权后进行，详见 `anna-app apps --help`。
