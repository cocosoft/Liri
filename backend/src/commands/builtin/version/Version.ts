/**
 * Version命令
 * 显示系统版本信息
 *
 * 对标 CC 源码 cc_code/backend/commands/version.ts
 * CC 通过构建宏 MACRO.VERSION / MACRO.BUILD_TIME 注入版本信息，
 * PY_APP 从 package.json 读取运行时版本信息。
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { CommandContext } from '@modules/commands/types';

/**
 * 包信息缓存
 */
let cachedPackage: Record<string, any> | null = null;

/**
 * 读取并缓存 package.json
 */
function readPackageInfo(): Record<string, any> {
  if (cachedPackage) {
    return cachedPackage;
  }

  try {
    const packagePath = join(process.cwd(), 'package.json');
    if (existsSync(packagePath)) {
      const content = readFileSync(packagePath, 'utf8');
      cachedPackage = JSON.parse(content);
    }
  } catch {
    // 读取失败时使用默认值
  }

  if (!cachedPackage) {
    cachedPackage = {
      name: 'PY_APP',
      version: '1.0.0',
      description: '基于 TypeScript + Rust 架构的 AI Agent 项目',
    };
  }

  return cachedPackage;
}

/**
 * 获取版本信息对象
 */
function getVersionInfo() {
  const pkg = readPackageInfo();

  return {
    appName: pkg.name || 'PY_APP',
    version: pkg.version || '1.0.0',
    description: pkg.description || '',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    pid: process.pid,
    uptime: Math.floor(process.uptime()),
  };
}

/**
 * 格式化运行时间
 */
function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}小时`);
  if (m > 0) parts.push(`${m}分`);
  parts.push(`${s}秒`);
  return parts.join('');
}

/**
 * 版本命令实现
 */
const versionCommand = {
  async execute(args: string, context: CommandContext) {
    const trimmed = args.trim();

    try {
      if (trimmed === 'help') {
        return handleHelp();
      }

      if (trimmed === 'status') {
        return handleStatus();
      }

      if (trimmed === '--json') {
        return handleJsonVersion();
      }

      return handleVersion();
    } catch (error) {
      return {
        success: false,
        message: `获取版本信息失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },
};

/**
 * 处理默认版本显示
 */
async function handleVersion() {
  const info = getVersionInfo();

  (await import('@modules/services/analytics/index.js')).logEvent(
    'tengu_version_checked',
    {
      version: info.version,
      platform: info.platform,
      arch: info.arch,
    }
  );

  return {
    success: true,
    message: [
      `${info.appName} Version: ${info.version}`,
      info.description ? `Description: ${info.description}` : '',
      `Node.js: ${info.nodeVersion}`,
      `Platform: ${info.platform} ${info.arch}`,
      `PID: ${info.pid}`,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

/**
 * 处理 help 子命令
 */
async function handleHelp() {
  return {
    success: true,
    message: [
      '版本信息帮助',
      '==============',
      '',
      '查看 PY_APP 系统版本和运行环境信息。',
      '',
      '用法:',
      '  /version          - 显示版本信息',
      '  /version status   - 显示详细状态（含运行时间、工作目录）',
      '  /version --json   - 以 JSON 格式输出',
      '  /version help     - 显示本帮助',
      '',
      '版本信息包含:',
      '  - 应用名称与版本号',
      '  - 应用描述',
      '  - Node.js 版本',
      '  - 操作系统平台与架构',
      '',
      '状态信息额外包含:',
      '  - 进程 ID',
      '  - 运行时长',
      '  - 当前工作目录',
      '',
      '示例:',
      '  /version',
      '  /version status',
      '  /version --json',
      '',
      '别名: /v, /ver',
    ].join('\n'),
  };
}

/**
 * 处理 status 子命令
 */
async function handleStatus() {
  const info = getVersionInfo();
  const uptimeStr = formatUptime(info.uptime);

  return {
    success: true,
    message: [
      'PY_APP 运行状态',
      '==============',
      '',
      `应用名称: ${info.appName}`,
      `版本号: ${info.version}`,
      `描述: ${info.description}`,
      `Node.js 版本: ${info.nodeVersion}`,
      `操作系统: ${info.platform} ${info.arch}`,
      `进程 PID: ${info.pid}`,
      `运行时长: ${uptimeStr}`,
      `工作目录: ${info.cwd}`,
    ].join('\n'),
  };
}

/**
 * 处理 JSON 格式输出
 */
async function handleJsonVersion() {
  const info = getVersionInfo();

  const data = {
    appName: info.appName,
    version: info.version,
    description: info.description,
    runtime: {
      nodeVersion: info.nodeVersion,
      platform: info.platform,
      arch: info.arch,
    },
    process: {
      pid: info.pid,
      uptime: info.uptime,
      cwd: info.cwd,
    },
  };

  return {
    success: true,
    message: JSON.stringify(data, null, 2),
  };
}

export default versionCommand;
