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
 * 防止 Agent 循环触碰敏感文件路径（.env、凭据、私钥等）。
 *
 * 配置来源：
 *   - 默认拒绝列表（内置）
 *   - 环境变量 LOOP_PATH_DENY_LIST（JSON 数组，追加到默认列表）
 *   - 环境变量 LOOP_PATH_GUARD_MODE（enforce | observe，默认 enforce）：observe 时
 *     命中拒绝列表只告警不拦截，用于消除误报且不影响其它循环防护（O25 ③）
 *
 * O25 修复（2026-09-12）：收紧误报面 —— 此前只拦"名字/目录名长得像密钥"的路径，
 * 结果把**模板文件与自家源码**一并拦死（实测：`app/.env.example` 被 `.env` 通配规则拦；
 * `auth/`、`credentials/`、`secrets/` 目录下的 **30 个真实源文件**被目录名规则拦）。
 * 现改为：**只拦真正的凭据数据文件**，模板文件与源码/文档一律放行（见下方三段常量）。
 */

import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring';
import { isShellToolName, extractPathArgs } from '@modules/constants';
import { isLoopObserveOnly, getPathGuardMode } from './loop-config.js';

const logger = getLogger('query:pathGuard');

/** 默认拒绝的路径模式（glob）—— 仅覆盖**凭据数据文件 / 私钥**形态 */
const DEFAULT_DENY_PATTERNS: string[] = [
  '**/.env',
  '**/.env.*',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
  '**/id_rsa*',
  '**/credentials.json',
  '**/secrets.json',
  '**/service-account*.json',
];

/**
 * 受保护目录：**只拦其中的凭据数据文件**，源码/文档放行（O25）
 *
 * 此前把这些目录名整体拦死 → Agent 读不了自家鉴权/凭据管理代码：
 * 本仓库 `auth/`、`credentials/`、`secrets/` 下的真实源文件有 30 个
 *（如 `src/ai/credentials/CredentialStore.ts`、`src/system/auth/AuthManager.ts`）。
 * 要拦的是"凭据"，不是"处理凭据的代码"。
 */
const PROTECTED_DIR_PATTERNS: string[] = [
  '**/auth/**',
  '**/credentials/**',
  '**/secrets/**',
  '**/payments/**',
];

/**
 * 名称像密钥但**不含真实密钥**的模板文件 → 放行（O25）
 *
 * `.env.*` 通配规则原先把 `.env.example` 一并拦下，而它是**已入库的模板、无任何密钥**；
 * 本次故障的触发点正是对 `app/.env.example` 的 grep。
 */
const NON_SECRET_ALLOW_PATTERNS: string[] = [
  '**/.env.example',
  '**/.env.example.*',
  '**/.env.sample',
  '**/.env.template',
  '**/.env.dist',
  '**/.env.defaults',
];

/**
 * 受保护目录内**允许**读取的扩展名（源码 / 文档 / 样式）
 *
 * 与 `PROTECTED_DIR_PATTERNS` 配合：目录内**非**这些扩展名的文件
 *（`.json` / `.yaml` / `.env` / 无扩展名等）才按凭据数据文件拦截。
 */
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.md',
  '.mdx',
  '.css',
  '.scss',
  '.html',
  '.vue',
  '.rs',
]);

/** 默认拒绝的写入路径（更严格） */
const DEFAULT_DENY_WRITE_PATTERNS: string[] = [
  ...DEFAULT_DENY_PATTERNS,
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/bun.lockb',
  '**/Cargo.lock',
];

/**
 * 路径类参数名 / 提取逻辑已收敛到 `@modules/constants`（O27，2026-09-12）
 *
 * 原实现在此处维护一份（`PATH_ARG_KEYS` + 键形启发式），permission 侧若要按路径判定
 * 会再写一份 → 各写一份必然漂移。现两处共用 `isPathArgKey` / `extractPathArgs`。
 */

/** 输出类参数名 → 按写语义校验（denyWrite ⊃ denyRead） */
const WRITE_ARG_KEYS: ReadonlySet<string> = new Set([
  'outputPath',
  'savePath',
  'saveToFile',
  'filePaths',
]);

