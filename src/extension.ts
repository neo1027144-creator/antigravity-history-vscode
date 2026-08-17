/**
 * 插件主入口 — 注册命令与状态栏按钮
 *
 * 核心功能：
 * - 注册 aghistory.openPanel / refresh / export / exportAll 命令
 * - 创建右下角状态栏快速入口按钮
 * - 响应扩展激活与反激活生命周期
 *
 * 作者/更新时间: fengyun / 2026-08-17
 */

import * as vscode from 'vscode';
import { openPanel, refreshPanel } from './panel-manager.js';
import { t } from './i18n.js';

export function activate(context: vscode.ExtensionContext): void {
  // ── 状态栏常驻按钮 ──
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.text = '$(history) AG History';
  statusBarItem.tooltip = t('statusBar.tooltip');
  statusBarItem.command = 'aghistory.openPanel';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // ── 注册扩展命令 ──
  context.subscriptions.push(
    vscode.commands.registerCommand('aghistory.openPanel', () => openPanel(context)),
    vscode.commands.registerCommand('aghistory.refresh', () => {
      refreshPanel();
    }),
    vscode.commands.registerCommand('aghistory.export', () => {
      vscode.window.showInformationMessage(t('export.individualHint'));
    }),
    vscode.commands.registerCommand('aghistory.exportAll', () => {
      openPanel(context);
    }),
  );
}

export function deactivate(): void {
  // 清理扩展资源
}
