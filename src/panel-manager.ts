/**
 * 面板管理器 — 创建并管理对话浏览与导出的 Webview 面板
 *
 * 核心功能：
 * - 响应状态栏按钮与命令，开启或聚焦 Antigravity History 面板
 * - 调度语言服务发现、未索引会话自动恢复、本地缓存管理
 * - 单条 MD / JSON 导出支持弹出系统保存文件对话框，默认定位会话关联的项目根目录
 * - 会话项目工作区及数据目录支持在系统文件资源管理器中精准打开
 * - 批量导出支持按会话工作区项目目录归类导出与统一目录扁平导出（双模式）
 * - 全流程中英文国际化支持，支持界面动态语言切换并持久化用户偏好
 *
 * 作者/更新时间: fengyun / 2026-08-17
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { discoverAndListAll, getTrajectorySteps, getLiveWorkingEndpoints, TrajectorySummary, LsEndpoint } from './ls-client.js';
import { recoverUnindexed, getCandidateConvDirs, getConversationsDir, scanDiskConversations } from './recovery.js';
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
import { t, getCurrentLanguage, Language } from './i18n.js';

let currentPanel: vscode.WebviewPanel | undefined;
let cachedEndpointMap: Record<string, { port: number; csrf: string; appDataDir?: string }> = {};
let cachedConversations: Record<string, TrajectorySummary> = {};
let detectedAppDataDirs: string[] = [];
let availableEndpoints: LsEndpoint[] = [];

/**
 * 标准化本地文件系统路径
 *
 * 清洗 file:// 与 file:/// 前缀、URI 编码、多余斜杠，并规范化操作系统路径格式
 *
 * @param rawPath 原始路径或 URI 字符串
 * @returns 规范化的物理路径
 */
