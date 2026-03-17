# Changelog

All notable changes to the "Antigravity History" extension will be documented in this file.

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
