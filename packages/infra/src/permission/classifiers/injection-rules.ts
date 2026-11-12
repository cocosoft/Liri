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
 * 代码注入类检测规则（FSZ-003）
 * 从 AutoModeClassifier.ts 提取（FSZ-003 拆分），由 heuristicClassify 按原顺序调用。
 */

import type { ClassifierDecision } from './classifierDecision';
// 2026-11-10（方案①）：命令词按命令位匹配（与 AutoModeClassifier 同一实现）
import { containsCommandToken } from './command-token-match';

/**
 * 检测Unicode零宽字符注入
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectZeroWidthCharacters(
  input: string,
  patterns: string[]
): ClassifierDecision | null {
  for (const zeroWidth of patterns) {
    if (input.includes(zeroWidth)) {
      return {
        shouldBlock: true,
        reason: 'Input contains Unicode zero-width characters',
      };
    }
  }
  return null;
}

/**
 * 检测空字节注入
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectNullByteInjection(
  input: string
): ClassifierDecision | null {
  // 检查空字节
  if (input.includes('\x00')) {
    return {
      shouldBlock: true,
      reason: 'Input contains null byte injection',
    };
  }

  // 检查URL编码的空字节
  if (input.includes('%00')) {
    return {
      shouldBlock: true,
      reason: 'Input contains URL-encoded null byte injection',
    };
  }

  // 检查Unicode编码的空字节
  if (input.includes('\u0000')) {
    return {
      shouldBlock: true,
      reason: 'Input contains Unicode null byte injection',
    };
  }

  return null;
}

/**
 * 检测Zsh equals expansion攻击
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectZshEqualsExpansion(
  input: string
): ClassifierDecision | null {
  // Zsh equals expansion模式：=command
  const zshPatterns = [
    '=rm',
    '=sh',
    '=bash',
    '=cp',
    '=mv',
    '=cat',
    '=echo',
    '=kill',
    '=sudo',
    '=su',
    '=curl',
    '=wget',
    '=python',
    '=perl',
    '=ruby',
    '=node',
    '=gcc',
    '=make',
    '=docker',
    '=kubectl',
    '=ssh',
    '=scp',
    '=rsync',
    '=git',
    '=npm',
    '=pip',
    '=gem',
    '=cargo',
    '=go',
    '=rustup',
    '=composer',
  ];

  for (const pattern of zshPatterns) {
    if (input.includes(pattern)) {
      return {
        shouldBlock: true,
        reason: `Input contains Zsh equals expansion attack pattern: "${pattern}"`,
      };
    }
  }

  return null;
}

/**
 * 完整的 Unicode 转义序列（`\u4f60` / `\u{1F600}`）。
 *
 * 2026-11-10（真机 `session_mwafnqnjdbfc550f7b`）：原实现用 `includes('\\u')`，而调用方传的是
 * `JSON.stringify(input).toLowerCase()` —— Windows 绝对路径 `C:\Users\…` 转义后是
 * `c:\\users\\…`，同样命中 ⇒ 正常的 `file_write` 被判「Unicode 编码攻击」，连续 2 轮被拦后
 * 整轮 `environment_blocked`（任务直接失败）。改为**要求完整转义序列**：真正的转义攻击仍拦，
 * 路径里的"反斜杠 + u"不再误报。
 */
const UNICODE_ESCAPE_PATTERN = /\\u(?:\{[0-9a-f]{1,6}\}|[0-9a-f]{4})/i;

/** 完整的十六进制转义序列（`\x41`）；同理避免 `C:\x…` 这类路径误报 */
const HEX_ESCAPE_PATTERN = /\\x[0-9a-f]{2}/i;

