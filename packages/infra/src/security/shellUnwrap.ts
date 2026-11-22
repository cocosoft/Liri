// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * shellUnwrap —— 命令剥壳（P3-2/T2b，2026-11-16）
 *
 * **动机**（计划 §2.2 实测）：`git log … | powershell -Command "…"` 被硬拒、
 * `bash -lc "git log"` / `cmd /c "dir /b"` 落「未知命令 ⇒ 转人工」——
 * 分类器看的是**外层壳**（`bash` / `cmd` / `env`），而不是真正要执行的命令。
 *
 * **口径（只剥壳，不解释命令）**：
 *   支持 `bash|sh|zsh|dash|ksh|fish -c/-lc "…"`、`cmd /c …`、
 *   `env <已登记赋值>… <命令>`；其余形态一律 `ok:false`（调用方保持原判，fail-closed）。
 *   **不**处理 `powershell|pwsh`：其内层脚本必须由 PowerShell 安全链判定
 *   （`evaluatePowerShellSecurity`，位于 app 层），infra 不得反向依赖。
 *
 * **安全边界**：
 *   - 引号未闭合 / 含换行 / 壳路径形态（`/bin/bash`）⇒ 不剥壳；
 *   - `env` 只接受**已登记的无害赋值名**（TERM / NO_COLOR / PAGER …）；
 *     `PATH` / `LD_PRELOAD` / `NODE_OPTIONS` 等会影响代码加载的变量一律不剥壳；
 *   - 剥壳结果**不放大**权限：内层命令仍走完整的原判定链（只读 / 危险命令 / 审批）。
 */

/**
 * 多级剥壳结果（P1，2026-11-22）。
 *
 * 用途：让「基命令白名单 / 解释器守卫 / 沙箱二次校验」看到**实际要执行的命令**，
 * 而不是外层壳（`bash -lc "git log"` 的 base 应为 `git`）。
 */
export interface ShellChainResult {
  /** 最终（最内层）命令；未剥壳 / 剥壳失败时等于**最后一层可解析命令** */
  command: string;
  /** 逐层命中的壳（从外到内，如 `['cmd /c', 'bash']`）；空数组表示无壳 */
  wrappers: string[];
}

/** 与 `BashSecurityAnalyzer.MAX_SHELL_UNWRAP_DEPTH` 同口径：最多剥 3 层 */
const MAX_CHAIN_DEPTH = 3;

/**
 * 逐层剥壳（`env → cmd /c → bash -lc → …`），返回最内层命令与实际命中的壳。
 *
 * 边界：任一层不满足 `unwrapShellCommand` 的可证形态（多余位置参数 / `/k` / `env -i` /
 * 引号未闭合 …）⇒ **停止并返回当前层**。调用方因此看到的是"壳名"本身 ⇒ 白名单拒绝
 * （shell 不在允许列表）⇒ fail-closed，不给"剥壳失败 ⇒ 未知 ⇒ 可批准"的口子。
 */
export function unwrapShellChain(
  command: string,
  maxDepth: number = MAX_CHAIN_DEPTH
): ShellChainResult {
  let current = command.trim();
  const wrappers: string[] = [];
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const one = unwrapShellCommand(current);
    if (!one.ok) break;
    const inner = one.command.trim();
    // 防止空串 / 自指（如 `env` 只带赋值）导致死循环
    if (!inner || inner === current) break;
    wrappers.push(one.wrapper ?? 'shell');
    current = inner;
  }
  return { command: current, wrappers };
}

/** 一次剥壳的结果 */
export interface UnwrapResult {
  ok: boolean;
  /** 内层命令（`ok=true` 时非空） */
  command: string;
  /** 命中的壳（`ok=true` 时给出，用于日志与 `matchedPatterns`） */
  wrapper?: string;
  /** `ok=false` 的原因（仅诊断，不参与判定） */
  reason?: string;
}

interface Token {
  value: string;
  start: number;
  end: number;
}

/** 支持 `-c` 的 POSIX 系 shell（含常见变体） */
const POSIX_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);

/**
 * `env` 允许携带的赋值名（白名单）。
 *
 * 仅收录**不改变代码加载 / 动态链接**的展示类变量；`PATH` / `LD_PRELOAD` /
 * `NODE_OPTIONS` / `PYTHONPATH` 等一律不在内 ⇒ 一律不剥壳。
 */
const BENIGN_ENV_ASSIGNMENTS = new Set([
  'NO_COLOR',
  'FORCE_COLOR',
  'TERM',
  'PAGER',
  'GIT_PAGER',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'COLUMNS',
  'CI',
]);

