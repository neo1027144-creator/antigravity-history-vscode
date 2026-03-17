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
  getTimestamp,
} from './formatter.js';
import type { ConversationRecord } from './formatter.js';

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
          folderPath = decodeURIComponent(folderPath.replace(/^file:\/\/\//i, ''));
          if (folderPath) {
            vscode.env.openExternal(vscode.Uri.file(folderPath));
          }
          break;
        }
        case 'changeExportPath': {
          const picked = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Select Export Folder',
          });
          if (picked && picked[0]) {
            const newPath = picked[0].fsPath;
            await vscode.workspace.getConfiguration('aghistory').update('exportPath', newPath, true);
            postMessage({ command: 'setExportPath', path: newPath });
          }
          break;
        }
        case 'openExportFolder': {
          const config = vscode.workspace.getConfiguration('aghistory');
          const ep = resolveExportPath(config.get<string>('exportPath', './antigravity_export'));
          vscode.env.openExternal(vscode.Uri.file(ep));
          break;
        }
        case 'setFieldLevel': {
          const val = message.value;
          if (['default', 'thinking', 'full'].includes(val)) {
            await vscode.workspace.getConfiguration('aghistory').update('fieldLevel', val, true);
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

    // Send current export path to webview
    const exportDir = resolveExportPath(
      vscode.workspace.getConfiguration('aghistory').get<string>('exportPath', './antigravity_export'),
    );
    postMessage({ command: 'setExportPath', path: exportDir });

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

    // Step 4: Detect conversations cleaned by Antigravity (in cache but .pb deleted)
    const convDir = getConvDir();
    const cleanedIds: string[] = [];
    for (const id of Object.keys(cachedConversations)) {
      const pbFile = path.join(convDir, `${id}.pb`);
      if (!fs.existsSync(pbFile)) {
        cleanedIds.push(id);
      }
    }
    if (cleanedIds.length > 0) {
      // Remove cleaned entries from cache
      for (const id of cleanedIds) {
        delete cachedConversations[id];
        delete cachedEndpointMap[id];
      }
      postMessage({ command: 'setConversations', data: cachedConversations, convDir });
      vscode.window.showWarningMessage(
        `${cleanedIds.length} conversation(s) were auto-cleaned by Antigravity (100-limit). Consider using "Export All" to backup.`,
        'Export All',
      ).then((choice) => {
        if (choice === 'Export All') { handleExportAll(); }
      });
    }

    // Step 5: Persist to disk cache
    writeCache(cachedConversations);
  } catch (e) {
    postMessage({ command: 'error', text: `Discovery failed: ${e}` });
  }
}

async function handleExport(
  cascadeId: string, format: string,
  overrideDir?: string, overrideTs?: string,
  jsonCollector?: ConversationRecord[],
): Promise<void> {
  // Try specific endpoint first, fallback to any available endpoint
  let ep: { port: number; csrf: string } | undefined = cachedEndpointMap[cascadeId];
  if (!ep) {
    const anyId = Object.keys(cachedEndpointMap)[0];
    if (anyId) { ep = cachedEndpointMap[anyId]; }
  }
  if (!ep) {
    throw new Error('No LS endpoint available. Try refreshing.');
  }

  const config = vscode.workspace.getConfiguration('aghistory');
  const fieldLevel = config.get<string>('fieldLevel', 'thinking') as FieldLevel;
  const ts = overrideTs || getTimestamp();
  const outputDir = overrideDir || path.join(
    resolveExportPath(config.get<string>('exportPath', './antigravity_export')),
    `export_${ts}`,
  );

  try {
    console.log(`[AG-DEBUG] handleExport cid=${cascadeId.slice(0, 8)} format=${format} dir=${outputDir}`);
    const steps = await getTrajectorySteps(ep.port, ep.csrf, cascadeId);
    console.log(`[AG-DEBUG] got ${steps?.length ?? 0} steps for ${cascadeId.slice(0, 8)}`);
    if (!steps || steps.length === 0) {
      throw new Error(`No steps returned for ${cascadeId.slice(0, 8)} (API may be unavailable)`);
    }
    const messages = parseSteps(steps, fieldLevel);

    const cached = cachedConversations[cascadeId];
    const title = cached?.summary || `conversation_${cascadeId.slice(0, 8)}`;
    const metadata: TrajectorySummary = cached || { stepCount: steps.length };

    if (format === 'md' || format === 'all') {
      const md = formatMarkdown(title, cascadeId, metadata, messages);
      const mdPath = writeConversation(md, title, outputDir, '.md', ts);
      console.log(`[AG-DEBUG] wrote MD: ${mdPath}`);
      postMessage({ command: 'exportDone', text: `Exported: ${path.basename(mdPath)}` });
    }
    if (format === 'json' || format === 'all') {
      const record = buildConversationRecord(cascadeId, title, metadata, messages);
      if (jsonCollector) {
        // Batch mode: collect into array, write combined file later
        jsonCollector.push(record);
        console.log(`[AG-DEBUG] collected JSON record for ${cascadeId.slice(0, 8)}`);
      } else {
        // Single export: write individual json file
        const jsonStr = formatJson([record]);
        const jsonPath = writeConversation(jsonStr, title, outputDir, '.json', ts);
        console.log(`[AG-DEBUG] wrote JSON: ${jsonPath}`);
        postMessage({ command: 'exportDone', text: `Exported: ${path.basename(jsonPath)}` });
      }
    }
  } catch (e) {
    vscode.window.showErrorMessage(`Export failed: ${e}`);
    throw e;  // Re-throw so caller can count failures
  }
}

