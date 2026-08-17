/**
 * 对话步骤解析引擎 (Step Parser)
 *
 * 核心功能：
 * - 将原始 API 步骤数据解析为多角色结构化消息流 (user / assistant / tool)
 * - 支持三级导出精度过滤策略 (default / thinking / full)
 * - 支持提取工具调用、终端执行结果、差异 Diff 与思考过程
 *
 * 作者/更新时间: fengyun / 2026-08-14
 */

import type { TrajectoryStep } from './ls-client.js';

export type FieldLevel = 'default' | 'thinking' | 'full';

export interface ParsedMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string;
  timestamp?: string;
  thinking?: string;
  stop_reason?: string;
  model?: string;
  thinking_duration?: string;
  message_id?: string;
  file_path?: string;
  diff?: string;
  artifact_summary?: string;
  artifact_type?: string;
  is_artifact?: boolean;
  cwd?: string;
  exit_code?: number;
  output?: string;
  active_file?: string;
  editor_language?: string;
  num_lines?: number;
  num_bytes?: number;
  search_summary?: string;
  search_provider?: string;
}

const DIFF_PREFIX: Record<string, string> = {
  UNIFIED_DIFF_LINE_TYPE_INSERT: '+',
  UNIFIED_DIFF_LINE_TYPE_DELETE: '-',
  UNIFIED_DIFF_LINE_TYPE_CONTEXT: ' ',
};

/**
 * Parse raw steps into structured messages.
 */
export function parseSteps(steps: TrajectoryStep[], level: FieldLevel = 'default'): ParsedMessage[] {
  const includeThinking = level === 'thinking' || level === 'full';
  const includeFull = level === 'full';
  const messages: ParsedMessage[] = [];

  for (const step of steps) {
    const stepType = (step.type as string) || '';
    const metadata = (step.metadata || {}) as Record<string, unknown>;
    const timestamp = includeThinking ? (metadata.createdAt as string) : undefined;

    const msg = parseStep(step, stepType, includeThinking, includeFull);
    if (!msg) { continue; }

    if (timestamp) { msg.timestamp = timestamp; }
    messages.push(msg);
  }

  return messages;
}

function parseStep(
  step: TrajectoryStep,
  stepType: string,
  includeThinking: boolean,
  includeFull: boolean,
): ParsedMessage | null {
  switch (stepType) {
    case 'CORTEX_STEP_TYPE_USER_INPUT':
      return parseUserInput(step, includeFull);
    case 'CORTEX_STEP_TYPE_PLANNER_RESPONSE':
      return parsePlannerResponse(step, includeThinking, includeFull);
    case 'CORTEX_STEP_TYPE_CODE_ACTION':
      return parseCodeAction(step, includeFull);
    case 'CORTEX_STEP_TYPE_RUN_COMMAND':
      return parseRunCommand(step, includeThinking, includeFull);
    case 'CORTEX_STEP_TYPE_VIEW_FILE':
      return parseViewFile(step, includeThinking);
    case 'CORTEX_STEP_TYPE_FIND':
      return { role: 'tool', tool_name: 'find', content: get(step, 'find.query') || '[File Search]' };
    case 'CORTEX_STEP_TYPE_LIST_DIRECTORY':
      return { role: 'tool', tool_name: 'list_dir', content: get(step, 'listDirectory.directoryPath') || get(step, 'listDirectory.path') || '[List Directory]' };
    case 'CORTEX_STEP_TYPE_SEARCH_WEB':
      return parseSearchWeb(step, includeFull);
    case 'CORTEX_STEP_TYPE_READ_URL_CONTENT':
      return { role: 'tool', tool_name: 'read_url', content: get(step, 'readUrlContent.url') || '[Read URL]' };
    case 'CORTEX_STEP_TYPE_COMMAND_STATUS':
      return { role: 'tool', tool_name: 'command_status', content: '[Check Command Status]' };
    default:
      return null; // Skip system types
  }
}

// ── Individual parsers ──

function parseUserInput(step: TrajectoryStep, includeFull: boolean): ParsedMessage | null {
  const ui = (step.userInput || {}) as Record<string, unknown>;
  const content = (ui.userResponse as string) || '';
  if (!content) { return null; }

  const msg: ParsedMessage = { role: 'user', content };

  if (includeFull) {
    const state = (ui.activeUserState as Record<string, unknown>) || {};
    const doc = (state.activeDocument as Record<string, unknown>) || {};
    if (doc.absoluteUri) {
      msg.active_file = doc.absoluteUri as string;
      msg.editor_language = (doc.editorLanguage as string) || '';
    }
  }
  return msg;
}