/** 引号感知的最小分词；返回 span 以便把内层命令**原样**切出来 */
function tokenize(command: string): { tokens: Token[] } | { failure: string } {
  const tokens: Token[] = [];
  let i = 0;
  while (i < command.length) {
    while (i < command.length && /\s/.test(command[i])) i += 1;
    if (i >= command.length) break;

    const start = i;
    let value = '';

    if (command[i] === "'") {
      i += 1;
      while (i < command.length && command[i] !== "'") {
        value += command[i];
        i += 1;
      }
      if (i >= command.length) return { failure: '未闭合的单引号' };
      i += 1;
    } else if (command[i] === '"') {
      i += 1;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === '\\' && i + 1 < command.length) {
          value += command[i + 1];
          i += 2;
          continue;
        }
        value += command[i];
        i += 1;
      }
      if (i >= command.length) return { failure: '未闭合的双引号' };
      i += 1;
    } else {
      while (i < command.length && !/\s/.test(command[i])) {
        if (command[i] === '\\' && i + 1 < command.length) {
          value += command[i + 1];
          i += 2;
          continue;
        }
        value += command[i];
        i += 1;
      }
    }

    tokens.push({ value, start, end: i });
  }
  return { tokens };
}

/** 是否为带 `-c` 的 shell 开关（`-c` / `-lc` / `-euc` …） */
function isScriptFlag(token: string): boolean {
  return /^-[A-Za-z]*c[A-Za-z]*$/.test(token);
}

/** 失败结果（正文统一在调用方决定是否展示） */
function fail(reason: string): UnwrapResult {
  return { ok: false, command: '', reason };
}

/**
 * 从 `startIndex` 起取内层命令。
 *
 * - 只剩**一个** token ⇒ 用其去引号后的值（`cmd /c "dir /b"` ⇒ `dir /b`）；
 * - 多个 token ⇒ 从首个 token 起点原样切片，保留参数里的引号与空格。
 */
function tailCommand(
  command: string,
  tokens: Token[],
  startIndex: number
): string {
  const rest = tokens.slice(startIndex);
  if (rest.length === 0) return '';
  return (rest.length === 1
    ? rest[0].value
    : command.slice(rest[0].start)
  ).trim();
}

/**
 * 剥一层壳。支持嵌套（如 `env NO_COLOR=1 bash -lc "…"`）：调用方递归即可。
 *
 * @param command 原始命令（调用方已 trim）
 */
export function unwrapShellCommand(command: string): UnwrapResult {
  if (!command) return fail('空命令');
  // 多行命令不做剥壳：内层可能还有第二条语句，交给原判定链
  if (/[\r\n]/.test(command)) return fail('含换行，不剥壳');

  const parsed = tokenize(command);
  if ('failure' in parsed) return fail(parsed.failure);
  const { tokens } = parsed;
  if (tokens.length === 0) return fail('空命令');

  const rawBase = tokens[0].value;
  // 路径形态（`/bin/bash`、`C:\Windows\...`）不剥壳：避免把"非裸命令名"放过
  if (/[/\\]/.test(rawBase)) return fail('壳以路径形式给出，不剥壳');
  const base = rawBase.toLowerCase();

  if (POSIX_SHELLS.has(base)) {
    const flagIndex = tokens.findIndex(
      (t, idx) => idx > 0 && isScriptFlag(t.value)
    );
    if (flagIndex < 0) return fail('未找到 -c 开关');
    // 只接受"开关后仅一个脚本参数"的形态（多参数是位置参数，语义不同）
    if (flagIndex !== tokens.length - 2) {
      return fail('壳参数形态不支持（需 -c 且仅一个脚本参数）');
    }
    const script = tokens[flagIndex + 1].value.trim();
    if (!script) return fail('内层脚本为空');
    return { ok: true, command: script, wrapper: base };
  }

  if (base === 'cmd') {
    const idx = tokens.findIndex(
      (t, i) => i > 0 && t.value.toLowerCase() === '/c'
    );
    if (idx < 0) return fail('未找到 /c 开关');
    if (idx === tokens.length - 1) return fail('/c 后无命令');
    // 从 `/c` 之后第一个 token 起取内层命令（单个 token 去引号，多个原样切片）
    const inner = tailCommand(command, tokens, idx + 1);
    if (!inner) return fail('/c 后无命令');
    return { ok: true, command: inner, wrapper: 'cmd /c' };
  }

  if (base === 'env') {
    let idx = 1;
    while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx].value)) {
      const name = tokens[idx].value.split('=')[0];
      if (!BENIGN_ENV_ASSIGNMENTS.has(name)) {
        return fail(`env 赋值未登记（${name}）`);
      }
      idx += 1;
    }
    if (idx >= tokens.length) return fail('env 后无命令');
    // P3-2（2026-11-16，用户裁定）：`env -i …` / `env -u VAR …` 这类**开关形态**不剥壳。
    // 旧实现把 `-i` 当成内层命令（`inner = '-i bash -lc "…"'`）⇒ 剥壳"成功"却解析出垃圾，
    // 内层危险命令随后落 ask（一次点击即可放行）。开关会改变环境语义 ⇒ 一律 fail-closed。
    if (tokens[idx].value.startsWith('-')) return fail('env 带开关，不剥壳');
    const inner = tailCommand(command, tokens, idx);
    if (!inner) return fail('env 后无命令');
    return { ok: true, command: inner, wrapper: 'env' };
  }

  if (base === 'powershell' || base === 'pwsh') {
    // 内层脚本必须由 PowerShell 安全链判定（app 层），infra 不剥这一层
    return fail('powershell 包裹由 PowerShell 安全链判定');
  }

  return fail('非壳包裹');
}