/**
 * 检测编码攻击（Base64、URL编码等）
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectEncodingAttack(input: string): ClassifierDecision | null {
  // 检查Base64编码模式
  if (
    input.includes('base64') &&
    (input.includes('-d') || input.includes('--decode'))
  ) {
    return {
      shouldBlock: true,
      reason: 'Input contains Base64 decoding command',
    };
  }

  // 检查URL编码模式
  if (input.includes('%2e') || input.includes('%2f') || input.includes('%5c')) {
    return {
      shouldBlock: true,
      reason: 'Input contains URL-encoded path traversal characters',
    };
  }

  // 检查Unicode编码模式（要求完整转义序列，见 `UNICODE_ESCAPE_PATTERN`）
  if (input.includes('%u') || UNICODE_ESCAPE_PATTERN.test(input)) {
    return {
      shouldBlock: true,
      reason: 'Input contains Unicode encoding attack',
    };
  }

  // 检查十六进制编码模式（`\x` 要求完整转义；`0x` 沿用原判定）
  if (HEX_ESCAPE_PATTERN.test(input) || input.includes('0x')) {
    return {
      shouldBlock: true,
      reason: 'Input contains hexadecimal encoding attack',
    };
  }

  // 检查printf编码模式
  if (input.includes('printf') && HEX_ESCAPE_PATTERN.test(input)) {
    return {
      shouldBlock: true,
      reason: 'Input contains printf encoding attack',
    };
  }

  return null;
}

/**
 * `detectSqlInjection` 中与 shell **普通子命令同形**的关键字（必须按命令位判定）。
 *
 * 2026-11-11（P3）：原实现一律 `input.includes(pattern)` ⇒ `kubectl delete pod x`、
 * `gh release delete v1`、`git commit -m "update readme"` 都被记成「SQL 注入」，
 * 归因错误会让排查绕路（真机探针实测）。改为：仅当这些关键字出现在**命令位**
 * （`delete from …`）时才算 SQL 注入。
 */
const COMMAND_POSITION_SQL_PATTERNS = new Set(['delete ', 'update ']);

/**
 * 检测SQL注入攻击
 * @param input 输入字符串（JSON 文本，用于关键词扫描）
 * @param executionSurface 执行面原文（可选；提供时 `delete` / `update` 按命令位判定）
 * @returns 检测结果
 */
export function detectSqlInjection(
  input: string,
  executionSurface?: string
): ClassifierDecision | null {
  const sqlPatterns = [
    'union select',
    'drop table',
    'insert into',
    'update ',
    'delete ',
    'or 1=1',
    'and 1=1',
    "or 'x'='x",
    "and 'x'='x",
    'or 1=1--',
    'and 1=1--',
    ';drop table',
    ';delete from',
    ';insert into',
    ';update',
    'select 1',
    'select *',
    'from users',
    'from table',
    'where 1=1',
    'having 1=1',
    'order by',
    'group by',
    'limit 1',
    'offset 0',
    'union all',
    'union distinct',
    'cross join',
    'inner join',
    'left join',
    'right join',
    'full join',
    'natural join',
    'exec sp_',
    'execute sp_',
    'xp_cmdshell',
    'sp_configure',
    'declare @',
    'create table',
    'alter table',
    'truncate table',
    'drop database',
    'create database',
    'backup database',
    'restore database',
    'grant all',
    'revoke all',
    'deny all',
    'with encryption',
    'waitfor delay',
    'if exists',
    'while 1=1',
    'begin transaction',
    'commit transaction',
    'rollback transaction',
  ];

  for (const pattern of sqlPatterns) {
    const hit =
      executionSurface && COMMAND_POSITION_SQL_PATTERNS.has(pattern)
        ? containsCommandToken(executionSurface, pattern)
        : input.includes(pattern);
    if (hit) {
      return {
        shouldBlock: true,
        reason: `Input contains SQL injection pattern: "${pattern}"`,
      };
    }
  }

  return null;
}

/**
 * 检测XSS攻击
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectXssAttack(input: string): ClassifierDecision | null {
  const xssPatterns = [
    '<script>',
    '</script>',
    'javascript:',
    'onclick=',
    'onload=',
    'onmouseover=',
    'onmousemove=',
    'onkeydown=',
    'onkeyup=',
    'onfocus=',
    'onblur=',
    'onsubmit=',
    'onreset=',
    'alert(',
    'prompt(',
    'confirm(',
    'eval(',
    'document.cookie',
    'document.write',
    'window.location',
    'document.location',
    'document.createElement',
    'innerHTML',
    'outerHTML',
    'appendChild',
    'insertBefore',
    'replaceChild',
    'setTimeout(',
    'setInterval(',
    'new Function(',
    'String.fromCharCode',
    'unescape(',
    'escape(',
    'decodeURI(',
    'decodeURIComponent(',
  ];

  for (const pattern of xssPatterns) {
    if (input.includes(pattern)) {
      return {
        shouldBlock: true,
        reason: `Input contains XSS attack pattern: "${pattern}"`,
      };
    }
  }

  return null;
}

/**
 * `detectCommandInjection` 中**必须子串匹配**的模式（语言级函数调用可出现在任意位置）。
 */