export function normalizeLocalPath(rawPath: string): string {
  if (!rawPath) {
    return '';
  }
  let p = rawPath.trim();
  // 去除 file:/// 或 file:// 前缀
  if (/^file:\/\/\//i.test(p)) {
    p = p.replace(/^file:\/\/\//i, '');
  } else if (/^file:\/\//i.test(p)) {
    p = p.replace(/^file:\/\//i, '');
  }
  // URL 解码
  try {
    p = decodeURIComponent(p);
  } catch {
    // 若解码异常则保留原串
  }
  // 处理 Windows 盘符前多余的斜杠，例如 /E:/xxx -> E:/xxx 或 \E:\xxx -> E:\xxx
  p = p.replace(/^[\\\/]([a-zA-Z]:)/, '$1');
  // 规范化路径分隔符
  p = path.normalize(p);
  return p;
}

/**
 * 在操作系统资源管理器中打开指定路径或文件夹
 *
 * 优先调用 VS Code 原生命令 revealFileInOS，并在异常或特殊场景下使用 Node.js 子进程后备调用
 *
 * @param targetPath 目标物理路径或 URI
 * @returns 是否成功打开
 */
export async function openPathInExplorer(targetPath: string): Promise<boolean> {
  const cleanPath = normalizeLocalPath(targetPath);
  if (!cleanPath) {
    vscode.window.showWarningMessage(t('common.invalidPath'));
    return false;
  }

  // 校验目标路径是否存在
  if (!fs.existsSync(cleanPath)) {
    const parentDir = path.dirname(cleanPath);
    if (fs.existsSync(parentDir)) {
      vscode.window.showWarningMessage(t('common.pathNotExistTryParent', undefined, cleanPath));
      return openPathInExplorer(parentDir);
    }
    vscode.window.showErrorMessage(t('common.pathNotExist', undefined, cleanPath));
    return false;
  }

  try {
    const uri = vscode.Uri.file(cleanPath);
    await vscode.commands.executeCommand('revealFileInOS', uri);
    return true;
  } catch {
    // 后备机制：根据操作系统类型直接调起系统文件管理器
    try {
      const platform = process.platform;
      if (platform === 'win32') {
        child_process.exec(`explorer.exe "${cleanPath}"`);
      } else if (platform === 'darwin') {
        child_process.exec(`open "${cleanPath}"`);
      } else {
        child_process.exec(`xdg-open "${cleanPath}"`);
      }
      return true;
    } catch (fallbackErr) {
      vscode.window.showErrorMessage(t('common.cannotOpenExplorer', undefined, fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)));
      return false;
    }
  }
}

/**
 * 打开或显示历史记录 Webview 面板
 */
export function openPanel(context: vscode.ExtensionContext): void {
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.One);
    // 主动触发一次刷新确保数据最新
    handleRefresh();
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    'aghistory.panel',
    t('panel.title'),
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

  // 处理来自 Webview 的消息
  currentPanel.webview.onDidReceiveMessage(
    async (message) => {
      switch (message.command) {
        case 'refresh':
          await handleRefresh();
          break;
        case 'export': {
          const config = vscode.workspace.getConfiguration('aghistory');
          const singleMode = config.get<string>('singleExportMode', 'dialog');
          const isInteractive = singleMode !== 'direct';
          await handleExport(message.cascadeId, message.format, undefined, undefined, undefined, isInteractive);
          break;
        }
        case 'exportAll':
          await handleExportAll();
          break;
        case 'copyId':
          if (message.cascadeId) {
            await vscode.env.clipboard.writeText(message.cascadeId);
            vscode.window.showInformationMessage(t('common.copiedToClipboard'));
          }
          break;
        case 'openInExplorer': {
          if (message.path) {
            await openPathInExplorer(message.path);
          }
          break;
        }
        case 'changeExportPath': {
          const picked = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: t('dialog.selectExportFolder'),
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
          await openPathInExplorer(ep);
          break;
        }
        case 'setFieldLevel': {
          const val = message.value;
          if (['default', 'thinking', 'full'].includes(val)) {
            await vscode.workspace.getConfiguration('aghistory').update('fieldLevel', val, true);
          }
          break;
        }
        case 'setExportStrategy': {
          const val = message.value;
          if (['workspace', 'unified'].includes(val)) {
            await vscode.workspace.getConfiguration('aghistory').update('exportStrategy', val, true);
            postMessage({ command: 'setExportStrategy', strategy: val });
          }
          break;
        }
        case 'setSingleExportMode': {
          const val = message.value;
          if (val === 'dialog' || val === 'direct') {
            await vscode.workspace.getConfiguration('aghistory').update('singleExportMode', val, true);
            postMessage({ command: 'setSingleExportMode', mode: val });
          }
          break;
        }
        case 'setLanguage': {
          const lang = message.value;
          if (lang === 'zh-CN' || lang === 'en') {
            await vscode.workspace.getConfiguration('aghistory').update('language', lang, true);
            postMessage({ command: 'setLanguage', language: lang });
          }
          break;
        }
      }
    },
    undefined,
    context.subscriptions,
  );
}

/**
 * 外部调用的刷新方法
 */
export function refreshPanel(): void {
  if (currentPanel) {
    handleRefresh();
  }
}

/**
 * 获取指定会话关联的项目工作区绝对路径
 */
export function getConversationWorkspace(cascadeId: string): string | null {
  const conv = cachedConversations[cascadeId];
  if (!conv || !conv.workspaces || conv.workspaces.length === 0) {
    return null;
  }
  for (const ws of conv.workspaces) {
    if (ws.workspaceFolderAbsoluteUri) {
      const p = normalizeLocalPath(ws.workspaceFolderAbsoluteUri);
      if (p) {
        return p;
      }
    }
  }
  return null;
}

/**
 * 处理数据刷新完整生命周期（本地全量优先 + 平滑元数据回填）
 */
