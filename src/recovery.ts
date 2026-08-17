/**
 * 本地会话扫描与全量恢复管理模块
 *
 * 核心功能：
 * - 扫描本地数据目录（兼容 antigravity-ide 与 antigravity）
 * - 支持扫描 SQLite (.db) 数据库与 Protobuf (.pb) 会话实体文件
 * - 提取文件元数据（时间戳、大小、ID）构建全量会话快照
 * - 针对未索引会话执行平滑并发恢复，逐步完善标题与工作区关联
 *
 * 作者/更新时间: fengyun / 2026-08-14
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { callApi, TrajectorySummary } from './ls-client.js';

/**
 * 获取所有存在会话实体文件的候选目录列表
 * 优先级：动态发现的 appDataDir -> antigravity-ide -> antigravity
 */
export function getCandidateConvDirs(customAppDirs: string[] = []): string[] {
  const home = os.homedir();
  const dirNames = new Set<string>();

  // 1. 优先添加动态提取的 appDataDir
  for (const name of customAppDirs) {
    if (name && typeof name === 'string') {
      dirNames.add(name);
    }
  }

  // 2. 默认推荐目录顺序：新版 antigravity-ide 优先，旧版 antigravity 兜底
  dirNames.add('antigravity-ide');
  dirNames.add('antigravity');

  const validDirs: string[] = [];
  for (const name of dirNames) {
    const p = path.join(home, '.gemini', name, 'conversations');
    if (fs.existsSync(p)) {
      validDirs.push(p);
    }
  }
  return validDirs;
}

/**
 * 获取主会话目录路径（优先新版 antigravity-ide）
 */
export function getConversationsDir(customAppDirs: string[] = []): string | null {
  const dirs = getCandidateConvDirs(customAppDirs);
  return dirs.length > 0 ? dirs[0] : null;
}

/**
 * 扫描指定目录下的所有实体文件，返回会话详细文件快照
 */
export function scanDiskConversations(convDirs: string | string[]): Array<{
  id: string;
  filePath: string;
  mtime: Date;
  size: number;
}> {
  const dirs = Array.isArray(convDirs) ? convDirs : [convDirs];
  const map = new Map<string, { id: string; filePath: string; mtime: Date; size: number }>();

  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) { continue; }
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        let id: string | null = null;
        if (file.endsWith('.db') && !file.endsWith('.db-wal') && !file.endsWith('.db-shm')) {
          id = file.slice(0, -3);
        } else if (file.endsWith('.pb')) {
          id = file.slice(0, -3);
        }
        if (id) {
          try {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            const existing = map.get(id);
            // 保留最新修改时间的文件记录
            if (!existing || stat.mtime.getTime() > existing.mtime.getTime()) {
              map.set(id, { id, filePath, mtime: stat.mtime, size: stat.size });
            }
          } catch { }
        }
      }
    } catch { }
  }

  return Array.from(map.values());
}

/**
 * 扫描指定目录下的会话实体文件，提取所有唯一的会话 ID
 */
export function scanConversationFiles(convDirs: string | string[]): string[] {
  return scanDiskConversations(convDirs).map((item) => item.id);
}

/**
 * 兼容旧方法：扫描单目录中的会话文件
 */
export function scanPbFiles(convDir: string): string[] {
  return scanConversationFiles(convDir);
}

/**
 * 自动平滑恢复本地存在但尚未被 LanguageServer 索引的会话
 *
 * @param unindexedIds 待恢复的会话 ID 列表
 * @param endpoints 可用的 LanguageServer 终端列表
 * @param onProgress 进度回调函数
 * @param onItemLoaded 当成功拉取单条会话详情时的回调（用于实时更新标题与工作区）
 */
export async function recoverUnindexed(
  unindexedIds: string[],
  endpoints: Array<{ port: number; csrf: string }>,
  onProgress?: (done: number, total: number, id: string) => void,
  onItemLoaded?: (id: string, summary: TrajectorySummary) => void,
): Promise<{ activated: number; failed: number; total: number }> {
  if (unindexedIds.length === 0 || endpoints.length === 0) {
    return { activated: 0, failed: 0, total: 0 };
  }

  let activated = 0;
  let failed = 0;

  // 采用温和并发（每批 3 条），避免拥塞 LS 端口与 SQLite 文件锁
  const batchSize = 3;
  for (let i = 0; i < unindexedIds.length; i += batchSize) {
    const batch = unindexedIds.slice(i, i + batchSize);
    const promises = batch.map(async (cascadeId, j) => {
      const ep = endpoints[(i + j) % endpoints.length];
      const result = await callApi(
        ep.port,
        ep.csrf,
        'GetCascadeTrajectorySteps',
        { cascadeId, startIndex: 0, endIndex: 1 },
        6000,
      );

      if (result) {
        // 如果返回了步骤数据，尝试提取第一条用户输入作为标题
        const steps = (result.steps as Array<{ userInput?: { userQuery?: string; userResponse?: string } }>) ||
          (result.messages as Array<{ userInput?: { userQuery?: string } }>);
        let extractedTitle = '';
        if (steps && steps.length > 0) {
          const first = steps[0];
          extractedTitle = first.userInput?.userQuery || first.userInput?.userResponse || '';
          if (extractedTitle) {
            extractedTitle = extractedTitle.replace(/[\r\n]+/g, ' ').trim().slice(0, 50);
          }
        }
        if (extractedTitle) {
          onItemLoaded?.(cascadeId, { summary: extractedTitle });
        }
        return { cascadeId, success: true };
      }
      return { cascadeId, success: false };
    });

    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.success) {
        activated++;
      } else {
        failed++;
      }
      onProgress?.(activated + failed, unindexedIds.length, r.cascadeId);
    }
    // 平滑延时
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return { activated, failed, total: unindexedIds.length };
}
