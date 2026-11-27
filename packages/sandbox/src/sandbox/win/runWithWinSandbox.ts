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
import { spawn, type ChildProcess } from 'node:child_process';
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

/**
 * 解码 helper 子进程输出（2026-11-07 真机发现；2026-11-27 修「混合流整段翻转」）。
 *
 * helper 以 `windowsHide: true`（= `CREATE_NO_WINDOW`）拉起 ⇒ 子进程**没有控制台**，
 * `cmd.exe` 内置命令（`ver` / `dir` / `type` …）按系统 OEM 码页输出（中文 Windows 为
 * GBK/cp936），而 `Buffer.toString()` 按 UTF-8 解码 ⇒ 中文变「锟斤拷」。
 *
 * **混合流**（真机 `session_mwytcrw33b26a4d246`：`git log … | more`）：`more` 在处理管道时
 * 会把个别 UTF-8 尾字节改写成 `?`（`e4bba4e79a84` ⇒ `e4bba4e79a3f`，字节不可恢复）⇒
 * 整段里既有合法 UTF-8、又有零星非法字节。旧实现「严格 UTF-8 失败 ⇒ **整段**按 OEM 解码」
 * 会把同段里的合法中文一起翻成乱码（`登记` ⇒ `鐧昏`）。
 * 现按**行**判定：合法 UTF-8 的行保持 UTF-8，仅失败的行按 OEM 解码
 * （`0x0A` 在 UTF-8 与 GBK 里都不出现在多字节序列内部 ⇒ 按字节切行是安全的）。
 *
 * @param locale 区域标识（默认取运行时；参数化是为了让用例与 CI 机器语言无关）
 */
export function decodeWindowsConsoleOutput(
  buf: Buffer,
  locale: string = Intl.DateTimeFormat().resolvedOptions().locale
): string {
  if (buf.length === 0) return '';
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  try {
    return utf8.decode(buf);
  } catch {
    // @ignore-catch — 非 UTF-8 是 Windows 无控制台子进程的常态，逐行按 OEM 码页再试
    return decodeLineByLine(buf, locale);
  }
}

/** 无控制台子进程的 OEM 码页候选（按区域；运行时不支持该编码时返回 `null`） */
function oemDecoderFor(locale: string): TextDecoder | null {
  const encoding = locale.startsWith('zh')
    ? 'gbk'
    : locale.startsWith('ja')
      ? 'shift_jis'
      : locale.startsWith('ko')
        ? 'euc-kr'
        : 'windows-1252';
  try {
    return new TextDecoder(encoding);
  } catch {
    // @ignore-catch — 无 ICU 的运行时不支持该编码 ⇒ 交给调用方退回宽松 UTF-8
    return null;
  }
}

/** 逐行解码：每行独立判定 UTF-8 / OEM（坏行不污染其它行） */
function decodeLineByLine(buf: Buffer, locale: string): string {
  const oem = oemDecoderFor(locale);
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  let out = '';
  let start = 0;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] !== 0x0a) continue;
    out += decodeLine(buf.subarray(start, i + 1), utf8, oem);
    start = i + 1;
  }
  if (start < buf.length) out += decodeLine(buf.subarray(start), utf8, oem);
  return out;
}

function decodeLine(
  line: Buffer,
  utf8: TextDecoder,
  oem: TextDecoder | null
): string {
  try {
    return utf8.decode(line);
  } catch {
    // @ignore-catch — 该行不是合法 UTF-8 ⇒ 按 OEM 码页解码（无 OEM 解码器时保留宽松 UTF-8）
    return oem ? oem.decode(line) : line.toString('utf8');
  }
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
    let child: ChildProcess;
    try {
      child = spawn(helper, argv, {
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.env ? { env: input.env } : {}),
        // helper 自己已有超时（124）；这里多给 5s 作为"helper 卡死"的兜底
        timeout: input.timeoutMs + 5000,
        windowsHide: true,
      });
    } catch (err) {
      // 2026-11-21 真机发现：helper 被系统策略拦下时（如 Windows 应用控制策略
      // 「应用程序控制策略已阻止此文件」），Bun 的 `spawn` 会**同步抛出**
      // `EUNKNOWN: uv_spawn`，而不是像 Node 那样异步发 `error` 事件。
      // 未捕获会把整个 `code_run` 打成异常栈；helper 起不来就是 helper 失败 ⇒
      // 归一成 `helperFailed=true`，交由调用方按 `failClosed` 决策（CS03：不静默降级）。
      const error = err instanceof Error ? err : new Error(String(err));
      resolve({
        stdout: '',
        stderr: String(error),
        exitCode: null,
        timedOut: false,
        helperFailed: true,
        error,
      });
      return;
    }

    const signal = input.signal;
    const onAbort = (): void => killProcessTree(child);
    const cleanupAbort = (): void =>
      signal?.removeEventListener('abort', onAbort);
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    // 2026-11-07：攒整段 Buffer 再解码 —— 分块边界可能切断多字节字符（GBK / UTF-8）
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    // 上限按**字节**粗裁（UTF-8 最坏 4 字节/字符），字符上限在解码后用 appendWithinLimit 精确执行
    const maxBytes = input.maxBufferChars * 4;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const collected = (chunks: Buffer[]): string =>
      appendWithinLimit(
        '',
        decodeWindowsConsoleOutput(Buffer.concat(chunks)),
        input.maxBufferChars
      ).text;

    child.stdout?.on('data', (d: Buffer) => {
      if (stdoutBytes >= maxBytes) return;
      stdoutChunks.push(d);
      stdoutBytes += d.length;
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderrBytes >= maxBytes) return;
      stderrChunks.push(d);
      stderrBytes += d.length;
    });
    child.on(CHILD_PROCESS_ERROR_EVENT, (err: NodeJS.ErrnoException) => {
      cleanupAbort();
      resolve({
        stdout: collected(stdoutChunks),
        stderr: (() => {
          const text = collected(stderrChunks);
          return text ? `${text}\n${String(err)}` : String(err);
        })(),
        exitCode: null,
        timedOut: false,
        // spawn 失败 ⇒ helper 没起来，属 helper 失败（不是用户命令失败）
        helperFailed: true,
        error: err,
        ...(child.pid !== undefined ? { pid: child.pid } : {}),
      });
    });
    child.on('close', (code) => {
      cleanupAbort();
      const semantics = classifyWinSandboxExit(code);
      resolve({
        stdout: collected(stdoutChunks),
        stderr: collected(stderrChunks),
        exitCode: code,
        timedOut: semantics.timedOut,
        helperFailed: semantics.helperFailed,
        ...(child.pid !== undefined ? { pid: child.pid } : {}),
      });
    });
  });
}
