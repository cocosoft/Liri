// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * PathGuard — 路径安全守卫
 *
 * Phase 1 新增。对标 loop-engineering 的路径拒绝列表机制。
 * 防止 Agent 循环触碰敏感文件路径（.env、auth/、payments/、secrets/ 等）。
 *
 * 配置来源：
 *   - 默认拒绝列表（内置）
 *   - 环境变量 LOOP_PATH_DENY_LIST（JSON 数组，追加到默认列表）
 */

import { Logger } from '@modules/monitoring';
import { LOOP_OBSERVE_ONLY } from './loop-config.js';

const logger = new Logger({ module: 'query:pathGuard' });

/** 默认拒绝的路径模式（glob） */
const DEFAULT_DENY_PATTERNS: string[] = [
  '**/.env',
  '**/.env.*',
  '**/auth/**',
  '**/payments/**',
  '**/secrets/**',
  '**/credentials/**',
  '**/*.pem',
  '**/*.key',
  '**/id_rsa*',
];

/** 默认拒绝的写入路径（更严格） */
const DEFAULT_DENY_WRITE_PATTERNS: string[] = [
  ...DEFAULT_DENY_PATTERNS,
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/bun.lockb',
  '**/Cargo.lock',
];

export interface PathGuardConfig {
  /** 只读操作拒绝的路径模式 */
  denyRead: string[];
  /** 写入操作拒绝的路径模式（继承 denyRead） */
  denyWrite: string[];
}

export interface PathCheckResult {
  allowed: boolean;
  reason?: string;
}

/** 加载环境变量追加配置 */
function loadEnvDenyPatterns(): string[] {
  try {
    const raw = process.env.LOOP_PATH_DENY_LIST;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === 'string');
  } catch {
    return [];
  }
}

/**
 * 将 glob 模式转换为正则表达式
 * 支持 **、*、? 等基本 glob 语法
 */
function globToRegex(pattern: string): RegExp {
  let regexStr = '';

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];

    if (ch === '*' && pattern[i + 1] === '*') {
      // ** 匹配任意路径段（包括 /）
      i++; // 跳过第二个 *
      if (pattern[i + 1] === '/') {
        i++; // 跳过 /
        regexStr += '(?:.*/)?';
      } else {
        regexStr += '.*';
      }
    } else if (ch === '*') {
      // * 匹配单段内任意字符（不含 /）
      regexStr += '[^/]*';
    } else if (ch === '?') {
      regexStr += '[^/]';
    } else if (ch === '.') {
      regexStr += '\\.';
    } else {
      // 转义其他正则特殊字符
      regexStr += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }

  return new RegExp('^' + regexStr + '$');
}

/** 缓存已编译的 glob 正则 */
const regexCache = new Map<string, RegExp>();

function getCachedRegex(pattern: string): RegExp {
  let cached = regexCache.get(pattern);
  if (!cached) {
    cached = globToRegex(pattern);
    regexCache.set(pattern, cached);
  }
  return cached;
}

export class PathGuard {
  private config: PathGuardConfig;

  constructor() {
    const envPatterns = loadEnvDenyPatterns();

    this.config = {
      denyRead: [...DEFAULT_DENY_PATTERNS, ...envPatterns],
      denyWrite: [...DEFAULT_DENY_WRITE_PATTERNS, ...envPatterns],
    };
  }

  /**
   * 检查读取操作的目标路径是否允许
   */
  checkRead(targetPath: string): PathCheckResult {
    return this._check(targetPath, this.config.denyRead, 'read');
  }

  /**
   * 检查写入操作的目标路径是否允许
   */
  checkWrite(targetPath: string): PathCheckResult {
    return this._check(targetPath, this.config.denyWrite, 'write');
  }

  /**
   * 检查工具调用是否允许（根据 toolName 判断读/写）
   */
  checkToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): PathCheckResult {
    const path = this._extractPath(toolName, args);
    if (!path) return { allowed: true }; // 没有路径参数，放行

    const isWrite = this._isWriteTool(toolName);
    const result = isWrite ? this.checkWrite(path) : this.checkRead(path);

    // observeOnly 模式：降级为警告（不阻断）
    if (!result.allowed && LOOP_OBSERVE_ONLY) {
      logger.warn(`[OBSERVE] PathGuard 本应拦截工具调用`, {
        tool: toolName,
        path,
        reason: result.reason,
      });
      return { allowed: true };
    }

    return result;
  }

  /**
   * 归一化路径后做 glob 匹配
   */
  private _check(
    targetPath: string,
    patterns: string[],
    operation: string
  ): PathCheckResult {
    const normalized = targetPath.replace(/\\/g, '/').toLowerCase();

    for (const pattern of patterns) {
      const regex = getCachedRegex(pattern.toLowerCase());
      if (regex.test(normalized)) {
        return {
          allowed: false,
          reason: `路径 "${targetPath}" 命中拒绝列表 (${operation}: ${pattern})`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * 从工具调用 args 中提取路径参数
   */
  private _extractPath(
    toolName: string,
    args: Record<string, unknown>
  ): string | null {
    // 读文件类工具
    if (['read_file', 'read', 'cat'].includes(toolName)) {
      return typeof args.path === 'string'
        ? args.path
        : typeof args.filePath === 'string'
          ? args.filePath
          : null;
    }
    // 写文件类工具
    if (
      ['write_file', 'write', 'edit_file', 'replace_in_file'].includes(toolName)
    ) {
      return typeof args.path === 'string'
        ? args.path
        : typeof args.filePath === 'string'
          ? args.filePath
          : null;
    }
    // 搜索/glob 类
    if (['glob', 'grep', 'search_files', 'search_content'].includes(toolName)) {
      return typeof args.path === 'string'
        ? args.path
        : typeof args.directory === 'string'
          ? args.directory
          : typeof args.searchPath === 'string'
            ? args.searchPath
            : typeof args.target_directory === 'string'
              ? args.target_directory
              : null;
    }
    return null;
  }

  /**
   * 判断是否写操作工具
   */
  private _isWriteTool(toolName: string): boolean {
    const writeTools = [
      'write_file',
      'write',
      'edit_file',
      'replace_in_file',
      'create_file',
      'delete_file',
      'delete_files',
    ];
    return writeTools.includes(toolName);
  }
}

/** 工厂函数 */
export function createPathGuard(): PathGuard {
  return new PathGuard();
}
