/**
 * Panel Manager — creates and manages the Webview Panel for conversation browsing.
 *
 * Architecture: Editor Tab (Webview Panel) triggered by status bar button or command.
 * Same pattern as "Antigravity Auto Accept: Control Panel".
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { discoverAndListAll, getAllTrajectories, getTrajectorySteps, TrajectorySummary } from './ls-client.js';
import { recoverUnindexed } from './recovery.js';
import { readCache, writeCache } from './cache.js';
import { parseSteps, FieldLevel } from './parser.js';
import {
  formatMarkdown,
  buildConversationRecord,
  formatJson,
  writeConversation,
  safeFilename,
} from './formatter.js';

let currentPanel: vscode.WebviewPanel | undefined;
let cachedEndpointMap: Record<string, { port: number; csrf: string }> = {};
let cachedConversations: Record<string, TrajectorySummary> = {};

export function openPanel(context: vscode.ExtensionContext): void {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    'aghistory.panel',
    'Antigravity History',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
      ],
    },
  );

  currentPanel.webview.html = getWebviewHtml(currentPanel.webview, context.extensionUri);

  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
  }, null, context.subscriptions);

  // ── Handle messages from webview ──
  currentPanel.webview.onDidReceiveMessage(
    async (message) => {
      switch (message.command) {
        case 'refresh':
          await handleRefresh();
          break;
        case 'export':
          await handleExport(message.cascadeId, message.format);
          break;
        case 'exportAll':
          await handleExportAll();
          break;
        case 'copyId':
          if (message.cascadeId) {
            await vscode.env.clipboard.writeText(message.cascadeId);
            vscode.window.showInformationMessage('Cascade ID copied!');
          }
          break;
        case 'openInExplorer': {
          let folderPath: string = message.path || '';
          // Convert file:// URI to local path (case-insensitive)
          folderPath = decodeURIComponent(folderPath.replace(/^file:\/\/\//i, ''));
          if (folderPath) {
            vscode.env.openExternal(vscode.Uri.file(folderPath));
          }
          break;
        }
      }
    },
    undefined,
    context.subscriptions,
  );
}

export function refreshPanel(): void {
  if (currentPanel) {
    handleRefresh();
  }
}

// ── Handlers ──

async function handleRefresh(): Promise<void> {
  try {
    // Step 0: Show cached data instantly (IDE restart scenario)
    const cached = readCache();
    if (Object.keys(cached).length > 0 && Object.keys(cachedConversations).length === 0) {
      cachedConversations = cached;
      postMessage({ command: 'setConversations', data: cachedConversations, convDir: getConvDir() });
    }

    // Step 1: Discover LS instances and get indexed conversations
    const result = await discoverAndListAll();
    cachedEndpointMap = result.cascadeToEndpoint;
    cachedConversations = { ...cachedConversations, ...result.conversations };

    postMessage({ command: 'setConversations', data: cachedConversations, convDir: getConvDir() });

    // Step 2: Auto-recover unindexed conversations
    if (result.endpoints.length > 0) {
      const indexedIds = new Set(Object.keys(cachedConversations));
      const epList = result.endpoints.map((e) => ({ port: e.port, csrf: e.csrf }));

      const recovery = await recoverUnindexed(
        indexedIds, epList,
        (done: number, total: number) => {
          postMessage({ command: 'recoverProgress', done, total });
        },
      );

      // Step 3: If we recovered anything, re-fetch the full list
      if (recovery.activated > 0) {
        const refreshed = await discoverAndListAll();
        cachedEndpointMap = refreshed.cascadeToEndpoint;
        cachedConversations = { ...cachedConversations, ...refreshed.conversations };
        postMessage({ command: 'setConversations', data: cachedConversations, convDir: getConvDir() });
        postMessage({ command: 'recoverDone', activated: recovery.activated, total: recovery.total });
      }
    }

    // Step 4: Persist to disk cache
    writeCache(cachedConversations);
  } catch (e) {
    postMessage({ command: 'error', text: `Discovery failed: ${e}` });
  }
}

async function handleExport(cascadeId: string, format: string): Promise<void> {
  const ep = cachedEndpointMap[cascadeId];
  if (!ep) {
    vscode.window.showErrorMessage('Endpoint not found. Try refreshing.');
    return;
  }

  const config = vscode.workspace.getConfiguration('aghistory');
  const exportPath = config.get<string>('exportPath', './antigravity_export');
  const fieldLevel = config.get<string>('fieldLevel', 'thinking') as FieldLevel;
  const outputDir = resolveExportPath(exportPath);

  try {
    const steps = await getTrajectorySteps(ep.port, ep.csrf, cascadeId);
    const messages = parseSteps(steps, fieldLevel);

    // Use cached summary for title and metadata
    const cached = cachedConversations[cascadeId];
    const title = cached?.summary || `conversation_${cascadeId.slice(0, 8)}`;
    const metadata: TrajectorySummary = cached || { stepCount: steps.length };

    if (format === 'md' || format === 'all') {
      const md = formatMarkdown(title, cascadeId, metadata, messages);
      const mdPath = writeConversation(md, title, outputDir, '.md');
      postMessage({ command: 'exportDone', text: `Exported: ${path.basename(mdPath)}` });
    }
    if (format === 'json' || format === 'all') {
      const record = buildConversationRecord(cascadeId, title, metadata, messages);
      const jsonStr = formatJson([record]);
      const jsonPath = writeConversation(jsonStr, title, outputDir, '.json');
      postMessage({ command: 'exportDone', text: `Exported: ${path.basename(jsonPath)}` });
    }
  } catch (e) {
    vscode.window.showErrorMessage(`Export failed: ${e}`);
  }
}

async function handleExportAll(): Promise<void> {
  const cascadeIds = Object.keys(cachedEndpointMap);
  if (cascadeIds.length === 0) {
    vscode.window.showWarningMessage('No conversations to export. Try refreshing first.');
    return;
  }

  const config = vscode.workspace.getConfiguration('aghistory');
  const exportFormat = config.get<string>('exportFormat', 'md');
  const fieldLevel = config.get<string>('fieldLevel', 'thinking') as FieldLevel;
  const exportPath = config.get<string>('exportPath', './antigravity_export');
  const outputDir = resolveExportPath(exportPath);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Exporting conversations',
      cancellable: true,
    },
    async (progress, token) => {
      let done = 0;
      const total = cascadeIds.length;

      for (const cid of cascadeIds) {
        if (token.isCancellationRequested) { break; }

        progress.report({
          message: `${done + 1} / ${total}`,
          increment: (1 / total) * 100,
        });

        try {
          await handleExport(cid, exportFormat);
        } catch {
          // Skip failed exports silently
        }
        done++;
      }

      const choice = await vscode.window.showInformationMessage(
        `Exported ${done} conversations to ${outputDir}`,
        'Open Folder',
      );
      if (choice === 'Open Folder') {
        vscode.env.openExternal(vscode.Uri.file(outputDir));
      }
    },
  );
}

// ── Helpers ──

function postMessage(msg: Record<string, unknown>): void {
  currentPanel?.webview.postMessage(msg);
}

function resolveExportPath(configPath: string): string {
  if (path.isAbsolute(configPath)) { return configPath; }
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return path.resolve(wsFolder || process.cwd(), configPath);
}

function getConvDir(): string {
  return path.join(require('os').homedir(), '.gemini', 'antigravity', 'conversations');
}

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const cssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'panel.css'),
  );
  const jsUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'panel.js'),
  );
  const nonce = crypto.randomBytes(16).toString('hex');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri}">
  <title>Antigravity History</title>
</head>
<body>
  <div class="top-bar">
    <input type="text" class="search-input" id="search-input" placeholder="Search conversations...">
    <div class="segmented-control">
      <button class="seg-btn active" id="group-date">📅 Date</button>
      <button class="seg-btn" id="group-workspace">📂 Workspace</button>
    </div>
    <div class="segmented-control">
      <button class="seg-btn" id="btn-expand-all" title="Expand All">▾ Expand</button>
      <button class="seg-btn" id="btn-collapse-all" title="Collapse All">▸ Collapse</button>
    </div>
    <button class="btn btn-icon" id="btn-refresh" title="Refresh">↻</button>
    <button class="btn btn-primary" id="btn-export-all">Export All</button>
  </div>
  <div class="stats-bar" id="stats-bar"></div>
  <div id="list-container"></div>
  <div class="toast" id="toast"></div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
