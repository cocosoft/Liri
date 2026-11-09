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
 * READONLY_COMMAND_ALLOWLIST — auto 模式的「只读命令」短路白名单（2026-11-09）
 *
 * 背景（B4 实测）：`AUTO_MODE_DANGER_TOKENS` 实际是一份**全命令词表 + 子串匹配**
 * （`ls ` / `cat ` / `git ` / `dir ` 都在其中）⇒ auto 档把正常只读命令判 `deny`；
 * `DANGEROUS_TOOL_KEYWORDS` 还把 `grep` 等只读工具名当危险词。demand（许愿式）
 * 会话缺省 auto ⇒ 只读命令与搜索工具不可用（设计稿 D3 要求自动放行）。
 *
 * 本模块只做一件事：判断一条命令是否属于**结构上不可能写入**的只读命令。
 * 放行口径（**只放行，不放宽危险面**）：
 *  - 必须是单一简单命令：无管道 / 重定向 / 命令分隔 / 后台 / 命令替换 / 变量展开；
 *  - 命令名必须在白名单内，且**不带任何路径前缀**（`/tmp/ls` 不放行 —— 防同名伪造）；
 *  - 个别命令再做参数约束：`find` 禁 `-exec/-ok/-delete` 等、`git` 仅只读子命令、
 *    `date` 禁设置时间、`sort` 禁写文件、`file` 禁编译 magic。
 *
 * **不放行 ≠ 判 deny**：返回 `allowed:false` 时调用方继续走既有分类器，
 * 保持修复前的行为不变（未知命令仍按原策略处理）。
 */

import {
  AUTO_MODE_GIT_READONLY_SUBCOMMANDS,
  AUTO_MODE_READONLY_COMMANDS,
} from '@openliri/infra/security';
import { detectPipeAndRedirect } from './vector-rules.js';

/** 检查结果：`allowed:false` 只表示"短路不适用"，不表示拒绝 */
export interface ReadonlyCommandCheck {
  allowed: boolean;
  reason: string;
}

/** `find` 中会执行子进程或写文件的表达式 */
const FIND_DENIED_TOKENS = [
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-delete',
  '-fprint',
  '-fprint0',
  '-fprintf',
  '-fls',
];

/**
 * 命令组合 / 展开字符：命中即不放行。
 *
 * `$` 一并拒绝：变量展开（`$HOME/.ssh/...`）会让"字面只读"变成"任意路径只读"，
 * 破坏白名单的可审计性；这类命令继续走分类器。
 */
const SHELL_COMPOSITION = /[;&|<>`$\n\r]/;

/** 只读命令的参数级约束（返回 true 表示命中禁区） */
function violatesArgumentGuards(
  name: string,
  args: readonly string[]
): boolean {
  const lowerArgs = args.map((a) => a.toLowerCase());

  if (name === 'find') {
    return lowerArgs.some((arg) =>
      FIND_DENIED_TOKENS.some((token) => arg.startsWith(token))
    );
  }

  if (name === 'git') {
    // 无子命令（只打印帮助）也不放行；子命令必须在只读集合内
    return !AUTO_MODE_GIT_READONLY_SUBCOMMANDS.has(lowerArgs[0] ?? '');
  }

  if (name === 'date') {
    // `date 01/01/2020`（Windows）/ `date -s ...`（GNU）会改系统时间；
    // GNU 的只读格式串写作 `+%Y-%m-%d`，故 `+` 开头放行。
    return lowerArgs.some(
      (arg) =>
        (!arg.startsWith('-') && !arg.startsWith('+')) ||
        arg === '-s' ||
        arg.startsWith('--set')
    );
  }

  if (name === 'sort') {
    // `sort -o out.txt` / `sort --output=out.txt` 会写文件
    return lowerArgs.some(
      (arg) =>
        arg === '-o' ||
        /^-o./.test(arg) ||
        arg === '--output' ||
        arg.startsWith('--output=')
    );
  }

  if (name === 'file') {
    // `file -C` 会生成 magic 编译缓存文件
    return lowerArgs.some(
      (arg) => arg === '-c' || arg === '--compile' || arg === '--compile-only'
    );
  }

  return false;
}

/**
 * 判断命令是否可被 auto 模式直接放行（单一、只读、无组合）。
 *
 * @param command 命令原文（`isCommandToolName()` 为真时工具入参的 `command` 字段）
 */
export function checkReadonlyCommand(
  command: string
): ReadonlyCommandCheck {
  const text = command.trim();
  if (!text) return { allowed: false, reason: 'Empty command' };

  if (SHELL_COMPOSITION.test(text)) {
    return { allowed: false, reason: 'Command contains shell operators' };
  }
  const pipeOrRedirect = detectPipeAndRedirect(text);
  if (pipeOrRedirect) {
    return {
      allowed: false,
      reason: pipeOrRedirect.reason ?? 'Command contains shell operators',
    };
  }

  const tokens = text.split(/\s+/);
  const name = (tokens[0] ?? '').toLowerCase();
  if (!name || name.includes('/') || name.includes('\\')) {
    // 带路径前缀的同名可执行文件（`/tmp/ls`、`.\ls`）不放行
    return { allowed: false, reason: 'Command name carries a path prefix' };
  }
  if (!AUTO_MODE_READONLY_COMMANDS.has(name)) {
    return { allowed: false, reason: `Not a read-only command: ${name}` };
  }

  const args = tokens.slice(1);
  if (violatesArgumentGuards(name, args)) {
    return {
      allowed: false,
      reason: `Arguments can write or execute: ${name}`,
    };
  }

  return { allowed: true, reason: `Read-only command on allowlist: ${name}` };
}
