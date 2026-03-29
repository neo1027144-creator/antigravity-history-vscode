# Changelog

All notable changes to the "Antigravity History" extension will be documented in this file.

## [0.2.0] - 2026-03-30

### Fixed
- 🐛 **Recovery 机制修复**：修复最新对话无法出现在面板的 bug
  - `endIndex: 1` → `5`：请求更多步骤确保 LS 完成对大型对话的索引写入
  - Recovery 成功后增加 500ms 等待，避免在 LS 异步写入完成前就重新拉取列表

### Improved
- 🐧 **Linux 兼容性增强**（参考社区 PR #2）
  - `discoverLinux()` 优先读取 `/proc/${pid}/cmdline`（比 `ps` 更可靠，支持容器环境）
  - `findPortsUnix()` 升级为三级 fallback：`lsof` → `ss` → `netstat`，提升无 `lsof` 环境下的兼容性

## [0.1.9] - 2026-03-17


### Fixed
- 🐛 **Export All 导出 bug**：修复导出文件夹只有报告 txt 而无 md/json 的严重 bug
  - 根因：`handleExport` 在无 endpoint 时静默 `return` 不抛异常，导致错误统计失效
  - 新增空数据检测（API 返回空 steps 时标记为失败）
  - `exportFormat` fallback 默认值修正为 `'all'`（与 package.json 一致）

### Improved
- 📊 导出报告增加 `Format`/`Level`/`Output` 字段，失败项标记 ❌ FAILED
- 📁 导出文件夹名增加 fieldLevel 后缀（如 `export_20260317_172457_full`）
- 🔍 全链路 `[AG-DEBUG]` 调试日志（可通过开发者控制台查看）

## [0.1.0] - 2026-03-14

### Added
- 🔮 Conversation dashboard — browse all AI conversations grouped by date
- 🔍 Search conversations by title
- 📤 Export individual conversations as Markdown or JSON
- 📦 Bulk export all conversations with one click
- ⚙️ Configurable export path, format, and detail level (default / thinking / full)
- 🔒 100% local, read-only, zero telemetry
- Status bar quick access button (`AG History`)
- Support for Windows, macOS, and Linux
- Compatible with Antigravity IDE and VS Code
