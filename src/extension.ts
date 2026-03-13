import * as vscode from 'vscode';
import { openPanel, refreshPanel } from './panel-manager.js';

export function activate(context: vscode.ExtensionContext) {
  console.log('[Antigravity History] Extension activated');

  // ── Status Bar Button ──
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.text = '$(history) AG History';
  statusBarItem.tooltip = 'Open Antigravity History';
  statusBarItem.command = 'aghistory.openPanel';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // ── Commands ──
  context.subscriptions.push(
    vscode.commands.registerCommand('aghistory.openPanel', () => openPanel(context)),
    vscode.commands.registerCommand('aghistory.refresh', () => {
      refreshPanel();
      if (!refreshPanel) { openPanel(context); }
    }),
    vscode.commands.registerCommand('aghistory.export', () => {
      vscode.window.showInformationMessage('Use the panel to export individual conversations.');
    }),
    vscode.commands.registerCommand('aghistory.exportAll', () => {
      openPanel(context);
      // The panel will handle exportAll via its own button
    }),
  );
}

export function deactivate() {
  console.log('[Antigravity History] Extension deactivated');
}
