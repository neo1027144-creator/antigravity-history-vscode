/**
 * 会话摘要本地缓存管理模块
 *
 * 核心功能：
 * - 缓存最近一次成功获取的会话列表，实现 IDE 重启后的秒级极速渲染
 * - 在每次成功 API 刷新后增量更新本地 JSON 缓存文件
 *
 * 作者/更新时间: fengyun / 2026-08-14
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TrajectorySummary } from './ls-client.js';

const CACHE_DIR = path.join(os.homedir(), '.gemini', 'antigravity-history');
const CACHE_FILE = path.join(CACHE_DIR, 'cache.json');

interface CacheData {
  version: 1;
  updatedAt: string;
  conversations: Record<string, TrajectorySummary>;
}

/**
 * Read cached conversation summaries. Returns empty object on any error.
 */
export function readCache(): Record<string, TrajectorySummary> {
  try {
    if (!fs.existsSync(CACHE_FILE)) { return {}; }
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const data: CacheData = JSON.parse(raw);
    if (data.version !== 1) { return {}; }
    return data.conversations || {};
  } catch {
    return {};
  }
}

/**
 * Write conversation summaries to cache.
 */
export function writeCache(conversations: Record<string, TrajectorySummary>): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const data: CacheData = {
      version: 1,
      updatedAt: new Date().toISOString(),
      conversations,
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf-8');
  } catch {
    // Silently ignore write failures
  }
}
