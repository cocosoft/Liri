/**
 * ShellContext类型定义
 * 包含Shell环境信息
 *
 * 参考CC源码实现: cc_code/backend/utils/Shell.ts
 */

import type { Context } from './Context.js';

/**
 * Shell类型
 */
export type ShellType =
  | 'bash'
  | 'zsh'
  | 'fish'
  | 'pwsh'
  | 'cmd'
  | 'sh'
  | 'unknown';

/**
 * 环境变量
 */
export interface EnvVariable {
  key: string;
  value: string;
  isExport?: boolean;
}

/**
 * Shell历史记录条目
 */
export interface ShellHistoryEntry {
  command: string;
  timestamp: Date;
  duration?: number;
  exitCode?: number;
}

/**
 * Shell上下文信息
 */
export interface ShellContext extends Context {
  type: 'shell';

  /** Shell类型 */
  shellType: ShellType;

  /** Shell路径 */
  shellPath: string;

  /** 当前工作目录 */
  cwd: string;

  /** 主目录 */
  homeDir: string;

  /** 用户名 */
  username: string;

  /** 环境变量列表 */
  envVariables: EnvVariable[];

  /** PATH变量 */
  path: string[];

  /** Shell历史记录 */
  history: ShellHistoryEntry[];

  /** 提示符格式 */
  promptFormat?: string;

  /** 支持的颜色数 */
  colorSupport?: number;

  /** 终端类型 */
  termType?: string;

  /** 是否为交互式Shell */
  isInteractive: boolean;
}

/**
 * 创建默认ShellContext
 * @param cwd 当前工作目录
 * @returns 默认ShellContext
 */
export function createDefaultShellContext(cwd: string): ShellContext {
  return {
    type: 'shell',
    shellType: 'unknown',
    shellPath: '',
    cwd,
    homeDir: '',
    username: '',
    envVariables: [],
    path: [],
    history: [],
    isInteractive: false,
    createdAt: new Date(),
  };
}

export default ShellContext;
