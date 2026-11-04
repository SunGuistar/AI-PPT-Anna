# AIppt

基于 Anna 平台的**纯前端** AI 演示文稿应用：输入主题与要求，AI 生成**内容型大纲**，确认后前端直接生成 PPT，支持逐页预览、内联编辑、主题切换，一键导出可在 PowerPoint / WPS 中继续编辑的 PPTX。

- **纯前端**：原生 HTML/CSS/JavaScript，零依赖、零构建，无任何后端或插件
- **大纲工作流**：AI 生成大纲 → 手动编辑/增删/排序 → 自然语言反复更新（AI 只参与大纲，确认后生成 PPT **零 AI 调用**）
- **AI**：Anna Host API `anna.llm.complete`
- **PPTX 导出**：浏览器端手写 OOXML + ZIP；排版由 **DOM 实测驱动**（离屏量取预览真实布局），主题背景/渐变/字体/颜色全映射，中文走 `a:ea` 中文字体
- **文件交付**：Anna 官方 APS 接口（`files.upload_init` → 直连 PUT → `upload_finalize` → `files.download`），下载文件名 = 输入主题
- **UI 基于开源 [SlideForge](https://github.com/vincenzo-afk/SlideForge)（MIT）**，见 `licenses/SLIDEFORGE-LICENSE`

## 使用流程

1. 输入 **PPT 主题**（必填）、页数（3–20）、目标受众、演讲语气、补充说明（可选）
2. 点 **生成大纲**（1 次 AI 调用）→ 进入大纲编辑页
3. 直接修改标题/要点、删除、上下移动页面；或输入**补充修改要求**点 **更新大纲**（每次 1 次 AI 调用，默认保留未修改页面与你的手动编辑）
4. 点 **确认大纲，生成 PPT**（**0 次 AI 调用**）→ 进入预览编辑
5. 预览、✎ 编辑文字、下拉切换主题、↩ 返回大纲（已修改会提示覆盖）
6. 点 **⭳ 下载 PPT** → 浏览器保存 `<主题>.pptx`

## 目录结构

```
my-focus-flow/
├── app.json / manifest.json   # Anna App 元数据与权限声明（无 Executa）
├── bundle/                    # 前端静态资源（入口 index.html）
│   ├── index.html             # 输入页 + 大纲编辑页 + PPT 编辑器
│   ├── css/style.css
│   ├── js/
│   │   ├── outline.js         # 大纲 prompt / 校验 / outlineToDeck 确定性转换
│   │   ├── anna-adapter.js    # Anna 适配层：AI 调用 + APS 文件交付
│   │   ├── export.js          # PPTX 导出（DOM 实测排版 + 主题映射）
│   │   └── …                  # SlideForge 模块（slides/editor/ai/app/config）
│   └── assets/                # 图标（应用图标 assets/favicon.ico）
├── licenses/SLIDEFORGE-LICENSE
├── samples/preview.html       # 预览对照页（node tests/make-preview.mjs 生成）
└── tests/                     # node 回归测试（零 AI 消耗）
```

## 本地开发

```bash
anna-app login                      # 一次性
cd my-focus-flow
anna-app dev --storage aps          # 必须带 --storage aps（APS 文件交付）
# 打开 http://localhost:5180/ ，Ctrl+F5 刷新后使用
```

免 AI 调试参数（iframe URL 加参数）：

- `?sample=outline` — 加载固定大纲样例，直接测大纲编辑/确认流程
- `?sample=1` — 加载固定 PPT 样例，直接测导出排版

## 测试

```bash
node tests/outline.test.mjs     # 大纲流程 + AI 调用计数契约（21 例）
node tests/export.test.mjs      # PPTX 包结构 + 主题映射（3 例）
node tests/layout.test.mjs      # 实测排版换算：坐标/字号/字体/行距/透明度（14 例）
node tests/wiring.test.mjs      # 配置与链路断言
anna-app validate --strict
```

## staging 发布

```bash
anna-app apps push              # 上传 draft
anna-app apps cut 0.x.0         # 固化版本
anna-app apps submit-review     # 提交审核（release 需平台管理员批准）
anna-app apps release 0.x.0     # 审核通过后 go live
```