/**
 * shell 命令串的 token：引号内的空白视为同一 token（`"C:\Program Files\x\.env"` 不被空格切断）
 */
const SHELL_TOKEN = /"[^"]*"|'[^']*'|[^\s]+/g;

/** shell 操作符（不参与路径判定） */
const SHELL_OPERATORS: ReadonlySet<string> = new Set([
  '&&',
  '||',
  '|',
  ';',
  '>',
  '>>',
  '<',
  '&',
]);

/** 切换目录命令（用于解析其后的相对路径） */
const CD_COMMANDS: ReadonlySet<string> = new Set([
  'cd',
  'chdir',
  'set-location',
]);

/**
 * 裸 token 视为"相对文件"的条件：**带扩展名**（O28①）
 *
 * 收紧原因：`cd secrets && type token.json` 里 `token.json` 是相对文件，
 * 而 `ls`/`type`/`dir` 是命令词 —— 若不加扩展名限制，`cd secrets && ls`
 * 会被拼成 `secrets/ls`（命中受保护目录规则）而误报。
 */
const BARE_FILE_TOKEN = /\.[A-Za-z0-9]{1,8}$/;

/**
 * 清洗 shell token：去除首尾引号/反引号，并剥离尾随的 shell 操作符
 *
 * 例：`cd secrets; type token.json` 中 `;` 紧贴前词 → token 为 `secrets;`，
 * 不清洗会把基准目录记成 `secrets;`，导致相对路径判定失效（O28① 实测）。
 */
