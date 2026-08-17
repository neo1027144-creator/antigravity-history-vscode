/**
 * 国际化多语言管理模块 (i18n)
 *
 * 核心功能：
 * - 集中管理 Antigravity History 插件端（后端）与导出报告的中英文双语词典
 * - 提供类型安全的翻译函数及参数占位符格式化支持
 * - 支持根据用户配置与运行环境动态解析当前显示语言
 *
 * 作者/更新时间: fengyun / 2026-08-17
 */

import * as vscode from 'vscode';

export type Language = 'zh-CN' | 'en';

export const DEFAULT_LANGUAGE: Language = 'zh-CN';

/**
 * 插件核心中英文消息词典
 */
export const messages: Record<Language, Record<string, string>> = {
  'zh-CN': {
    'statusBar.tooltip': '打开 Antigravity 历史记录',
    'panel.title': 'Antigravity History',
    'common.invalidPath': '无效的目录路径',
    'common.pathNotExistTryParent': '目标路径不存在: {0}，将尝试打开其父目录',
    'common.pathNotExist': '指定的路径不存在: {0}',
    'common.cannotOpenExplorer': '无法在资源管理器中打开目录: {0}',
    'common.copiedToClipboard': '会话 ID 已复制到剪贴板',
    'dialog.selectExportFolder': '选择导出目录',
    'dialog.save': '保存',
    'dialog.saveTitle': '保存对话导出 ({0})',
    'filter.json': 'JSON 数据 (*.json)',
    'filter.markdown': 'Markdown 文档 (*.md)',
    'discovery.waiting': '正在等待 LanguageServer 发现完成...',
    'discovery.noEndpoint': '未发现可用的 LanguageServer 终端，请确认 Antigravity 正在运行',
    'export.noConversations': '当前没有可导出的会话，请先刷新重试',
    'export.batchTitle': '正在导出全部会话',
    'export.singleSuccess': '已成功导出 [{0}] 至 {1}',
    'export.success': '已成功导出 {0} 个会话 ({1} 个失败) 至 {2}',
    'export.openFile': '打开文件',
    'export.openContainingFolder': '打开所在文件夹',
    'export.openFolder': '打开文件夹',
    'export.individualHint': '请在面板中使用导出按钮导出单个会话。',
    'export.modeTitle': '单条导出模式',
    'export.modeDialog': '另存为弹窗',
    'export.modeDirect': '直接保存',
    'report.title': '  导出报告 (EXPORT REPORT)',
    'report.time': '时间',
    'report.format': '格式',
    'report.fieldLevel': '详情级别',
    'report.strategy': '归属模式',
    'report.strategyWorkspace': '按所属工作区归类',
    'report.strategyUnified': '统一主目录平铺',
    'report.outputDir': '输出目录',
    'report.total': '总数',
    'report.success': '成功',
    'report.failed': '失败',
    'report.listHeader': '  已导出列表',
    'report.steps': '步数',
    'report.project': '项目',
    'report.uncategorized': '未分类项目',
    'report.noWorkspace': '无工作区',
    'report.unknown': '未知',
    'report.failedTag': ' [失败]',
  },
  'en': {
    'statusBar.tooltip': 'Open Antigravity History',
    'panel.title': 'Antigravity History',
    'common.invalidPath': 'Invalid directory path',
    'common.pathNotExistTryParent': 'Path does not exist: {0}. Attempting to open parent directory.',
    'common.pathNotExist': 'Specified path does not exist: {0}',
    'common.cannotOpenExplorer': 'Cannot open directory in file explorer: {0}',
    'common.copiedToClipboard': 'Conversation ID copied to clipboard',
    'dialog.selectExportFolder': 'Select Export Directory',
    'dialog.save': 'Save',
    'dialog.saveTitle': 'Save Conversation Export ({0})',
    'filter.json': 'JSON Data (*.json)',
    'filter.markdown': 'Markdown Document (*.md)',
    'discovery.waiting': 'Waiting for LanguageServer discovery to complete...',
    'discovery.noEndpoint': 'No active LanguageServer endpoint found. Please ensure Antigravity is running.',
    'export.noConversations': 'No conversations available to export. Please refresh and try again.',
    'export.batchTitle': 'Exporting all conversations',
    'export.singleSuccess': 'Successfully exported [{0}] to {1}',
    'export.success': 'Successfully exported {0} conversations ({1} failed) to {2}',
    'export.openFile': 'Open File',
    'export.openContainingFolder': 'Open Containing Folder',
    'export.openFolder': 'Open Folder',
    'export.individualHint': 'Please use the export buttons in the panel to export individual conversations.',
    'export.modeTitle': 'Single Export Mode',
    'export.modeDialog': 'Save Dialog',
    'export.modeDirect': 'Direct Export',
    'report.title': '  EXPORT REPORT',
    'report.time': 'Time',
    'report.format': 'Format',
    'report.fieldLevel': 'Detail Level',
    'report.strategy': 'Strategy',
    'report.strategyWorkspace': 'Grouped by Project Workspace',
    'report.strategyUnified': 'Unified Main Directory',
    'report.outputDir': 'Output Directory',
    'report.total': 'Total',
    'report.success': 'Success',
    'report.failed': 'Failed',
    'report.listHeader': '  Exported List',
    'report.steps': 'Steps',
    'report.project': 'Project',
    'report.uncategorized': 'Uncategorized Project',
    'report.noWorkspace': 'No Workspace',
    'report.unknown': 'Unknown',
    'report.failedTag': ' [Failed]',
  },
};

/**
 * 获取当前配置的语言代码
 *
 * @returns 'zh-CN' 或 'en'
 */
export function getCurrentLanguage(): Language {
  const config = vscode.workspace.getConfiguration('aghistory');
  const lang = config.get<string>('language', DEFAULT_LANGUAGE);
  if (lang === 'en' || lang === 'zh-CN') {
    return lang;
  }
  return DEFAULT_LANGUAGE;
}

/**
 * 多语言翻译函数
 *
 * @param key 词条键名
 * @param lang 目标语言，默认获取当前配置语言
 * @param params 替换占位符 {0}, {1}, {2}... 的参数
 * @returns 翻译后的格式化字符串
 */
export function t(key: string, lang?: Language, ...params: (string | number)[]): string {
  const currentLang = lang || getCurrentLanguage();
  const dict = messages[currentLang] || messages[DEFAULT_LANGUAGE];
  let text = dict[key] || messages[DEFAULT_LANGUAGE][key] || key;

  if (params && params.length > 0) {
    params.forEach((param, index) => {
      text = text.replace(new RegExp(`\\{${index}\\}`, 'g'), String(param));
    });
  }

  return text;
}