const ALWAYS_SUBSTRING_PATTERNS = new Set([
  'system(',
  'exec(',
  'eval(',
  'call_user_func',
  'create_function',
]);

/**
 * 检测命令注入（shell 命令替换 / 子 shell / 解释器执行 / 远程执行）
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectCommandInjection(
  input: string
): ClassifierDecision | null {
  const injectionPatterns = [
    // 命令替换
    '$(',
    '`',
    '${',
    '${{',
    // 子shell
    'bash -c',
    'sh -c',
    'zsh -c',
    'ksh -c',
    // Python执行
    'python -c',
    'python3 -c',
    'python2 -c',
    // Perl执行
    'perl -e',
    'perl -E',
    // Ruby执行
    'ruby -e',
    'ruby -E',
    // Node执行
    'node -e',
    'node --eval',
    // PHP执行
    'php -r',
    'php -f',
    // Lua执行
    'lua -e',
    'lua -l',
    // Tcl执行
    'tclsh -c',
    'wish -c',
    // 远程执行
    'curl ',
    'wget ',
    'nc ',
    'netcat ',
    // 管道执行
    '| bash',
    '| sh',
    '| zsh',
    '| ksh',
    // Base64解码执行
    'base64 -d |',
    'echo | base64 -d',
    // 环境变量执行
    '${IFS}',
    '${RANDOM}',
    '${UID}',
    '${USER}',
    // eval执行
    'eval ',
    'eval(',
    'system(',
    'exec(',
    // 反射执行
    'call_user_func',
    'create_function',
  ];

  /**
   * 2026-11-10（用户裁定方案①）：命令词按**命令位**匹配，避免解释器名作为**参数**时误报
   * （`Get-Command node -ErrorAction` 曾命中 `node -e`）。以元字符开头的模式保持子串匹配；
   * 语言级函数调用（`system(` / `exec(` 等）可能出现在任意位置，仍按子串判定。
   */
  for (const pattern of injectionPatterns) {
    const hit = ALWAYS_SUBSTRING_PATTERNS.has(pattern)
      ? input.includes(pattern)
      : containsCommandToken(input, pattern);
    if (hit) {
      return {
        shouldBlock: true,
        reason: `Input contains command injection pattern: "${pattern}"`,
      };
    }
  }

  return null;
}

/**
 * 检测反序列化攻击
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectDeserializationAttack(
  input: string
): ClassifierDecision | null {
  const deserializationPatterns = [
    // PHP反序列化（使用更具体的模式避免误报）
    '"O":',
    '"C":',
    'O:[0-9]+:',
    'C:[0-9]+:',
    '"a":',
    '"s":',
    '"i":',
    '"d":',
    '"N";',
    '__wakeup',
    '__destruct',
    '__construct',
    '__call',
    '__callStatic',
    '__get',
    '__set',
    '__isset',
    '__unset',
    '__sleep',
    '__toString',
    '__invoke',
    '__set_state',
    // Java反序列化
    'java.io.ObjectInputStream',
    'readObject()',
    'org.apache.commons.collections',
    'InvokerTransformer',
    'Runtime.exec',
    'ProcessBuilder',
    // Python反序列化
    'pickle.load',
    'pickle.loads',
    'cPickle.load',
    'cPickle.loads',
    'marshal.load',
    'marshal.loads',
    // Node.js反序列化
    'JSON.parse',
    'Buffer.from',
    'eval(',
    // 通用反序列化特征
    'serialize(',
    'unserialize(',
    'deserialize(',
    'base64_decode(',
    'decodeBase64(',
    'fromBase64(',
  ];

  for (const pattern of deserializationPatterns) {
    if (input.includes(pattern)) {
      return {
        shouldBlock: true,
        reason: `Input contains deserialization attack pattern: "${pattern}"`,
      };
    }
  }

  return null;
}

/**
 * 检测LDAP注入攻击
 *
 * @param input 输入字符串（JSON 文本）
 * @param options.skipCharHeuristic 关闭「≥3 个特殊字符」启发式。
 *   **仅用于源码面**（`code` / `code_run`）：`()` `=` `*` 在代码里是语法，
 *   实测把无害 JS `const x = [1, 2].map((n) => n * 2)` 判成 LDAP 注入（P4 复查）。
 *   结构化过滤器模式（`(|` / `(&` / `(!` / `))` 等）**仍然生效**。
 * @returns 检测结果
 */
