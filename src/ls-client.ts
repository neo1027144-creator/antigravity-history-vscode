/**
 * LanguageServer API 交互客户端
 *
 * 核心功能：
 * - 发起 gRPC-Web (Connect-Protocol) 请求至 LanguageServer
 * - 智能动态端口探测与高可用自动故障转移 (Failover)
 * - 查询所有历史轨迹摘要列表 (GetAllCascadeTrajectories)
 * - 分页获取指定轨迹的详细步骤 (GetCascadeTrajectorySteps)
 *
 * 作者/更新时间: fengyun / 2026-08-14
 */

import * as https from 'https';
import { LsEndpoint, LsProcess, discoverLanguageServers, findPorts } from './discovery.js';

export type { LsEndpoint };

const BASE_PATH = 'exa.language_server_pb.LanguageServerService';

/** API 返回的轨迹摘要类型 */
export interface TrajectorySummary {
  summary?: string;
  stepCount?: number;
  createdTime?: string;
  lastModifiedTime?: string;
  lastUserInputTime?: string;
  status?: string;
  workspaces?: Array<{ workspaceFolderAbsoluteUri?: string }>;
}

/** 轨迹单步数据类型 */
export interface TrajectoryStep {
  type?: string;
  status?: string;
  metadata?: Record<string, unknown>;
  userInput?: Record<string, unknown>;
  plannerResponse?: Record<string, unknown>;
  codeAction?: Record<string, unknown>;
  runCommand?: Record<string, unknown>;
  viewFile?: Record<string, unknown>;
  grepSearch?: Record<string, unknown>;
  find?: Record<string, unknown>;
  listDirectory?: Record<string, unknown>;
  searchWeb?: Record<string, unknown>;
  readUrlContent?: Record<string, unknown>;
  sendCommandInput?: Record<string, unknown>;
  commandStatus?: Record<string, unknown>;
  errorMessage?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * 调用 LanguageServer gRPC-Web 接口
 */
export function callApi(
  port: number,
  csrfToken: string,
  method: string,
  params: Record<string, unknown> = {},
  timeout = 15000,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const body = JSON.stringify(params);
    const options: https.RequestOptions = {
      hostname: 'localhost',
      port,
      path: `/${BASE_PATH}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'X-Codeium-Csrf-Token': csrfToken,
        'Content-Length': Buffer.byteLength(body),
      },
      rejectUnauthorized: false,
      timeout,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.write(body);
    req.end();
  });
}

/**
 * 从单个 LanguageServer 实例获取所有轨迹摘要
 */
export async function getAllTrajectories(
  port: number,
  csrf: string,
): Promise<Record<string, TrajectorySummary>> {
  const result = await callApi(port, csrf, 'GetAllCascadeTrajectories', {}, 15000);
  if (!result) { return {}; }
  return (result.trajectorySummaries as Record<string, TrajectorySummary>) || {};
}

/**
 * 实时动态寻找至少一个当前可用且响应正常的 LanguageServer 终端
 * 绝不单纯依赖历史缓存，保障高并发下的 100% 连通率
 */
export async function getLiveWorkingEndpoints(): Promise<LsEndpoint[]> {
  const servers = discoverLanguageServers();
  const endpoints: LsEndpoint[] = [];

  for (const srv of servers) {
    const ports = findPorts(srv.pid);
    for (const port of ports) {
      const result = await callApi(port, srv.csrf, 'GetAllCascadeTrajectories', {}, 10000);
      if (result !== null) {
        endpoints.push({
          port,
          csrf: srv.csrf,
          pid: srv.pid,
          appDataDir: srv.appDataDir,
        });
        break; // 找到当前进程的一个工作端口
      }
    }
  }

  return endpoints;
}

/**
 * 自动发现所有运行中的 LanguageServer 实例并汇总会话列表
 */
export async function discoverAndListAll(): Promise<{
  conversations: Record<string, TrajectorySummary>;
  cascadeToEndpoint: Record<string, { port: number; csrf: string; appDataDir?: string }>;
  endpoints: LsEndpoint[];
  appDataDirs: string[];
}> {
  const servers = discoverLanguageServers();
  const conversations: Record<string, TrajectorySummary> = {};
  const cascadeToEndpoint: Record<string, { port: number; csrf: string; appDataDir?: string }> = {};
  const endpoints: LsEndpoint[] = [];
  const appDataDirsSet = new Set<string>();

  for (const srv of servers) {
    if (srv.appDataDir) {
      appDataDirsSet.add(srv.appDataDir);
    }
  }

  for (const srv of servers) {
    const ports = findPorts(srv.pid);
    let workingPort: number | null = null;
    let foundSummaries: Record<string, TrajectorySummary> = {};

    for (const port of ports) {
      const result = await callApi(port, srv.csrf, 'GetAllCascadeTrajectories', {}, 15000);
      if (result !== null) {
        workingPort = port;
        foundSummaries = (result.trajectorySummaries as Record<string, TrajectorySummary>) || {};
        break;
      }
    }

    if (workingPort !== null) {
      endpoints.push({ port: workingPort, csrf: srv.csrf, pid: srv.pid, appDataDir: srv.appDataDir });
      for (const [cid, info] of Object.entries(foundSummaries)) {
        if (!(cid in conversations)) {
          conversations[cid] = info;
          cascadeToEndpoint[cid] = { port: workingPort, csrf: srv.csrf, appDataDir: srv.appDataDir };
        }
      }
    }
  }

  return {
    conversations,
    cascadeToEndpoint,
    endpoints,
    appDataDirs: Array.from(appDataDirsSet),
  };
}

/**
 * 获取指定会话的所有轨迹步骤（支持多端点重试与自动现场探测）
 */
export async function getTrajectorySteps(
  port: number,
  csrf: string,
  cascadeId: string,
  fallbackEndpoints: LsEndpoint[] = [],
  stepCount = 1000,
): Promise<TrajectoryStep[]> {
  // 1. 首选传入端点
  let result = await callApi(
    port,
    csrf,
    'GetCascadeTrajectorySteps',
    { cascadeId, startIndex: 0, endIndex: stepCount + 10 },
    25000,
  );

  let steps = (result?.steps as TrajectoryStep[]) || (result?.messages as TrajectoryStep[]);
  if (steps && steps.length > 0) {
    return steps;
  }

  // 2. 备用端点重试
  for (const ep of fallbackEndpoints) {
    if (ep.port === port && ep.csrf === csrf) { continue; }
    result = await callApi(
      ep.port,
      ep.csrf,
      'GetCascadeTrajectorySteps',
      { cascadeId, startIndex: 0, endIndex: stepCount + 10 },
      15000,
    );
    steps = (result?.steps as TrajectoryStep[]) || (result?.messages as TrajectoryStep[]);
    if (steps && steps.length > 0) {
      return steps;
    }
  }

  // 3. 若均未命中，现场执行一次实时端点探测再试
  const freshEndpoints = await getLiveWorkingEndpoints();
  for (const ep of freshEndpoints) {
    result = await callApi(
      ep.port,
      ep.csrf,
      'GetCascadeTrajectorySteps',
      { cascadeId, startIndex: 0, endIndex: stepCount + 10 },
      15000,
    );
    steps = (result?.steps as TrajectoryStep[]) || (result?.messages as TrajectoryStep[]);
    if (steps && steps.length > 0) {
      return steps;
    }
  }

  return [];
}