async function handleExportAll(): Promise<void> {
  const cascadeIds = Object.keys(cachedConversations);
  if (cascadeIds.length === 0) {
    vscode.window.showWarningMessage('No conversations to export. Try refreshing first.');
    return;
  }

  // Guard: if endpoints not yet discovered (user clicked too fast), auto-refresh first
  if (Object.keys(cachedEndpointMap).length === 0) {
    vscode.window.showInformationMessage('Waiting for LS discovery to complete...');
    await handleRefresh();
    if (Object.keys(cachedEndpointMap).length === 0) {
      vscode.window.showErrorMessage('No LS endpoint available. Is Antigravity running?');
      return;
    }
  }

  const config = vscode.workspace.getConfiguration('aghistory');
  const exportFormat = config.get<string>('exportFormat', 'all');
  const fieldLevel = config.get<string>('fieldLevel', 'thinking') as FieldLevel;
  const exportPath = config.get<string>('exportPath', './antigravity_export');
  const ts = getTimestamp();
  const outputDir = path.join(resolveExportPath(exportPath), `export_${ts}_${fieldLevel}`);

  console.log(`[AG-DEBUG] handleExportAll: format=${exportFormat} fieldLevel=${fieldLevel} outputDir=${outputDir}`);
  console.log(`[AG-DEBUG] handleExportAll: endpoints=${Object.keys(cachedEndpointMap).length} conversations=${cascadeIds.length}`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Exporting conversations',
      cancellable: true,
    },
    async (progress, token) => {
      let done = 0;
      let failed = 0;
      const total = cascadeIds.length;
      const jsonCollector: ConversationRecord[] = [];
      const failedIds: string[] = [];

      for (const cid of cascadeIds) {
        if (token.isCancellationRequested) { break; }

        progress.report({
          message: `${done + 1} / ${total}`,
          increment: (1 / total) * 100,
        });

        try {
          await handleExport(cid, exportFormat, outputDir, ts, jsonCollector);
        } catch (e) {
          console.log(`[AG-DEBUG] export failed for ${cid.slice(0, 8)}: ${e}`);
          failedIds.push(cid);
          failed++;
        }
        done++;
      }

      console.log(`[AG-DEBUG] handleExportAll done: ${done - failed}/${total} ok, ${failed} failed`);

      // Write combined JSON file
      if ((exportFormat === 'json' || exportFormat === 'all') && jsonCollector.length > 0) {
        const combinedJson = formatJson(jsonCollector);
        const jsonPath = path.join(outputDir, `conversations_export_${ts}.json`);
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(jsonPath, combinedJson, 'utf-8');
        console.log(`[AG-DEBUG] wrote combined JSON: ${jsonPath} (${jsonCollector.length} records)`);
      }

      // Generate export report
      const reportLines: string[] = [
        '============================================================',
        '  EXPORT REPORT',
        '============================================================',
        '',
        `  Time:      ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
        `  Format:    ${exportFormat}`,
        `  Level:     ${fieldLevel}`,
        `  Output:    ${outputDir}`,
        `  Total:     ${total}`,
        `  Exported:  ${done - failed}`,
        `  Failed:    ${failed}`,
        '',
        '------------------------------------------------------------',
        `  EXPORTED CONVERSATIONS (${done - failed})`,
        '------------------------------------------------------------',
      ];
      let idx = 1;
      for (const cid of cascadeIds) {
        const conv = cachedConversations[cid];
        const title = conv?.summary || `[unknown] ${cid.slice(0, 8)}...`;
        const steps = conv?.stepCount ?? '?';
        const status = failedIds.includes(cid) ? ' ❌ FAILED' : '';
        reportLines.push(`  ${String(idx).padStart(3)}. ${title}${status}`);
        reportLines.push(`       Steps: ${steps}  |  ID: ${cid.slice(0, 8)}...`);
        idx++;
      }
      reportLines.push('', '============================================================');
      const reportPath = path.join(outputDir, `export_report_${ts}.txt`);
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(reportPath, reportLines.join('\n'), 'utf-8');

      const choice = await vscode.window.showInformationMessage(
        `Exported ${done - failed} conversations (${failed} failed) to ${outputDir}`,
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
      <button class="seg-btn active" id="group-date">Date</button>
      <button class="seg-btn" id="group-workspace">Workspace</button>
    </div>
    <div class="segmented-control">
      <button class="seg-btn" id="btn-expand-all" title="Expand All">▾ Expand</button>
      <button class="seg-btn" id="btn-collapse-all" title="Collapse All">▸ Collapse</button>
    </div>
    <button class="btn btn-icon" id="btn-refresh" title="Refresh">↻</button>
    <select class="field-level-select" id="field-level-select" title="Export detail level">
      <option value="default">Basic</option>
      <option value="thinking" selected>+ Thinking</option>
      <option value="full">Full (all)</option>
    </select>
    <button class="btn btn-primary" id="btn-export-all">Export All</button>
  </div>
  <div class="stats-bar" id="stats-bar"></div>
  <div class="export-path-bar" id="export-path-bar"></div>
  <div id="list-container"></div>
  <div class="toast" id="toast"></div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
