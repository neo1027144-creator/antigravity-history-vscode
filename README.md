# 🔮 Antigravity History

**Browse, search, and export your Antigravity AI conversations** — right inside your IDE.

View all your AI pair-programming sessions in one place. Export conversations as Markdown or JSON for documentation, knowledge management, or backup.

## ✨ Features

### 📋 Conversation Dashboard
- See **all conversations** at a glance, grouped by date
- Quick search by title
- Conversation stats: step count, timestamps, workspace info

### 📤 One-Click Export
- Export individual conversations as **Markdown** or **JSON**
- **Bulk export** all conversations with one click
- Configurable export path and detail level

### 🔒 Privacy First
- **100% local** — all data stays on your machine
- **Read-only** — never modifies your Antigravity data
- **No telemetry** — zero external network requests

## 📦 Installation

### Antigravity IDE (OpenVSX)
1. Open Extensions panel (`Ctrl+Shift+X`)
2. Search for "Antigravity History"
3. Click Install

### VS Code
1. Open Extensions panel (`Ctrl+Shift+X`)
2. Search for "Antigravity History"
3. Click Install

> **Note:** This extension requires a running Antigravity instance to detect conversations.

## 🚀 Usage

1. Click **`AG History`** in the bottom status bar (or run `Antigravity History: Open` from Command Palette)
2. The conversation dashboard opens as an editor tab
3. Browse your conversations, grouped by date
4. Click **MD** or **JSON** to export individual conversations
5. Click **Export All** to bulk export everything

## ⚙️ Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `aghistory.exportPath` | `./antigravity_export` | Default export directory |
| `aghistory.exportFormat` | `md` | Default format: `md`, `json`, or `all` |
| `aghistory.fieldLevel` | `thinking` | Detail level: `default`, `thinking`, or `full` |

### Field Levels Explained

- **default**: User messages + AI responses + tool call summaries
- **thinking**: + AI reasoning chains, timestamps, exit codes
- **full**: + code diffs, command outputs, search results, model info

## 🛠️ Requirements

- Antigravity IDE 1.1+ or VS Code 1.85+
- A running Antigravity instance with at least one conversation

## 📝 License

Apache-2.0

## 🔗 Links

- [GitHub Repository](https://github.com/neo1027144-creator/antigravity-history-vscode)
- [CLI Tool (pip install)](https://pypi.org/project/antigravity-history/)
- [Report Issues](https://github.com/neo1027144-creator/antigravity-history-vscode/issues)
