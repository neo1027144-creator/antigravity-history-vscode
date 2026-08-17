# Every prompt deserves a history.

[English](README.md) | [中文](README_CN.md)

[![OpenVSX](https://img.shields.io/open-vsx/dt/neo1027144/antigravity-history?label=OpenVSX%20Downloads&color=blueviolet)](https://open-vsx.org/extension/neo1027144/antigravity-history)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/yunfenghello/antigravity-history-vscode?style=social)](https://github.com/yunfenghello/antigravity-history-vscode)

> ⚠️ **Important:** Please make sure your **Antigravity IDE is updated to the latest version** before using this extension. Older versions may cause "Client is not running" errors and prevent conversations from loading. 👉 [**Download / Update Antigravity**](https://antigravity.google/releases)

**Browse, search, and export your Antigravity AI conversations — right inside your IDE.**

> *Never lose a brilliant solution, a debugging insight, or an architectural decision again.*

---

![Dashboard Overview](docs/screenshots/dashboard.png)

## Features

### 📋 Conversation Dashboard
- See **all conversations** at a glance, grouped by date or workspace
- Quick search by title
- Collapsible groups with expand/collapse all
- Conversation stats: step count, timestamps, status indicator

![Search & Filter](docs/screenshots/search.png)

### 📦 One-Click Export
- Export individual conversations as **Markdown** or **JSON**
- **Bulk export** all conversations with one click
- Configurable export path with visual path selector
- Export completion notification with "Open Folder" action

![Export in Action](docs/screenshots/export.png)

### 🔄 Auto Recovery
- Automatically discovers and recovers **unindexed conversations** from disk
- Progress bar showing recovery status
- Detects conversations auto-cleaned by Antigravity's 100-conversation limit
- Local JSON cache for **instant startup** after IDE restart

### 🔒 Privacy First
- **100% local** — all data stays on your machine
- **Read-only** — never modifies your Antigravity data
- **No telemetry** — zero external network requests

## Installation

### From VSIX (Manual)
1. Download the `.vsix` file from [Releases](https://github.com/yunfenghello/antigravity-history-vscode/releases)
2. In VS Code / Antigravity: `Ctrl+Shift+P` → `Install from VSIX`

### From OpenVSX
Search **"Antigravity History"** in the Extensions panel, or run:
```
ext install yunfenghello.antigravity-history
```

## Usage

1. Click the **AG History** button in the status bar (bottom of IDE)
2. The conversation panel opens as an editor tab
3. Browse, search, and export your conversations

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `aghistory.exportPath` | `./antigravity_export` | Default export directory |
| `aghistory.exportFormat` | `md` | Export format: `md`, `json`, or `all` |
| `aghistory.fieldLevel` | `thinking` | Detail level: `basic`, `full`, or `thinking` |

## Requirements

- [Antigravity](https://antigravity.google/releases) IDE (latest version recommended)
- At least one active workspace open in Antigravity
- Tested and verified on **Windows**

## Roadmap

- 🔜 Conversation content preview
- 🔜 Advanced search (by date range, workspace, step count)
- 🔜 Conversation tagging and favorites
- 🔜 Direct integration with Antigravity chat panel

## Related

## Acknowledgements

- Special thanks to the original author **Neo** ([@neo1027144-creator](https://github.com/neo1027144-creator)) for the initial project architecture and open source contribution.

## License

Apache 2.0 — see [LICENSE](LICENSE)