async function handleRefresh(): Promise<void> {
  try {
    const primaryConvDir = getConvDir();

    // 步骤 0：读取持久化本地缓存
    const localCache = readCache();
    cachedConversations = { ...localCache, ...cachedConversations };

    // 步骤 1：扫描磁盘上所有物理会话文件（全量会话）
    const candidateDirs = getCandidateConvDirs(detectedAppDataDirs);
    const diskItems = scanDiskConversations(candidateDirs);

    for (const item of diskItems) {
      if (!cachedConversations[item.id]) {
        cachedConversations[item.id] = {
          summary: `会话 ${item.id.slice(0, 8)}`,
          lastModifiedTime: item.mtime.toISOString(),
          createdTime: item.mtime.toISOString(),
          stepCount: 1,
        };
      }
    }

    // 同步当前语言与配置状态至 Webview
    const currentLang = getCurrentLanguage();
    postMessage({ command: 'setLanguage', language: currentLang });

    // 立即向前端推送全量会话列表
    postMessage({ command: 'setConversations', data: cachedConversations, convDir: primaryConvDir });

    // 同步导出配置状态至 Webview
    const config = vscode.workspace.getConfiguration('aghistory');
    const exportDir = resolveExportPath(config.get<string>('exportPath', './antigravity_export'));
    const exportStrategy = config.get<string>('exportStrategy', 'workspace');
    const singleExportMode = config.get<string>('singleExportMode', 'dialog');
    postMessage({ command: 'setExportPath', path: exportDir });
    postMessage({ command: 'setExportStrategy', strategy: exportStrategy });
    postMessage({ command: 'setSingleExportMode', mode: singleExportMode });

    // 步骤 2：扫描运行中的 LanguageServer 进程并获取当前已索引的会话
    const result = await discoverAndListAll();
    cachedEndpointMap = result.cascadeToEndpoint;
    detectedAppDataDirs = result.appDataDirs;
    availableEndpoints = result.endpoints;

    // 将 LS 中已有的摘要合并进去
    for (const [id, info] of Object.entries(result.conversations)) {
      cachedConversations[id] = { ...(cachedConversations[id] || {}), ...info };
    }
    postMessage({ command: 'setConversations', data: cachedConversations, convDir: getConvDir() });

    // 步骤 3：针对未索引或标题未丰富的会话，后台平滑恢复
    if (result.endpoints.length > 0) {
      const epList = result.endpoints.map((e) => ({ port: e.port, csrf: e.csrf }));
      const unindexed = diskItems
        .filter((item) => !(item.id in result.conversations))
        .map((item) => item.id);

      if (unindexed.length > 0) {
        const recovery = await recoverUnindexed(
          unindexed,
          epList,
          (done: number, total: number) => {
            postMessage({ command: 'recoverProgress', done, total });
          },
          (id: string, partial: TrajectorySummary) => {
            cachedConversations[id] = { ...(cachedConversations[id] || {}), ...partial };
          },
        );

        if (recovery.activated > 0) {
          const refreshed = await discoverAndListAll();
          cachedEndpointMap = refreshed.cascadeToEndpoint;
          availableEndpoints = refreshed.endpoints;
          for (const [id, info] of Object.entries(refreshed.conversations)) {
            cachedConversations[id] = { ...(cachedConversations[id] || {}), ...info };
          }
          postMessage({ command: 'setConversations', data: cachedConversations, convDir: getConvDir() });
          postMessage({ command: 'recoverDone', activated: recovery.activated, total: recovery.total });
        }
      }
    }

    // 步骤 4：持久化至本地缓存文件
    writeCache(cachedConversations);
  } catch (e) {
    postMessage({ command: 'error', text: `会话扫描失败: ${e}` });
  }
}

/**
 * 导出单个会话
 *
 * @param cascadeId 会话唯一标识 ID
 * @param format 导出格式 (md | json | all)
 * @param overrideDir 明确指定的输出目录（若传入则直接写入该目录，不弹出另存为窗口）
 * @param overrideTs 指定时间戳
 * @param jsonCollector 批量 JSON 汇总收集器
 * @param interactive 是否启用交互式另存为弹窗（从 Webview 单条导出时为 true）
 */
