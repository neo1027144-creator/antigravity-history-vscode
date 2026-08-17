# Changelog

All notable changes to the "Antigravity History" extension will be documented in this file.

## [0.2.6] - 2026-08-17

### Added
- **单条导出双模切换（另存为弹窗 / 直接静默保存）**：
  - 新增 `aghistory.singleExportMode` 配置项（`dialog` 另存为弹窗 / `direct` 直接保存）。
  - Webview 控制栏新增单条导出模式下拉切换，支持在“点击 MD/JSON 弹出系统保存窗口”与“点击直接保存至默认/工作区目录”之间一键切换。
- **多语言国际化 (i18n) 与动态语言切换**：
  - 完整支持简体中文 (`zh-CN`，默认) 与英语 (`en`) 双语自由切换。
  - Webview 顶部控制栏新增语言下拉选择器，切换即时重绘，无需重启插件或重载窗口。
  - 新增 `aghistory.language` 全局配置项，自动记忆并持久化用户的语言偏好。
  - 新增 VS Code 扩展清单标准多语言资源文件 `package.nls.json` 与 `package.nls.zh-cn.json`。
- **全链路国际化适配**：
  - VS Code 状态栏 Tooltip、系统消息弹窗通知、另存为文件对话框过滤器与标题、批量导出报告（TXT）均适配当前选定语言。

## [0.2.5] - 2026-08-17

### Added
- **单条导出另存为弹窗交互**：点击会话卡片上的 MD 或 JSON 按钮时，唤起 VS Code 原生另存为文件对话框（Save Dialog），默认定位到该会话所属的项目工作区根目录，支持自由选择目标文件夹与自定义文件名保存。

### Fixed
- **项目工作区与数据目录资源管理器打开修复**：重构本地路径规范化函数与资源管理器调起逻辑，优先调用 VS Code 原生 `revealFileInOS` 并配备系统进程兜底，彻底解决 Windows 环境下点击项目路径及会话数据存储目录无法打开的问题。

### Improved
- **全量中文化与交互体验优化**：全面汉化面板日期分组、空状态提示、加载状态及操作通知，增强路径不存在时的中文警示提示。

## [0.2.4] - 2026-08-14

### Improved
- **安全加固与多实例探测优化**：
  - 增强 LanguageServer 进程发现与 CSRF 动态嗅探逻辑，提升多工作区或多实例并发运行时的会话索引稳定性。
  - 优化 esbuild 构建与打包脚本，强化发布产物安全。

## [0.2.3] - 2026-08-14

### Added
- **按所属项目工作区归类导出（双模式）**：
  - 新增 `aghistory.exportStrategy` 配置项（`workspace` / `unified`），支持按会话所属的项目工作区自动归类导出或统一主目录扁平导出。
  - Webview 顶栏新增导出归属模式快速切换下拉选择器。
- **中文标题与文件命名增强**：
  - 导出文件名完整保留中文、英文字符及常见符号，自动过滤操作系统非法字符。
  - 单条导出完成后弹出系统通知，并提供“打开文件”与“打开所在文件夹”快速直达。

## [0.2.2] - 2026-08-14

### Fixed
- **适配 Antigravity 2.5.5+ 架构变动**：
  - 适配新版本应用数据目录路径迁移（支持 `.gemini/antigravity-ide` 与 `.gemini/antigravity` 多目录混合扫描）。
  - 解决新版下历史会话无法被扫描和展示的问题，磁盘物理会话全量优先读取与平滑后台元数据回填。

## [0.2.1] - 2026-03-31

### Fixed
- **Recovery 机制修复**：修复最新对话无法出现在面板的 bug
  - `endIndex: 1` -> `5`：请求更多步骤确保 LS 完成对大型对话的索引写入
  - Recovery 成功后增加 500ms 等待，避免在 LS 异步写入完成前就重新拉取列表

## [0.1.9] - 2026-03-17

### Fixed
- **Export All 导出问题修复**：修复导出文件夹只有报告 txt 而无 md/json 的问题
  - 根因：`handleExport` 在无 endpoint 时静默 return 不抛异常，导致错误统计失效
  - 新增空数据检测（API 返回空 steps 时标记为失败）
  - `exportFormat` fallback 默认值修正为 `'all'`（与 package.json 一致）

### Improved
- 导出报告增加 `Format`/`Level`/`Output` 字段，失败项明确标记 FAILED
- 导出文件夹名增加 fieldLevel 后缀（如 `export_20260317_172457_full`）
- 全链路 `[AG-DEBUG]` 调试日志（可通过开发者控制台查看）

## [0.1.0] - 2026-03-14

### Added
- Conversation dashboard — browse all AI conversations grouped by date
- Search conversations by title
- Export individual conversations as Markdown or JSON
- Bulk export all conversations with one click
- Configurable export path, format, and detail level (default / thinking / full)
- 100% local, read-only, zero telemetry
- Status bar quick access button (`AG History`)
- Support for Windows, macOS, and Linux
- Compatible with Antigravity IDE and VS Code
