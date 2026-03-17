/**
 * Formatted output — Markdown / JSON.
 *
 * Ported from Python: antigravity_history/formatters.py (237 lines)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ParsedMessage } from './parser.js';
import type { TrajectorySummary } from './ls-client.js';

// ════════════════════════════════
// Markdown format
// ════════════════════════════════

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

  // Workspace info
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

function formatMessageMd(msg: ParsedMessage): string[] {
  const { role, content } = msg;
  const tsSuffix = msg.timestamp ? `  \`${msg.timestamp.slice(0, 19)}\`` : '';
  const lines: string[] = [];

  if (role === 'user') {
    lines.push(`## 🧑 User${tsSuffix}`, content, '');
  } else if (role === 'assistant') {
    lines.push(`## 🤖 Assistant${tsSuffix}`);
    if (msg.thinking) {
      lines.push('<details><summary>💭 Thinking</summary>', '', msg.thinking, '', '</details>', '');
    }
    lines.push(content);
    const extras: string[] = [];
    if (msg.model) { extras.push(`Model: \`${msg.model}\``); }
    if (msg.stop_reason) { extras.push(`Stop: \`${msg.stop_reason}\``); }
    if (msg.thinking_duration) { extras.push(`Think: \`${msg.thinking_duration}\``); }
    if (extras.length > 0) { lines.push('', `*${extras.join(' | ')}*`); }
    lines.push('');
  } else if (role === 'tool') {
    const toolName = msg.tool_name || 'unknown';
    lines.push(`### 🔧 Tool: \`${toolName}\`${tsSuffix}`);

    if (toolName === 'code_edit') {
      lines.push(content);
      if (msg.diff) {
        lines.push('', '```diff');
        lines.push(msg.diff.length > 3000
          ? msg.diff.slice(0, 3000) + `\n... (truncated, ${msg.diff.length} chars total)`
          : msg.diff);
        lines.push('```');
      }
    } else if (toolName === 'run_command') {
      const cwdInfo = msg.cwd ? ` (in \`${msg.cwd}\`)` : '';
      const exitInfo = msg.exit_code !== undefined ? ` → exit ${msg.exit_code}` : '';
      lines.push('```bash', content, '```');
      if (cwdInfo || exitInfo) { lines.push(`*${cwdInfo}${exitInfo}*`); }
      if (msg.output) {
        const truncated = msg.output.length > 5000
          ? msg.output.slice(0, 5000) + `\n... (truncated, ${msg.output.length} chars total)`
          : msg.output;
        lines.push('', '<details><summary>📤 Output</summary>', '', '```', truncated, '```', '', '</details>');
      }
    } else if (toolName === 'search_web') {
      lines.push(`Query: ${content}`);
      if (msg.search_summary) {
        lines.push('', '<details><summary>🔍 Search Results</summary>', '', msg.search_summary, '', '</details>');
      }
    } else if (toolName === 'view_file') {
      const sizeParts: string[] = [];
      if (msg.num_lines) { sizeParts.push(`${msg.num_lines} lines`); }
      if (msg.num_bytes) { sizeParts.push(`${msg.num_bytes} bytes`); }
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
// JSON format
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
// File writing utilities
// ════════════════════════════════

export function safeFilename(title: string, maxLen = 60): string {
  return title.replace(/[^\w\s\-]/g, '_').slice(0, maxLen).trim();
}

/** Generate a timestamp string like '20260317_141955' */
export function getTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function writeConversation(
  content: string,
  title: string,
  outputDir: string,
  extension = '.md',
  timestamp?: string,
): string {
  const base = safeFilename(title);
  const suffix = timestamp ? `_${timestamp}` : '';
  let filepath = path.join(outputDir, base + suffix + extension);

  // Deduplicate
  let counter = 2;
  while (fs.existsSync(filepath)) {
    filepath = path.join(outputDir, `${base}${suffix}_${counter}${extension}`);
    counter++;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(filepath, content, 'utf-8');
  return filepath;
}
