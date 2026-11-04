# DEVELOPMENT_PLAN

## 项目现状
纯前端 Anna AI PPT 应用「AIppt」：输入要求 → AI 生成内容型大纲 → 编辑/更新 → 确认后前端直接生成 PPT → 预览编辑 → 导出可编辑 PPTX。无后端、无插件。

## 已完成的阶段

### 阶段 1-2：Anna Executa 路线（已完成，已废弃）
- Python Executa + python-pptx 打通 PPTX 生成与 APS 文件链路 ✅
- 因 Cloud Agent 无法加载 Python 插件，整条路线废弃，代码已删除

### 阶段 3：纯前端迁移 ✅
- 迁移 SlideForge（MIT）为应用主体，新增 anna-adapter.js 适配 Anna AI 与 APS 交付
- 修复 SlideForge 导出器 3 处 OOXML bug（原版导出文件无法打开）
- manifest/app.json 去除全部 Executa 绑定
- staging v0.3.0

### 阶段 4：清理 ✅
- 删除 Python Executa、Binary Distribution（PyInstaller/GitHub Actions）、旧测试
- 新增 node 回归测试（零 AI 消耗）

### PPTX 与预览排版一致性 ✅
- 主题映射：渐变背景（CSS 角度→OOXML 双锚点验证）、字体、前景色、透明度
- DOM 实测排版：离屏 960×540 量取 getBoundingClientRect/getComputedStyle，px→EMU/pt 换算
- 中文字体：OOXML a:latin + a:ea 分离，中文用系统实测可用中文字体
- 修复：导出无字（innerText 依赖渲染态）、8 要点溢出、hashchange 失效空白页

### 产品化：AIppt ✅
- 全中文化；更名 AIppt（slug 不变）；表单区加宽、补充说明输入框
- 下载文件名 = 输入主题（保留中文）；应用图标 assets/favicon.ico
- 预设主题中文化 + 主题下拉选择

### 大纲工作流 ✅
- AI 生成内容型大纲（1 次调用）；手动编辑/删除/排序（0 次）
- 自然语言更新大纲：初始要求+当前大纲+本轮要求（每次 1 次调用，失败保留原大纲）
- 确认大纲后纯前端生成 PPT（0 次 AI 调用）；「返回大纲」带覆盖提示
- 稳定性：maxTokens 4000、输出容错解析（原始换行/尾逗号）、解析失败自动修复重试

## 待办
- [ ] staging v0.3.2 管理员审核 → release 上线
- [ ] 预览与导出的图片一致性（需 AI 配图能力，未开始）
- [ ] 背景图 AI 生成
