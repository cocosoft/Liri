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
 * 背景（B4 实测）：`AUTO_MODE_HARD_DENY_TOKENS` 实际是一份**全命令词表 + 子串匹配**
 * （`ls ` / `cat ` / `git ` / `dir ` 都在其中）⇒ auto 档把正常只读命令判 `deny`；
 * `DANGEROUS_TOOL_KEYWORDS` 还把 `grep` 等只读工具名当危险词。demand（许愿式）
 * 会话缺省 auto ⇒ 只读命令与搜索工具不可用（设计稿 D3 要求自动放行）。
 *
 * 本模块只做一件事：判断一条命令是否属于**结构上不可能写入**的只读命令。
 * 放行口径（**只放行，不放宽危险面**）：
 *  - 必须是单一简单命令：无管道 / 重定向 / 命令分隔 / 后台 / 命令替换 / 变量展开；
 *  - 命令名必须在白名单内，且**不带任何路径前缀**（`/tmp/ls` 不放行 —— 防同名伪造）；
 *  - 个别命令再做参数约束：`find` 禁 `-exec/-ok/-delete` 等、`git` 仅只读子命令、
 *    `date` 禁设置时间、`sort` 禁写文件、`file` 禁编译 magic —— 只读族的参数禁区
 *    **唯一事实源**是 `readOnlyCommands.findReadonlyArgViolation`（与主链共用），
 *    本档只额外保留 git / kubectl / docker / gh 的子命令守卫。
 *
 * **不放行 ≠ 判 deny**：返回 `allowed:false` 时调用方继续走既有分类器，
 * 保持修复前的行为不变（未知命令仍按原策略处理）。
 */

import {
  AUTO_MODE_READONLY_COMMANDS,
  VERSION_ONLY_QUERY_PATTERN,
  GIT_READ_ONLY_FORBIDDEN_ARGS,
  readonlySubcommandsFor,
  // P0（2026-11-22）：只读命令的「参数级禁区」——与主链共用的唯一判据
  findReadonlyArgViolation,
} from '@openliri/infra/security';
import { detectPipeAndRedirect } from './vector-rules.js';

/** 检查结果：`allowed:false` 只表示"短路不适用"，不表示拒绝 */
export interface ReadonlyCommandCheck {
  allowed: boolean;
  reason: string;
}

/**
 * 只读子命令集合（2026-11-12，P1c）：**唯一来源在 `commandSpecs.ts` 引用的
 * `readOnlyCommands.ts` 常量**，本文件只取用，不再各留一份字面集合。
 *
 * 背景：切换到"未知命令非只读即审批"后，`kubectl get` / `docker ps` / `gh pr view`
 * 这类纯查询会被误伤；未列出的子命令一律不放行（落审批档）。`git` 同理。
 */
const GIT_READONLY = readonlySubcommandsFor('git');
const KUBERNETES_READONLY = readonlySubcommandsFor('kubectl');
const DOCKER_READONLY = readonlySubcommandsFor('docker');
const GH_READONLY = readonlySubcommandsFor('gh');

/** `gh api` 的写侧标记（出现即不放行） */
const GH_API_WRITE_FLAGS = new Set([
  '-x',
  '--method',
  '-f',
  '--field',
  '--raw-field',
  '--input',
]);

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

  if (name === 'git') {
    // P3-2（2026-11-16）：参数禁区优先 —— `--output=` / `--ext-diff` / 全局 `-c`（pager 注入）
    // 等写盘或执行形态，即使子命令在只读集合内也不得短路放行。
    if (GIT_READ_ONLY_FORBIDDEN_ARGS.test([name, ...args].join(' '))) {
      return true;
    }
    const subcommand = lowerArgs[0] ?? '';
    if (GIT_READONLY.has(subcommand)) return false;
    // `git remote` / `git remote -v|--verbose` 只列举远端，结构上不写；
    // 其余 remote 子动作（add / remove / set-url / prune …）仍不放行。
    if (subcommand === 'remote') {
      const rest = lowerArgs.slice(1);
      return !(
        rest.length === 0 ||
        rest.every((arg) => arg === '-v' || arg === '--verbose')
      );
    }
    // 无子命令（只打印帮助）也不放行；其余子命令必须在只读集合内
    return true;
  }

  // 2026-11-12（P0/P1c）：集群 / 容器 / 代码托管 —— 只放行只读子命令
  if (name === 'kubectl') {
    return !KUBERNETES_READONLY.has(lowerArgs[0] ?? '');
  }

  if (name === 'docker') {
    return !DOCKER_READONLY.has(lowerArgs[0] ?? '');
  }

  if (name === 'gh') {
    const first = lowerArgs[0] ?? '';
    if (first === 'api') {
      // `gh api` 默认 GET；出现写侧标记（`-X` / `-f` / `--input` …）即不放行
      return lowerArgs.some(
        (arg) =>
          GH_API_WRITE_FLAGS.has(arg) ||
          [...GH_API_WRITE_FLAGS].some((flag) => arg.startsWith(`${flag}=`))
      );
    }
    const pair = `${first} ${lowerArgs[1] ?? ''}`.trim();
    return !GH_READONLY.has(pair);
  }

  // P0（2026-11-22）：`find` / `sort` / `date` / `file` 等只读族的参数禁区已收敛到
  // `findReadonlyArgViolation`（`@openliri/infra/security`），在 `checkReadonlyCommand`
  // 入口统一判定 —— 本函数只保留**本档特有**的 git / 集群 / 容器 / 托管 CLI 与
  // PowerShell 计算属性守卫，避免两份字面清单漂移。

  if (name === 'measure-object') {
    // P9-1（2026-11-12）：`-Expression { … }` 会执行脚本块，不算只读。
    return lowerArgs.some(
      (arg) => arg === '-expression' || arg.startsWith('-expression:')
    );
  }

  if (name === 'select-object') {
    // P11：计算属性 `-Property @{N='x';E={…}}` 会执行脚本块。
    return lowerArgs.some(
      (arg) => arg.includes('@{') || arg.includes('expression=')
    );
  }

  return false;
}

