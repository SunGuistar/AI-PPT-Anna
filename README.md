# AIppt

基于 Anna 平台的**纯前端** AI 演示文稿应用 AIppt：输入主题、页数、受众与语气，Anna AI 生成完整幻灯片（含主题配色），支持逐页预览、内联文字编辑、增删/排序幻灯片、切换主题，一键导出可在 PowerPoint / WPS 中继续编辑的 PPTX。

- **纯前端**：原生 HTML/CSS/JavaScript，零依赖、零构建，无任何后端或插件
- **AI**：Anna Host API `anna.llm.complete`
- **PPTX 导出**：浏览器端手写 OOXML + ZIP（零依赖），文字/形状原生可编辑
- **文件交付**：Anna 官方 APS 接口（`files.upload_init` → 直连 PUT → `upload_finalize` → `files.download`）
- **UI 基于开源 [SlideForge](https://github.com/vincenzo-afk/SlideForge)（MIT）**，见 `licenses/SLIDEFORGE-LICENSE`

## 目录结构

```
my-focus-flow/
├── app.json / manifest.json   # Anna App 元数据与权限声明（无 Executa）
├── bundle/                    # 前端静态资源（入口 index.html）
│   ├── index.html             # 生成表单 + 编辑器视图
│   ├── css/style.css
│   ├── js/                    # SlideForge 模块 + anna-adapter.js 适配层
│   └── assets/                # 图标
├── licenses/SLIDEFORGE-LICENSE
└── tests/export.test.mjs      # PPTX 导出回归测试（node tests/export.test.mjs）
```

## 本地开发

```bash
anna-app login                      # 一次性
cd my-focus-flow
anna-app dev --storage aps          # 必须带 --storage aps（APS 文件交付）
# 打开 http://localhost:5180/ ，Ctrl+F5 刷新后使用
```

## 测试

```bash
node tests/export.test.mjs          # PPTX 包结构回归（离线，零 AI 消耗）
anna-app validate --strict
```

## staging 发布

```bash
anna-app apps push                  # 上传 draft
anna-app apps cut 0.x.0             # 固化版本（需授权）
# apps release / 提交审核需显式授权
```
