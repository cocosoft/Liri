/**
 * SystemContext类型定义
 * 包含系统环境信息，如操作系统、Shell、Branch等
 *
 * 参考CC源码实现: cc_code/backend/context.ts
 */

import type { Context } from './Context.js';

/**
 * 操作系统类型
 */
export type OSType = 'windows' | 'macos' | 'linux' | 'unknown';

/**
 * Shell类型
 */
export type ShellType = 'bash' | 'zsh' | 'fish' | 'pwsh' | 'cmd' | 'unknown';

/**
 * SystemContext接口
 * 描述系统环境和配置信息
 */
export interface SystemContext extends Context {
  type: 'system';

  /** 操作系统类型 */
  os: OSType;

  /** 操作系统版本 */
  osVersion?: string;

  /** 主机名 */
  hostname?: string;

  /** 当前工作目录 */
  cwd: string;

  /** Shell类型 */
  shell: ShellType;

  /** Shell路径 */
  shellPath?: string;

  /** Git分支 */
  gitBranch?: string;

  /** Git主分支 */
  gitMainBranch?: string;

  /** Git状态 */
  gitStatus?: string;

  /** Git用户名 */
  gitUserName?: string;

  /** 是否为Git仓库 */
  isGitRepo: boolean;

  /** 当前时间戳 */
  timestamp: number;

  /** 时区 */
  timezone?: string;

  /** 用户名 */
  username?: string;

  /** 用户主目录 */
  homeDir?: string;

  /** PATH环境变量 */
  pathEnv?: string;

  /** 语言/区域设置 */
  locale?: string;

  /** Python版本（如果可用） */
  pythonVersion?: string;

  /** Node.js版本（如果可用） */
  nodeVersion?: string;

  /** 已安装的工具列表 */
  installedTools?: string[];
}

/**
 * 创建默认SystemContext
 * @param cwd 当前工作目录
 * @returns 默认SystemContext
 */
export function createDefaultSystemContext(cwd: string): SystemContext {
  return {
    type: 'system',
    os: 'unknown',
    cwd,
    shell: 'unknown',
    isGitRepo: false,
    timestamp: Date.now(),
    createdAt: new Date(),
  };
}

export default SystemContext;