function parsePlannerResponse(step: TrajectoryStep, includeThinking: boolean, includeFull: boolean): ParsedMessage | null {
  const pr = (step.plannerResponse || {}) as Record<string, unknown>;
  const content = (pr.modifiedResponse as string) || (pr.response as string) || '';
  if (!content) { return null; }

  const msg: ParsedMessage = { role: 'assistant', content };

  if (includeThinking) {
    if (pr.thinking) { msg.thinking = pr.thinking as string; }
    if (pr.stopReason) { msg.stop_reason = pr.stopReason as string; }
  }

  if (includeFull) {
    const metadata = (step.metadata || {}) as Record<string, unknown>;
    if (metadata.generatorModel) { msg.model = metadata.generatorModel as string; }
    if (pr.thinkingDuration) { msg.thinking_duration = pr.thinkingDuration as string; }
    if (pr.messageId) { msg.message_id = pr.messageId as string; }
  }
  return msg;
}

function parseCodeAction(step: TrajectoryStep, includeFull: boolean): ParsedMessage | null {
  const ca = (step.codeAction || {}) as Record<string, unknown>;
  const description = (ca.description as string) || '';

  let filePath = '';
  const edit = ((ca.actionResult as Record<string, unknown>)?.edit as Record<string, unknown>) || {};
  if (edit.absoluteUri) {
    filePath = edit.absoluteUri as string;
  } else {
    const spec = (ca.actionSpec as Record<string, unknown>) || {};
    const createFile = (spec.createFile as Record<string, unknown>) || {};
    if (createFile.path) { filePath = createFile.path as string; }
  }

  let summary = filePath ? `[Code Edit] ${filePath}` : '[Code Edit]';
  if (description) { summary += `\n${description}`; }

  const msg: ParsedMessage = { role: 'tool', tool_name: 'code_edit', content: summary };
  if (filePath) { msg.file_path = filePath; }

  if (includeFull) {
    if (edit.diff) { msg.diff = normalizeDiff(edit.diff); }
    const artifact = (ca.artifactMetadata as Record<string, unknown>) || {};
    if (artifact.summary) { msg.artifact_summary = artifact.summary as string; }
    if (artifact.artifactType) { msg.artifact_type = artifact.artifactType as string; }
    if (ca.isArtifactFile) { msg.is_artifact = true; }
  }
  return msg;
}

function parseRunCommand(step: TrajectoryStep, includeThinking: boolean, includeFull: boolean): ParsedMessage | null {
  const rc = (step.runCommand || {}) as Record<string, unknown>;
  const command = (rc.commandLine as string) || (rc.command as string) || '';
  if (!command) { return null; }

  const msg: ParsedMessage = { role: 'tool', tool_name: 'run_command', content: command };

  if (includeThinking) {
    if (rc.cwd) { msg.cwd = rc.cwd as string; }
    if (rc.exitCode !== undefined) { msg.exit_code = rc.exitCode as number; }
  }

  if (includeFull) {
    const output = (rc.combinedOutput as Record<string, unknown>)?.full as string;
    if (output) { msg.output = output; }
  }
  return msg;
}

function parseViewFile(step: TrajectoryStep, includeThinking: boolean): ParsedMessage | null {
  const vf = (step.viewFile || {}) as Record<string, unknown>;
  const path = (vf.absolutePathUri as string) || (vf.filePath as string) || (vf.path as string) || '';
  if (!path) { return null; }

  const msg: ParsedMessage = { role: 'tool', tool_name: 'view_file', content: path };

  if (includeThinking) {
    if (vf.numLines) { msg.num_lines = vf.numLines as number; }
    if (vf.numBytes) { msg.num_bytes = vf.numBytes as number; }
  }
  return msg;
}

function parseSearchWeb(step: TrajectoryStep, includeFull: boolean): ParsedMessage | null {
  const sw = (step.searchWeb || {}) as Record<string, unknown>;
  const query = (sw.query as string) || '';

  const msg: ParsedMessage = { role: 'tool', tool_name: 'search_web', content: query || '[Web Search]' };

  if (includeFull) {
    if (sw.summary) { msg.search_summary = sw.summary as string; }
    const provider = (sw.thirdPartyConfig as Record<string, unknown>)?.provider as string;
    if (provider) { msg.search_provider = provider; }
  }
  return msg;
}

// ── Helpers ──

/** Safely get a nested property using dot notation. */
function get(obj: Record<string, unknown>, path: string): string {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') { return ''; }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : '';
}

/** Normalize diff to string. API may return string or structured dict. */
function normalizeDiff(diff: unknown): string {
  if (typeof diff === 'string') { return diff; }
  if (typeof diff === 'object' && diff !== null) {
    const d = diff as Record<string, unknown>;
    const lines = ((d.unifiedDiff as Record<string, unknown>)?.lines as Array<Record<string, unknown>>) || [];
    if (lines.length === 0) { return JSON.stringify(diff); }
    return lines.map((line) => {
      const text = (line.text as string) || '';
      const prefix = DIFF_PREFIX[line.type as string] || ' ';
      return `${prefix}${text}`;
    }).join('\n');
  }
  return String(diff);
}
