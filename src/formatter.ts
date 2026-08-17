/**
 * 格式化输出模块 — 支持 Markdown 与 JSON 导出转换
 *
 * 核心功能：
 * - 将对话轨迹解析步骤转换为结构化 Markdown 文本
 * - 将对话元数据与步骤封装为标准 JSON 记录
 * - 文件名安全清洗（完整支持中文字符与多语言）与同名文件写入保护
 *
 * 作者/更新时间: fengyun / 2026-08-14
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ParsedMessage } from './parser.js';
import type { TrajectorySummary } from './ls-client.js';

// ════════════════════════════════
// Markdown 格式化
// ════════════════════════════════

/**
 * 格式化单条会话为 Markdown 字符串
 */
export function formatMarkdown(
  title: string,
  cascadeId: string,
  metadata: TrajectorySummary,
  messages: ParsedMessage[],
): string {
  const lines: string[] = [
    `# ${title}`, '',
    `- **Cascade ID**: \`${cascadeId}\``,
    `- **Steps**: ${metadata.stepCount ?? '?'}`,
    `- **Status**: ${metadata.status ?? '?'}`,
    `- **Created**: ${metadata.createdTime ?? '?'}`,
    `- **Last Modified**: ${metadata.lastModifiedTime ?? '?'}`,
  ];

  // 工作区信息
  const workspaces = metadata.workspaces || [];
  const wsUris = workspaces
    .map((w) => w.workspaceFolderAbsoluteUri)
    .filter(Boolean) as string[];
  if (wsUris.length > 0) {
    lines.push(`- **Workspace**: ${wsUris.join(', ')}`);
  }

  lines.push(
    `- **Exported**: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
    '', '---', '',
  );

  for (const msg of messages) {
    lines.push(...formatMessageMd(msg));
  }

  return lines.join('\n');
}

/**
 * 格式化单条消息
 */
function formatMessageMd(msg: ParsedMessage): string[] {
  const { role, content } = msg;
  const tsSuffix = msg.timestamp ? `  \`${msg.timestamp.slice(0, 19)}\`` : '';
  const lines: string[] = [];

  if (role === 'user') {
    lines.push(`## [User] 用户${tsSuffix}`, content, '');
  } else if (role === 'assistant') {
    lines.push(`## [Assistant] 助手${tsSuffix}`);
    if (msg.thinking) {
      lines.push('<details><summary>思考过程 (Thinking)</summary>', '', msg.thinking, '', '</details>', '');
    }
    lines.push(content);
    const extras: string[] = [];
    if (msg.model) { extras.push(`模型: \`${msg.model}\``); }
    if (msg.stop_reason) { extras.push(`停止原因: \`${msg.stop_reason}\``); }
    if (msg.thinking_duration) { extras.push(`思考耗时: \`${msg.thinking_duration}\``); }
    if (extras.length > 0) { lines.push('', `*${extras.join(' | ')}*`); }
    lines.push('');
  } else if (role === 'tool') {
    const toolName = msg.tool_name || 'unknown';
    lines.push(`### [Tool] 工具: \`${toolName}\`${tsSuffix}`);

    if (toolName === 'code_edit') {
      lines.push(content);
      if (msg.diff) {
        lines.push('', '```diff');
        lines.push(msg.diff.length > 3000
          ? msg.diff.slice(0, 3000) + `\n... (已截断，共 ${msg.diff.length} 字符)`
          : msg.diff);
        lines.push('```');
      }
    } else if (toolName === 'run_command') {
      const cwdInfo = msg.cwd ? ` (执行目录: \`${msg.cwd}\`)` : '';
      const exitInfo = msg.exit_code !== undefined ? ` -> 退出码: ${msg.exit_code}` : '';
      lines.push('```bash', content, '```');
      if (cwdInfo || exitInfo) { lines.push(`*${cwdInfo}${exitInfo}*`); }
      if (msg.output) {
        const truncated = msg.output.length > 5000
          ? msg.output.slice(0, 5000) + `\n... (已截断，共 ${msg.output.length} 字符)`
          : msg.output;
        lines.push('', '<details><summary>命令输出 (Output)</summary>', '', '```', truncated, '```', '', '</details>');
      }
    } else if (toolName === 'search_web') {
      lines.push(`搜索词: ${content}`);
      if (msg.search_summary) {
        lines.push('', '<details><summary>搜索结果摘要</summary>', '', msg.search_summary, '', '</details>');
      }
    } else if (toolName === 'view_file') {
      const sizeParts: string[] = [];
      if (msg.num_lines) { sizeParts.push(`${msg.num_lines} 行`); }
      if (msg.num_bytes) { sizeParts.push(`${msg.num_bytes} 字节`); }
      const sizeInfo = sizeParts.length ? ` (${sizeParts.join(', ')})` : '';
      lines.push(`\`${content}\`${sizeInfo}`);
    } else {
      if (content) { lines.push(`\`${content.slice(0, 500)}\``); }
    }
    lines.push('');
  }

  return lines;
}

// ════════════════════════════════
// JSON 格式化
// ════════════════════════════════

export interface ConversationRecord {
  cascade_id: string;
  title: string;
  step_count: number;
  created_time: string;
  last_modified_time: string;
  workspaces?: string[];
  messages: ParsedMessage[];
}

export function buildConversationRecord(
  cascadeId: string,
  title: string,
  metadata: TrajectorySummary,
  messages: ParsedMessage[],
): ConversationRecord {
  const record: ConversationRecord = {
    cascade_id: cascadeId,
    title,
    step_count: metadata.stepCount || 0,
    created_time: metadata.createdTime || '',
    last_modified_time: metadata.lastModifiedTime || '',
    messages,
  };
  const workspaces = metadata.workspaces || [];
  const wsUris = workspaces
    .map((w) => w.workspaceFolderAbsoluteUri)
    .filter(Boolean) as string[];
  if (wsUris.length > 0) { record.workspaces = wsUris; }
  return record;
}

export function formatJson(conversations: ConversationRecord[]): string {
  return JSON.stringify(conversations, null, 2);
}

// ════════════════════════════════
// 文件写入与安全命名工具
// ════════════════════════════════

/**
 * 清洗并生成安全的文件名
 * 完整保留中文、英文字符及常见符号，仅过滤操作系统非法字符 (\ / : * ? " < > | 及控制字符)
 */
export function safeFilename(title: string, maxLen = 120): string {
  if (!title) { return '未命名会话'; }
  const clean = title
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_') // 替换系统非法字符
    .replace(/\s+/g, ' ')               // 合并连续空格
    .trim();
  return clean.slice(0, maxLen) || '未命名会话';
}

/** 生成时间戳字符串，例如 20260814_153000 */
export function getTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * 写入单条会话文件（自动处理同名防覆盖递增）
 */
export function writeConversation(
  content: string,
  title: string,
  outputDir: string,
  extension = '.md',
  timestamp?: string,
): string {
  const base = safeFilename(title);
  const suffix = timestamp ? `_${timestamp}` : '';
  let filename = `${base}${suffix}${extension}`;
  let filepath = path.join(outputDir, filename);

  // 文件名防覆盖递增
  let counter = 2;
  while (fs.existsSync(filepath)) {
    filename = `${base}${suffix}_(${counter})${extension}`;
    filepath = path.join(outputDir, filename);
    counter++;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(filepath, content, 'utf-8');
  return filepath;
}