async function handleExport(
  cascadeId: string,
  format: string,
  overrideDir?: string,
  overrideTs?: string,
  jsonCollector?: ConversationRecord[],
  interactive = false,
): Promise<void> {
  // 1. 尝试获取有效端点：首选映射 -> 内存缓存终端 -> 实时现场动态探测
  let ep = cachedEndpointMap[cascadeId];
  if (!ep && availableEndpoints.length > 0) {
    ep = availableEndpoints[0];
  }
  if (!ep) {
    const liveEps = await getLiveWorkingEndpoints();
    if (liveEps.length > 0) {
      ep = liveEps[0];
      availableEndpoints = liveEps;
    }
  }

  if (!ep) {
    const errorMsg = t('discovery.noEndpoint');
    vscode.window.showErrorMessage(errorMsg);
    postMessage({ command: 'exportError', text: errorMsg });
    return;
  }

  const config = vscode.workspace.getConfiguration('aghistory');
  const fieldLevel = config.get<string>('fieldLevel', 'thinking') as FieldLevel;
  const exportStrategy = config.get<string>('exportStrategy', 'workspace');
  const exportPathConfig = config.get<string>('exportPath', './antigravity_export');

  try {
    const steps = await getTrajectorySteps(ep.port, ep.csrf, cascadeId, availableEndpoints);
    if (!steps || steps.length === 0) {
      throw new Error(`未能获取会话 ${cascadeId.slice(0, 8)} 的步骤数据（接口可能暂未响应）`);
    }
    const messages = parseSteps(steps, fieldLevel);

    const cached = cachedConversations[cascadeId];
    const rawTitle = cached?.summary || `conversation_${cascadeId.slice(0, 8)}`;
    const title = safeFilename(rawTitle);
    const metadata: TrajectorySummary = cached || { stepCount: steps.length };

    // ── 单条交互式导出（弹出文件另存为对话框，让用户选择保存文件夹与文件名） ──
    if (interactive && !overrideDir && !jsonCollector) {
      // 确定默认保存目录：优先使用当前会话所属项目的根目录，若未关联则使用当前 VS Code 工作区根目录
      let defaultDir = '';
      const convWs = getConversationWorkspace(cascadeId);
      if (convWs && fs.existsSync(convWs)) {
        defaultDir = convWs;
      } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        defaultDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
      } else {
        defaultDir = resolveExportPath(exportPathConfig);
      }

      // 准备导出内容、默认文件名与过滤器
      let content = '';
      let defaultFileName = '';
      let filters: Record<string, string[]> = {};

      if (format === 'json') {
        const record = buildConversationRecord(cascadeId, rawTitle, metadata, messages);
        content = formatJson([record]);
        defaultFileName = `${title}.json`;
        filters = { [t('filter.json')]: ['json'] };
      } else {
        // 默认为 md
        content = formatMarkdown(rawTitle, cascadeId, metadata, messages);
        defaultFileName = `${title}.md`;
        filters = { [t('filter.markdown')]: ['md'] };
      }

      const defaultUri = vscode.Uri.file(path.join(defaultDir, defaultFileName));
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters,
        saveLabel: t('dialog.save'),
        title: t('dialog.saveTitle', undefined, format.toUpperCase()),
      });

      if (!saveUri) {
        postMessage({ command: 'exportCanceled', text: '已取消导出' });
        return;
      }

      const targetPath = saveUri.fsPath;
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content, 'utf-8');

      const savedFilename = path.basename(targetPath);
      const savedDir = path.dirname(targetPath);
      postMessage({ command: 'exportDone', text: `已保存: ${savedFilename}` });

      vscode.window.showInformationMessage(
        t('export.singleSuccess', undefined, savedFilename, savedDir),
        t('export.openFile'),
        t('export.openContainingFolder'),
      ).then((choice) => {
        if (choice === t('export.openFile')) {
          vscode.workspace.openTextDocument(saveUri).then((doc) => {
            vscode.window.showTextDocument(doc);
          });
        } else if (choice === t('export.openContainingFolder')) {
          openPathInExplorer(savedDir);
        }
      });
      return;
    }

    // ── 非交互模式（批量导出或明确传入 overrideDir） ──
    let outputDir = overrideDir;
    if (!outputDir) {
      if (exportStrategy === 'workspace') {
        const convWs = getConversationWorkspace(cascadeId);
        if (convWs && fs.existsSync(convWs)) {
          if (path.isAbsolute(exportPathConfig)) {
            outputDir = path.resolve(convWs, './antigravity_export');
          } else {
            outputDir = path.resolve(convWs, exportPathConfig);
          }
        } else {
          outputDir = resolveExportPath(exportPathConfig);
        }
      } else {
        outputDir = resolveExportPath(exportPathConfig);
      }
    }

    let exportedFilePath = '';

    if (format === 'md' || format === 'all') {
      const md = formatMarkdown(rawTitle, cascadeId, metadata, messages);
      exportedFilePath = writeConversation(md, title, outputDir, '.md', overrideTs);
      postMessage({ command: 'exportDone', text: `已导出: ${path.basename(exportedFilePath)}` });
    }
    if (format === 'json' || format === 'all') {
      const record = buildConversationRecord(cascadeId, rawTitle, metadata, messages);
      if (jsonCollector) {
        jsonCollector.push(record);
      } else {
        const jsonStr = formatJson([record]);
        exportedFilePath = writeConversation(jsonStr, title, outputDir, '.json', overrideTs);
        postMessage({ command: 'exportDone', text: `已导出: ${path.basename(exportedFilePath)}` });
      }
    }

    if (!jsonCollector && exportedFilePath) {
      const filename = path.basename(exportedFilePath);
      vscode.window.showInformationMessage(
        t('export.singleSuccess', undefined, filename, outputDir),
        t('export.openFile'),
        t('export.openContainingFolder'),
      ).then((choice) => {
        if (choice === t('export.openFile')) {
          vscode.workspace.openTextDocument(exportedFilePath).then((doc) => {
            vscode.window.showTextDocument(doc);
          });
        } else if (choice === t('export.openContainingFolder')) {
          openPathInExplorer(outputDir);
        }
      });
    }
  } catch (e) {
    const errText = `导出失败: ${e instanceof Error ? e.message : String(e)}`;
    vscode.window.showErrorMessage(errText);
    postMessage({ command: 'exportError', text: errText });
    if (jsonCollector) { throw e; }
  }
}

