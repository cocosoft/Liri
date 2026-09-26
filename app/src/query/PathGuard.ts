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

import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring';
import { isLoopObserveOnly } from './loop-config.js';
import {
  FILE_READ_TOOLS,
  SEARCH_TOOLS as SHARED_SEARCH_TOOLS,
  WRITE_TOOLS as SHARED_WRITE_TOOLS,
} from './tool-constants.js';

const logger = getLogger('query:pathGuard');

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
    const raw = configManager.env('LOOP_PATH_DENY_LIST');
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

/**
 * 路径提取与读/写分级所用的工具名集合。
 *
 * **真实名来自 `./tool-constants.js`（与 `FileIOLoopDetector` 共享取值 —— 裁定①：不可硬并、共享取值）**；
 * 本文件只在其上**扩展**一类成员：**工具别名** —— 模型可能按别名调用（`read` / `cat` / `write` /
 * `echo` / `find` / …），而别名解析发生在守卫之后，故守卫必须一并容忍（别名取自各工具类的 `aliases` 声明）。
 * `notebook`（写 `.ipynb`，入参键 `notebook_path`）已含于共享写集合，无需另列。
 *
 * ⚠️ 2026-09-26 修复（本仓「名字漂移」家族第 ⑤ 处）：本文件原有**自带内联清单**，且与
 * `tool-constants` 同型地抄了 CC 名（`write_file` / `edit_file` / `replace_in_file` / …）⇒
 * `_extractPath` 恒返回 null（`checkToolCall()` 走「无路径参数」分支**直接放行** ⇒ 守卫完全不生效）、
 * `_isWriteTool` 恒 false（含锁文件的 `checkWrite()` 分支不可达）。
 */

/** 整文件读（入参键 `file_path`）+ 别名 */
const READ_FILE_TOOL_NAMES = new Set([...FILE_READ_TOOLS, 'read', 'cat']);

/** 搜索类读（入参键 `path` / `searchPath`）+ 别名 */
const SEARCH_TOOL_NAMES = new Set([
  ...SHARED_SEARCH_TOOLS,
  'find',
  'files',
  'search',
  'regex',
  'find_text',
  'search_files',
  'find_files',
]);

/** 写类（入参键 `file_path` / `notebook_path`）+ 别名 */
const WRITE_TOOL_NAMES = new Set([...SHARED_WRITE_TOOLS, 'write', 'echo']);

/** 按候选顺序取第一个字符串型路径参数 */
function pickPathArg(
  args: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string') return value;
  }
  return null;
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
    if (!result.allowed && isLoopObserveOnly()) {
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
   *
   * 参数名判据 = 工具类的 `params` 声明（`file_read`/`file_write`/`file_edit` 均为 `file_path`；
   * `notebook` 为 `notebook_path`；`glob` 为 `path`，`grep`/`file_search` 为 `searchPath`）。
   * 旧名 `path`/`filePath` 保留为兜底。
   */
  private _extractPath(
    toolName: string,
    args: Record<string, unknown>
  ): string | null {
    // 整文件读类工具
    if (READ_FILE_TOOL_NAMES.has(toolName)) {
      return pickPathArg(args, ['file_path', 'path', 'filePath']);
    }
    // 写文件类工具
    if (WRITE_TOOL_NAMES.has(toolName)) {
      return pickPathArg(args, [
        'file_path',
        'notebook_path',
        'path',
        'filePath',
      ]);
    }
    // 搜索/glob 类
    if (SEARCH_TOOL_NAMES.has(toolName)) {
      return pickPathArg(args, [
        'path',
        'directory',
        'searchPath',
        'target_directory',
      ]);
    }
    return null;
  }

  /**
   * 判断是否写操作工具
   *
   * 与 `_extractPath()` 的写分支共用 `WRITE_TOOL_NAMES`（其真实名来自 `./tool-constants.js`）。
   */
  private _isWriteTool(toolName: string): boolean {
    return WRITE_TOOL_NAMES.has(toolName);
  }
}

/** 工厂函数 */
export function createPathGuard(): PathGuard {
  return new PathGuard();
}