export function detectLDAPInjection(
  input: string,
  options: { skipCharHeuristic?: boolean } = {}
): ClassifierDecision | null {
  const ldapPatterns = [
    // LDAP 过滤器注入：只认**结构化组合**。
    // 2026-11-11：原先还列了单字符 `*` `(` `)` `&` `|` `=` `!` `~`，等于"出现任一特殊字符
    // 即判注入" —— 实测把 `git reset HEAD~1`、`git log --grep=(fix)` 判成 LDAP 注入
    // （审批档根本走不到）。单字符不具 LDAP 语义，统一移除；下方仍保留"≥3 个特殊字符"的
    // 组合启发式与结构化过滤器模式。
    '(|',
    '(&',
    '(!',
    '))',
    // 空值攻击
    '\x00',
    '%00',
    // 编码绕过
    '\\2a',
    '\\28',
    '\\29',
    '\\26',
    '\\7c',
  ];

  // 检查是否包含多个LDAP特殊字符
  let specialCharCount = 0;
  for (const char of ['*', '(', ')', '&', '|', '=']) {
    if (input.includes(char)) {
      specialCharCount++;
    }
  }

  if (!options.skipCharHeuristic && specialCharCount >= 3) {
    return {
      shouldBlock: true,
      reason:
        'Input contains multiple LDAP special characters indicating potential LDAP injection',
    };
  }

  // 检查特定模式
  for (const pattern of ldapPatterns) {
    if (input.includes(pattern)) {
      // 跳过单独的 * 和 =，这些在正常输入中很常见
      if (pattern === '*' || pattern === '=') {
        continue;
      }
      return {
        shouldBlock: true,
        reason: `Input contains potential LDAP injection pattern: "${pattern}"`,
      };
    }
  }

  return null;
}

/**
 * 检测XML外部实体攻击（XXE）
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectXXEAttack(input: string): ClassifierDecision | null {
  const xxePatterns = [
    // DOCTYPE声明
    '<!DOCTYPE',
    '<!DOCTYPE ',
    '<!DOCTYPE\t',
    // 外部实体声明
    '<!ENTITY',
    '<!ENTITY ',
    '<!ENTITY\t',
    // 外部引用
    'SYSTEM ',
    'SYSTEM\t',
    'PUBLIC ',
    'PUBLIC\t',
    // 协议处理程序
    'file://',
    'http://',
    'https://',
    'ftp://',
    'gopher://',
    'expect://',
    'php://',
    // 内部实体
    '&#',
    '&#x',
    '&amp;',
    '&lt;',
    '&gt;',
    // 实体引用
    '&',
    ']]>',
  ];

  // 检查DOCTYPE和ENTITY组合
  if (input.includes('<!DOCTYPE') && input.includes('<!ENTITY')) {
    return {
      shouldBlock: true,
      reason:
        'Input contains both DOCTYPE and ENTITY declarations indicating potential XXE attack',
    };
  }

  // 检查外部实体引用
  if (
    input.includes('<!ENTITY') &&
    (input.includes('SYSTEM') || input.includes('PUBLIC'))
  ) {
    return {
      shouldBlock: true,
      reason:
        'Input contains external entity declaration indicating potential XXE attack',
    };
  }

  // 检查危险协议
  for (const protocol of ['file://', 'gopher://', 'expect://']) {
    if (input.includes(protocol)) {
      return {
        shouldBlock: true,
        reason: `Input contains dangerous protocol: "${protocol}"`,
      };
    }
  }

  return null;
}