/**
 * 批量导出全部会话
 */
async function handleExportAll(): Promise<void> {
  const cascadeIds = Object.keys(cachedConversations);
  if (cascadeIds.length === 0) {
    vscode.window.showWarningMessage(t('export.noConversations'));
    return;
  }

  if (availableEndpoints.length === 0) {
    vscode.window.showInformationMessage(t('discovery.waiting'));
    await handleRefresh();
    if (availableEndpoints.length === 0) {
      vscode.window.showErrorMessage(t('discovery.noEndpoint'));
      return;
    }
  }

  const config = vscode.workspace.getConfiguration('aghistory');
  const exportFormat = config.get<string>('exportFormat', 'all');
  const fieldLevel = config.get<string>('fieldLevel', 'thinking') as FieldLevel;
  const exportStrategy = config.get<string>('exportStrategy', 'workspace');
  const exportPath = config.get<string>('exportPath', './antigravity_export');
  const ts = getTimestamp();
  const baseOutputDir = path.join(resolveExportPath(exportPath), `export_${ts}_${fieldLevel}`);
  const currentLang = getCurrentLanguage();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t('export.batchTitle'),
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

        // 确定该会话在批量导出中的子目录
        let itemOutputDir = baseOutputDir;
        if (exportStrategy === 'workspace') {
          const convWs = getConversationWorkspace(cid);
          if (convWs) {
            const folderName = safeFilename(path.basename(convWs));
            itemOutputDir = path.join(baseOutputDir, folderName);
          } else {
            itemOutputDir = path.join(baseOutputDir, t('report.uncategorized', currentLang));
          }
        }

        try {
          await handleExport(cid, exportFormat, itemOutputDir, undefined, jsonCollector);
        } catch {
          failedIds.push(cid);
          failed++;
        }
        done++;
      }

      // 写入汇总 JSON 文件
      if ((exportFormat === 'json' || exportFormat === 'all') && jsonCollector.length > 0) {
        const combinedJson = formatJson(jsonCollector);
        const jsonPath = path.join(baseOutputDir, `conversations_export_${ts}.json`);
        fs.mkdirSync(baseOutputDir, { recursive: true });
        fs.writeFileSync(jsonPath, combinedJson, 'utf-8');
      }

      // 生成导出报告文本
      const reportLines: string[] = [
        '============================================================',
        t('report.title', currentLang),
        '============================================================',
        '',
        `  ${t('report.time', currentLang)}:      ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
        `  ${t('report.format', currentLang)}:      ${exportFormat}`,
        `  ${t('report.fieldLevel', currentLang)}:  ${fieldLevel}`,
        `  ${t('report.strategy', currentLang)}:  ${exportStrategy === 'workspace' ? t('report.strategyWorkspace', currentLang) : t('report.strategyUnified', currentLang)}`,
        `  ${t('report.outputDir', currentLang)}:  ${baseOutputDir}`,
        `  ${t('report.total', currentLang)}:      ${total}`,
        `  ${t('report.success', currentLang)}:      ${done - failed}`,
        `  ${t('report.failed', currentLang)}:      ${failed}`,
        '',
        '------------------------------------------------------------',
        `  ${t('report.listHeader', currentLang)} (${done - failed})`,
        '------------------------------------------------------------',
      ];
      let idx = 1;
      for (const cid of cascadeIds) {
        const conv = cachedConversations[cid];
        const title = conv?.summary || `[${t('report.unknown', currentLang)}] ${cid.slice(0, 8)}...`;
        const steps = conv?.stepCount ?? '?';
        const ws = getConversationWorkspace(cid) || t('report.noWorkspace', currentLang);
        const status = failedIds.includes(cid) ? t('report.failedTag', currentLang) : '';
        reportLines.push(`  ${String(idx).padStart(3)}. ${title}${status}`);
        reportLines.push(`       ${t('report.steps', currentLang)}: ${steps}  |  ${t('report.project', currentLang)}: ${ws}  |  ID: ${cid.slice(0, 8)}...`);
        idx++;
      }
      reportLines.push('', '============================================================');
      const reportPath = path.join(baseOutputDir, `export_report_${ts}.txt`);
      fs.mkdirSync(baseOutputDir, { recursive: true });
      fs.writeFileSync(reportPath, reportLines.join('\n'), 'utf-8');

      const choice = await vscode.window.showInformationMessage(
        t('export.success', currentLang, done - failed, failed, baseOutputDir),
        t('export.openFolder', currentLang),
      );
      if (choice === t('export.openFolder', currentLang)) {
        await openPathInExplorer(baseOutputDir);
      }
    },
  );
}

// 辅助工具方法

function postMessage(msg: Record<string, unknown>): void {
  currentPanel?.webview.postMessage(msg);
}

function resolveExportPath(configPath: string): string {
  if (path.isAbsolute(configPath)) { return configPath; }
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return path.resolve(wsFolder || process.cwd(), configPath);
}

function getConvDir(): string {
  return getConversationsDir(detectedAppDataDirs) || path.join(require('os').homedir(), '.gemini', 'antigravity-ide', 'conversations');
}

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const cssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'panel.css'),
  );
  const jsUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'panel.js'),
  );
  const nonce = crypto.randomBytes(16).toString('hex');
  const currentLang = getCurrentLanguage();

  return `<!DOCTYPE html>
<html lang="${currentLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri}">
  <title>Antigravity History</title>
</head>
<body>
  <div class="top-bar">
    <input type="text" class="search-input" id="search-input" placeholder="搜索会话...">
    <div class="segmented-control">
      <button class="seg-btn active" id="group-date">日期</button>
      <button class="seg-btn" id="group-workspace">工作区</button>
    </div>
    <div class="segmented-control">
      <button class="seg-btn" id="btn-expand-all" title="全部展开">展开</button>
      <button class="seg-btn" id="btn-collapse-all" title="全部折叠">折叠</button>
    </div>
    <button class="btn btn-icon" id="btn-refresh" title="刷新">刷新</button>
    <select class="field-level-select" id="export-strategy-select" title="导出归属模式">
      <option value="workspace" selected>按所属项目归类</option>
      <option value="unified">统一导出目录</option>
    </select>
    <select class="field-level-select" id="single-export-mode-select" title="单条导出模式">
      <option value="dialog" selected>另存为弹窗</option>
      <option value="direct">直接保存</option>
    </select>
    <select class="field-level-select" id="field-level-select" title="导出详情级别">
      <option value="default">基础对话</option>
      <option value="thinking" selected>+ 思考过程</option>
      <option value="full">完整数据 (含Diff与终端)</option>
    </select>
    <select class="field-level-select lang-select" id="lang-select" title="语言 / Language">
      <option value="zh-CN"${currentLang === 'zh-CN' ? ' selected' : ''}>中文 (简体)</option>
      <option value="en"${currentLang === 'en' ? ' selected' : ''}>English</option>
    </select>
    <button class="btn btn-primary" id="btn-export-all">全部导出</button>
  </div>
  <div class="stats-bar" id="stats-bar"></div>
  <div class="export-path-bar" id="export-path-bar"></div>
  <div id="list-container"></div>
  <div class="toast" id="toast"></div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
