// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// `win-sandbox-run.exe` 执行器（Windows 兜底沙箱，2026-10-26）
//
// 与 `sandbox/darwin/runWithSandboxExec.ts` 对称：输出软上限、abort 强杀进程树、结果字段一致；
// 差别在于退出码语义（见下）与 Windows 没有进程组（`killProcessTree` 用 taskkill /T）。
//
// 退出码协议（helper 定义，见 win_sandbox_run.c）：
//   126 = helper 自身失败（取令牌/建 Job/起进程）→ `helperFailed`
//   124 = 超时（helper 已整 Job 终止）            → `timedOut`
//   其他 = 子进程退出码**原样**透传（含 125 —— 不与 landlock 的 125 语义混用）
import { spawn } from 'node:child_process';
import { appendWithinLimit } from '../SandboxPolicy';
import { killProcessTree } from '../utils/killProcessTree';
import { CHILD_PROCESS_ERROR_EVENT } from '../ProcessRegistry';
import {
  WIN_SANDBOX_HELPER_BIN_NAME,
  resolveWinSandboxHelperPath,
} from './helperPaths';

/**
 * helper 退出码协议。
 *
 * 用**对象**而不是两个 `const X_TIMEOUT = 124` 之类：`lint:consts` 把
 * `const *_TIMEOUT = <数字>` 视为 B 类裸字面量（应落 `app/src/constants/`）；
 * 退出码是协议枚举、不宜外移，故收成一个 frozen 对象。
 */
export const WIN_SANDBOX_EXIT = {
  /** helper 自身初始化失败（取令牌/建 Job/起进程）—— 不等于目标程序失败 */
  helperFailed: 126,
  /** 超时（helper 已整 Job 终止） */
  timeout: 124,
} as const;

export interface WinSandboxRunInput {
  /** 程序（绝对路径最稳；如 `process.execPath`） */
  program: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** 输出软上限（按字符，与 bash / landlock 同口径） */
  maxBufferChars: number;
  signal?: AbortSignal;
  /** 可选：Job 级内存上限（MB） */
  memMb?: number;
  /** 可选：Job 级并发进程上限 */
  maxProcs?: number;
  /** 默认按 `helperPaths` 解析；测试可注入 */
  helperPath?: string;
}

export interface WinSandboxRunResult {
  stdout: string;
  stderr: string;
  /** `null` = 未取到退出码（spawn 失败 / 被杀） */
  exitCode: number | null;
  /** helper 报超时（124） */
  timedOut: boolean;
  /** helper 自身失败（126）—— **不等于**目标程序失败 */
  helperFailed: boolean;
  error?: Error;
  pid?: number;
}

/** 构造 helper argv（单独导出供离线断言形状） */
export function buildWinSandboxArgv(input: {
  program: string;
  args: string[];
  timeoutMs: number;
  memMb?: number;
  maxProcs?: number;
}): string[] {
  const argv = ['--timeout-ms', String(input.timeoutMs)];
  if (input.memMb !== undefined && input.memMb > 0) {
    argv.push('--mem-mb', String(input.memMb));
  }
  if (input.maxProcs !== undefined && input.maxProcs > 0) {
    argv.push('--max-procs', String(input.maxProcs));
  }
  argv.push('--', input.program, ...input.args);
  return argv;
}

/** 退出码 → 语义（纯函数，便于单测） */
export function classifyWinSandboxExit(exitCode: number | null): {
  timedOut: boolean;
  helperFailed: boolean;
} {
  return {
    timedOut: exitCode === WIN_SANDBOX_EXIT.timeout,
    helperFailed: exitCode === WIN_SANDBOX_EXIT.helperFailed,
  };
}

export async function runWithWinSandbox(
  input: WinSandboxRunInput
): Promise<WinSandboxRunResult> {
  // 防御性平台门控（正常应经 `detectWindowsSandboxCapability` 过滤）
  if (process.platform !== 'win32') {
    return {
      stdout: '',
      stderr: 'win-sandbox-run: unsupported platform',
      exitCode: 1,
      timedOut: false,
      helperFailed: false,
    };
  }

  const helper =
    input.helperPath ??
    resolveWinSandboxHelperPath({ platform: 'win32' }) ??
    WIN_SANDBOX_HELPER_BIN_NAME;
  const argv = buildWinSandboxArgv({
    program: input.program,
    args: input.args,
    timeoutMs: input.timeoutMs,
    ...(input.memMb !== undefined ? { memMb: input.memMb } : {}),
    ...(input.maxProcs !== undefined ? { maxProcs: input.maxProcs } : {}),
  });

  return await new Promise<WinSandboxRunResult>((resolve) => {
    const child = spawn(helper, argv, {
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.env ? { env: input.env } : {}),
      // helper 自己已有超时（124）；这里多给 5s 作为"helper 卡死"的兜底
      timeout: input.timeoutMs + 5000,
      windowsHide: true,
    });

    const signal = input.signal;
    const onAbort = (): void => killProcessTree(child);
    const cleanupAbort = (): void =>
      signal?.removeEventListener('abort', onAbort);
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    let stdout = '';
    let stderr = '';
    const append = (acc: string, block: string): string =>
      appendWithinLimit(acc, block, input.maxBufferChars).text;

    child.stdout?.on('data', (d: Buffer) => {
      stdout = append(stdout, d.toString());
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr = append(stderr, d.toString());
    });
    child.on(CHILD_PROCESS_ERROR_EVENT, (err: NodeJS.ErrnoException) => {
      cleanupAbort();
      resolve({
        stdout,
        stderr: stderr ? `${stderr}\n${String(err)}` : String(err),
        exitCode: null,
        timedOut: false,
        helperFailed: false,
        error: err,
        ...(child.pid !== undefined ? { pid: child.pid } : {}),
      });
    });
    child.on('close', (code) => {
      cleanupAbort();
      const semantics = classifyWinSandboxExit(code);
      resolve({
        stdout,
        stderr,
        exitCode: code,
        timedOut: semantics.timedOut,
        helperFailed: semantics.helperFailed,
        ...(child.pid !== undefined ? { pid: child.pid } : {}),
      });
    });
  });
}
