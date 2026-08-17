/**
 * 语言服务进程探测与端口扫描模块
 *
 * 核心功能：
 * - 自动探测运行中的 Antigravity LanguageServer 实例
 * - 从进程命令行参数提取 CSRF Token 与 app_data_dir
 * - 扫描进程监听的本地端口
 *
 * 作者/更新时间: fengyun / 2026-08-14
 */

import { execSync } from 'child_process';
import * as os from 'os';

export interface LsProcess {
  pid: number;
  csrf: string;
  cmd: string;
  appDataDir?: string;
}

export interface LsEndpoint {
  port: number;
  csrf: string;
  pid: number;
  appDataDir?: string;
}

/**
 * 发现所有正在运行的 LanguageServer 进程
 */
export function discoverLanguageServers(): LsProcess[] {
  const system = os.platform();
  if (system === 'win32') {
    return discoverWindows();
  } else if (system === 'darwin') {
    return discoverMacOS();
  } else if (system === 'linux') {
    return discoverLinux();
  }
  return [];
}

/**
 * Windows 平台：通过 WMI 查询 language_server 进程
 */
function discoverWindows(): LsProcess[] {
  const servers: LsProcess[] = [];
  try {
    const cmd =
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'language_server*' } | " +
      'Select-Object ProcessId, CommandLine | ConvertTo-Json';
    const stdout = execSync(`powershell -Command "${cmd}"`, {
      timeout: 15000,
      encoding: 'utf-8',
      windowsHide: true,
    });
    if (!stdout.trim()) { return servers; }

    let data = JSON.parse(stdout);
    if (!Array.isArray(data)) { data = [data]; }

    for (const proc of data) {
      const cmdLine: string = proc.CommandLine || '';
      const pid: number = proc.ProcessId;
      if (!cmdLine) { continue; }
      const csrf = extractCsrf(cmdLine);
      const appDataDir = extractAppDataDir(cmdLine);
      servers.push({ pid, csrf, cmd: cmdLine, appDataDir });
    }
  } catch {
    // WMI 查询失败时安全忽略
  }
  return servers;
}

/**
 * macOS 平台：通过 pgrep + ps 查询进程
 */
function discoverMacOS(): LsProcess[] {
  const servers: LsProcess[] = [];
  try {
    const pids = execSync('pgrep -f language_server_macos', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim().split('\n').filter(Boolean);

    for (const pidStr of pids) {
      const pid = parseInt(pidStr, 10);
      if (isNaN(pid)) { continue; }
      try {
        const cmdLine = execSync(`ps -p ${pid} -o args=`, {
          encoding: 'utf-8',
          timeout: 3000,
        }).trim();
        const csrf = extractCsrf(cmdLine);
        const appDataDir = extractAppDataDir(cmdLine);
        servers.push({ pid, csrf, cmd: cmdLine, appDataDir });
      } catch {
        // 进程可能已退出
      }
    }
  } catch {
    // 未发现进程
  }
  return servers;
}

/**
 * Linux 平台：通过 pgrep + ps 查询进程
 */
function discoverLinux(): LsProcess[] {
  const servers: LsProcess[] = [];
  try {
    const pids = execSync('pgrep -f language_server', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim().split('\n').filter(Boolean);

    for (const pidStr of pids) {
      const pid = parseInt(pidStr, 10);
      if (isNaN(pid)) { continue; }
      try {
        const cmdLine = execSync(`ps -p ${pid} -o args=`, {
          encoding: 'utf-8',
          timeout: 3000,
        }).trim();
        const csrf = extractCsrf(cmdLine);
        const appDataDir = extractAppDataDir(cmdLine);
        servers.push({ pid, csrf, cmd: cmdLine, appDataDir });
      } catch {
        // 进程可能已退出
      }
    }
  } catch {
    // 未发现进程
  }
  return servers;
}

/**
 * 从命令行字符串中提取 --csrf_token 参数
 */
function extractCsrf(cmdLine: string): string {
  const m = cmdLine.match(/--csrf_token\s+(\S+)/);
  return m ? m[1] : '';
}

/**
 * 从命令行字符串中提取 --app_data_dir 参数
 */
export function extractAppDataDir(cmdLine: string): string | undefined {
  const m = cmdLine.match(/--app_data_dir\s+(\S+)/);
  return m ? m[1] : undefined;
}

/**
 * 查询指定进程正在监听的本地端口列表
 */
export function findPorts(pid: number): number[] {
  if (os.platform() === 'win32') {
    return findPortsWindows(pid);
  } else {
    return findPortsUnix(pid);
  }
}

function findPortsWindows(pid: number): number[] {
  const ports: number[] = [];
  try {
    const stdout = execSync('netstat -ano', {
      encoding: 'utf-8',
      timeout: 10000,
      windowsHide: true,
    });
    const pidStr = String(pid);
    for (const line of stdout.split('\n')) {
      if (line.includes('LISTENING') && line.includes(pidStr)) {
        const m = line.match(/127\.0\.0\.1:(\d+)/);
        if (m) { ports.push(parseInt(m[1], 10)); }
      }
    }
  } catch {
    // netstat 执行失败
  }
  return ports;
}

function findPortsUnix(pid: number): number[] {
  const ports: number[] = [];
  try {
    const stdout = execSync(`lsof -p ${pid} -i -P -n`, {
      encoding: 'utf-8',
      timeout: 5000,
    });
    for (const line of stdout.split('\n')) {
      if (line.includes('LISTEN')) {
        const m = line.match(/:(\d+)\s+\(LISTEN\)/);
        if (m) { ports.push(parseInt(m[1], 10)); }
      }
    }
  } catch {
    // lsof 执行失败
  }
  return ports;
}