function cleanShellToken(token: string): string {
  return token
    .replace(/^["'`]+/, '')
    .replace(/["'`]+$/, '')
    .replace(/[;&|<>]+$/, '');
}

/** 写类工具名（沿用既有语义，补上工具箱实际注册名） */
const WRITE_TOOL_NAMES: readonly string[] = [
  'file_write',
  'file_edit',
  'write_file',
  'write',
  'edit_file',
  'replace_in_file',
  'create_file',
  'delete_file',
  'delete_files',
  'write_project_file',
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
    const paths = this._extractPaths(toolName, args);
    if (paths.length === 0) return { allowed: true }; // 没有路径参数，放行

    const isWrite = this._isWriteTool(toolName) || this._hasWriteArg(args);

    // O25 ③（2026-09-12）：PathGuard 独立降级开关 —— `LOOP_PATH_GUARD_MODE=observe`
    // 仅告警不拦截，且**不牵连**其它循环检测器（`LOOP_OBSERVE_ONLY` 保留为全局等价开关）。
    const observeOnly = getPathGuardMode() === 'observe' || isLoopObserveOnly();

    for (const path of paths) {
      const result = isWrite ? this.checkWrite(path) : this.checkRead(path);
      if (result.allowed) continue;
      if (observeOnly) {
        logger.warn(`[OBSERVE] PathGuard 本应拦截工具调用`, {
          tool: toolName,
          path,
          reason: result.reason,
        });
        continue;
      }
      return result;
    }

    return { allowed: true };
  }

  /**
   * 归一化路径后做三段判定（O25）
   *
   * ① 模板/示例文件（`.env.example` 等）→ **放行**（名称像密钥但不含真实密钥）
   * ② 凭据数据文件 / 私钥（`.env`、`*.pem`、`credentials.json` 等）→ 拦截
   * ③ 受保护目录（`auth/`、`credentials/`、`secrets/`、`payments/`）内**非源码/文档**的文件 → 拦截
   *    （目录内的 `.ts`/`.md` 等源码与文档放行：要拦的是凭据，不是处理凭据的代码）
   */
  private _check(
    targetPath: string,
    patterns: string[],
    operation: string
  ): PathCheckResult {
    const normalized = targetPath.replace(/\\/g, '/').toLowerCase();

    // ① 模板/示例文件放行
    for (const pattern of NON_SECRET_ALLOW_PATTERNS) {
      if (getCachedRegex(pattern).test(normalized)) {
        return { allowed: true };
      }
    }

    // ② 常规拒绝模式（凭据数据文件 / 私钥 / .env 实体）
    for (const pattern of patterns) {
      const regex = getCachedRegex(pattern.toLowerCase());
      if (regex.test(normalized)) {
        return {
          allowed: false,
          reason: `路径 "${targetPath}" 命中拒绝列表 (${operation}: ${pattern})`,
        };
      }
    }

    // ③ 受保护目录：仅当**不是**源码/文档时拦截
    const lastSlash = normalized.lastIndexOf('/');
    const lastDot = normalized.lastIndexOf('.');
    const ext = lastDot > lastSlash ? normalized.slice(lastDot) : '';
    if (!SOURCE_EXTENSIONS.has(ext)) {
      for (const pattern of PROTECTED_DIR_PATTERNS) {
        if (getCachedRegex(pattern).test(normalized)) {
          return {
            allowed: false,
            reason: `路径 "${targetPath}" 位于受保护目录且非源码/文档 (${operation}: ${pattern})`,
          };
        }
      }
    }

    return { allowed: true };
  }

  /**
   * 提取工具调用中的**全部**路径参数（O26）
   *
   * ① 普通工具：按**参数名**（`PATH_ARG_KEYS`）扫描 args，兼容字符串与字符串数组；
   * ② shell 类工具：路径藏在命令串里 → 走 `_pathsFromCommand`。
   *
   * 原实现按工具名白名单取值，新增/改名工具会**静默失效**（O26 实测），故改为参数名驱动。
   */
  private _extractPaths(
    toolName: string,
    args: Record<string, unknown>
  ): string[] {
    if (isShellToolName(toolName)) {
      return this._pathsFromCommand(args);
    }

    return extractPathArgs(args);
  }

  /**
   * 从 shell 命令串中提取候选路径 token（O26 / O28①）
   *
   * 覆盖三类形态：
   *   ① 含分隔符的路径（`C:\x\.ssh\id_rsa`、`./.env`、`~/.pyapp/credentials/x.json`）
   *   ② 引号包裹的含空格路径（`"C:\Program Files\x\.env"`）
   *   ③ **裸文件名 / 相对文件名**（`type .env`、`copy .env out.txt`；后者按 `cd <dir>` 基准拼成
   *      `<dir>/<file>` 再判定）
   *
   * 取向：宁可多提（误报面由拒绝列表本身收窄）；跳过 URL 与 shell 操作符；
   * 裸 token 仅当**带扩展名**才当文件（避免把 `ls`/`type` 拼成 `<dir>/ls` 造成误报）。
   */
  private _pathsFromCommand(args: Record<string, unknown>): string[] {
    const command = typeof args.command === 'string' ? args.command : '';
    if (!command) return [];

    const tokens = command.match(SHELL_TOKEN) ?? [];
    const paths: string[] = [];
    let baseDir = '';

    for (let i = 0; i < tokens.length; i++) {
      const raw = cleanShellToken(tokens[i]);
      if (!raw || raw.includes('://')) continue;

      if (CD_COMMANDS.has(raw.toLowerCase())) {
        const next = cleanShellToken(tokens[i + 1] ?? '');
        if (next && !next.startsWith('-')) baseDir = next;
        continue;
      }
      if (SHELL_OPERATORS.has(raw)) continue;

      // ① 含分隔符 / 盘符 / UNC / `~/`
      if (/[\\/]/.test(raw) || /^[A-Za-z]:$/.test(raw)) {
        paths.push(raw);
        continue;
      }

      // ③ 裸文件名 / 相对文件名（带扩展名才算文件，`-flag` 与命令词跳过）
      if (raw.startsWith('-') || !BARE_FILE_TOKEN.test(raw)) continue;
      paths.push(raw);
      if (baseDir) paths.push(`${baseDir}/${raw}`);
    }

    return paths;
  }

  /**
   * 判断是否写操作工具
   */
  private _isWriteTool(toolName: string): boolean {
    return WRITE_TOOL_NAMES.includes(toolName.toLowerCase());
  }

  /** 是否含输出类路径参数（按写语义校验） */
  private _hasWriteArg(args: Record<string, unknown>): boolean {
    return Object.keys(args).some((key) => WRITE_ARG_KEYS.has(key));
  }
}

/** 工厂函数 */
export function createPathGuard(): PathGuard {
  return new PathGuard();
}