/**
 * 解释器「无写入自检」形态（2026-11-10，用户裁定）。
 *
 * demand（许愿式）任务会用 `node --check x.js` 自检语法，但 `node` **不在**
 * `AUTO_MODE_READONLY_COMMANDS`（该集合刻意不含解释器）⇒ 落分类器按解释器令牌 deny，
 * deny 累积再升级为 ask（真机 `session_mwah5033f019cafde4` 唯一 1 次 ask 即此来源）。
 *
 * 只放行**不执行代码、不写文件**的形态：
 *  - 版本查询：`VERSION_ONLY_QUERY_PATTERN` 覆盖的全部命令（含 `npm --version` /
 *    `java -version` / `go version`）；
 *  - `node --check <file>`（仅语法检查，不运行脚本）。
 * `-e` / `--eval` / `-p` / `-r` / `-i` / `-m`、直接跑脚本、`-`（stdin）一律不放行。
 */
function isInterpreterSelfCheck(
  name: string,
  args: readonly string[]
): boolean {
  const lower = args.map((arg) => arg.toLowerCase());
  // 版本查询：**单一来源** `VERSION_ONLY_QUERY_PATTERN`（P6-3 收敛，含 `java -version`
  // 与 `go version`）；此前只硬编码 node/python 两种，`npm --version` 等仍转审批。
  if (VERSION_ONLY_QUERY_PATTERN.test(`${name} ${lower.join(' ')}`.trim())) {
    return true;
  }
  if (name === 'node') {
    return (
      lower.length === 2 &&
      lower[0] === '--check' &&
      !lower[1].startsWith('-')
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
  // P9-2（2026-11-12）：丢弃型重定向（`2>nul` / `>nul` / `>/dev/null`）不改任何文件，
  // 先剥离再判；否则 `dir /b x 2>nul & dir /b y` 会因 `>` 被判成"会写盘"。
  const text = command
    .replace(/\s*2?>\s*(?:nul|\/dev\/null)\b/gi, '')
    .trim();
  if (!text) return { allowed: false, reason: 'Empty command' };

  // P11（2026-11-12 真机验证）：PowerShell 属性投影段（`(...).version` / `.Prop.Sub`）
  // 只是取属性，不执行任何命令；此前被当成"未知命令"转审批。
  if (/^\.[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(text)) {
    return { allowed: true, reason: 'Property projection (no execution)' };
  }

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

  const args = tokens.slice(1);
  // 解释器自检（版本 / 语法检查）先于白名单判定：只放行无写入形态
  if (isInterpreterSelfCheck(name, args)) {
    return {
      allowed: true,
      reason: `Interpreter self-check (no execution): ${name}`,
    };
  }
  if (!AUTO_MODE_READONLY_COMMANDS.has(name)) {
    return { allowed: false, reason: `Not a read-only command: ${name}` };
  }

  // P0（2026-11-22）：只读族的「写 / 执行型开关」—— 与主链共用 `findReadonlyArgViolation`
  // （`find -exec/-delete`、`rg --pre`、`sort -o/--compress-program`、`uniq in out`、
  // `tree -o`、`date -s`、`file -C`）。此前本档自留一份且漏了 uniq / tree / compress。
  const argViolation = findReadonlyArgViolation(text);
  if (argViolation) {
    return { allowed: false, reason: argViolation.message };
  }

  if (violatesArgumentGuards(name, args)) {
    return {
      allowed: false,
      reason: `Arguments can write or execute: ${name}`,
    };
  }

  return { allowed: true, reason: `Read-only command on allowlist: ${name}` };
}
