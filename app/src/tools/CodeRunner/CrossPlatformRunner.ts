/**
 * CodeRunner 跨平台受限子进程执行器（CM-3b）
 *
 * 流程：
 *   1. 临时目录（resolveTempDir()/code-mode/<sessionId>/，路径复用 @modules/core/paths）
 *   2. 写用户脚本 + wrapper（generateWrapperScript）
 *   3. spawn `bun run wrapper.ts user.ts`（bun 可执行文件 = process.execPath）
 *   4. runRpcChildProcess：stdout 逐行解析 JSON 帧 → 分发 CodeRunnerBridge.handleRequest
 *      → 响应写回 stdin；done/error 帧结束；stderr 收集（体积上限）；超时两阶段 kill
 *
 * 输出体积：单帧 256KB 上限；stderr 256KB 上限（防背压阻塞，方案 P2-10）。
 *
 * Linux 环境由 LinuxSandboxRunner 复用 prepareRunDir + runRpcChildProcess，
 * 仅进程隔离手段不同（landlock-run 包装）。
 */

import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import { join, isAbsolute } from 'path';
import { resolveTempDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

import { generateWrapperScript } from './wrapper';
import { CodeRunnerBridge } from './RuntimeBridge';
import type { CodeRunResult } from './types';

const logger = getLogger('tools:CodeRunner:runner');

/** 默认超时（ms） */
const DEFAULT_TIMEOUT_MS = 60_000;
/** 单帧输出体积上限（字节） */
const FRAME_LIMIT_BYTES = 256 * 1024;
/** stderr 收集上限（字节） */
const STDERR_LIMIT_BYTES = 256 * 1024;
/** 两阶段终止优雅等待（ms） */
const KILL_GRACE_MS = 2000;

export interface CodeRunnerExecOptions {
  sessionId: string;
  code: string;
  bridge: CodeRunnerBridge;
  /** 超时（默认 60s） */
  timeoutMs?: number;
  /** 临时目录根（默认 resolveTempDir()/code-mode） */
  tempRoot?: string;
}

/** 运行目录准备结果 */
export interface CodeRunnerRunDir {
  runDir: string;
  wrapperPath: string;
  userScriptPath: string;
}

/** RPC 子进程执行选项 */
export interface RpcChildOptions {
  bridge: CodeRunnerBridge;
  timeoutMs?: number;
}

/**
 * 准备运行目录：写用户脚本 + wrapper（两执行器共用）
 */
export async function prepareRunDir(
  opts: Pick<CodeRunnerExecOptions, 'sessionId' | 'code' | 'tempRoot'>
): Promise<CodeRunnerRunDir> {
  const tempRoot = opts.tempRoot ?? join(resolveTempDir(), 'code-mode');
  const runDir = join(tempRoot, opts.sessionId);
  await fs.mkdir(runDir, { recursive: true });
  const userScriptPath = join(runDir, 'user.ts');
  const wrapperPath = join(runDir, 'wrapper.ts');
  await fs.writeFile(userScriptPath, opts.code, 'utf8');
  await fs.writeFile(wrapperPath, generateWrapperScript(), 'utf8');
  return { runDir, wrapperPath, userScriptPath };
}

/**
 * RPC 子进程执行核心（两执行器共用）：
 * stdout 帧解析 → bridge 分发 → stdin 响应；done/error 结束；超时两阶段 kill。
 */
export async function runRpcChildProcess(
  child: ChildProcess,
  opts: RpcChildOptions
): Promise<CodeRunResult> {
  const startedAt = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return await new Promise<CodeRunResult>((resolvePromise) => {
    const logs: string[] = [];
    const toolCalls: CodeRunResult['toolCalls'] = [];
    let stderrBytes = 0;
    let stderrTruncated = false;
    let settled = false;
    let output: unknown;
    let structuredError: CodeRunResult['structuredError'];
    let killedByTimeout = false;

    const killTimer = setTimeout(() => {
      killedByTimeout = true;
      twoPhaseKill(child);
    }, timeoutMs);

    const settle = (status: CodeRunResult['status'], error?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      twoPhaseKill(child);
      resolvePromise({
        status,
        output,
        error,
        structuredError,
        logs,
        toolCalls,
        durationMs: Date.now() - startedAt,
      });
    };

    // ─── stdout：JSON 帧解析 → 分发 RPC ───
    let stdoutBuffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8');
      let newlineIdx = stdoutBuffer.indexOf('\n');
      while (newlineIdx !== -1) {
        const line = stdoutBuffer.slice(0, newlineIdx);
        stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1);
        void handleFrame(line.trim());
        newlineIdx = stdoutBuffer.indexOf('\n');
      }
    });

    const handleFrame = async (line: string): Promise<void> => {
      if (!line || settled) return;
      if (line.length > FRAME_LIMIT_BYTES) {
        logs.push('[CodeRunner] frame exceeded 256KB limit, dropped');
        return;
      }
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        logs.push(`[CodeRunner] non-frame stdout: ${line.slice(0, 200)}`);
        return;
      }

      const method = msg.method;
      if (method === 'done') {
        output = msg.result;
        settle('completed');
        return;
      }
      if (method === 'error') {
        structuredError = msg.error as CodeRunResult['structuredError'];
        settle('failed', structuredError?.message ?? 'code runner error');
        return;
      }
      if (typeof msg.id === 'number' && typeof method === 'string') {
        try {
          const response = await opts.bridge.handleRequest({
            id: msg.id as number,
            method: method as
              | 'callTool'
              | 'readContext'
              | 'writeOutput'
              | 'emitEvent',
            params: (msg.params as Record<string, unknown>) ?? {},
          });
          if (settled) return;
          child.stdin?.write(JSON.stringify(response) + '\n');
          if (method === 'callTool') {
            const params = msg.params as Record<string, unknown> | undefined;
            const name = String(params?.name ?? '');
            toolCalls.push({
              name,
              argsHash: hashArgs(
                params?.args as Record<string, unknown> | undefined
              ),
              ok: response.ok,
              truncatedResult: response.ok
                ? truncate(JSON.stringify(response.result), 200)
                : undefined,
            });
          }
        } catch (error) {
          void handleError(error, {
            module: 'tools:CodeRunner',
            action: 'handle_rpc_frame',
          });
        }
      }
    };

    // ─── stderr：用户脚本日志（体积上限截断）───
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBytes >= STDERR_LIMIT_BYTES) {
        if (!stderrTruncated) {
          logs.push(
            `[CodeRunner] stderr exceeded ${STDERR_LIMIT_BYTES} bytes, truncated`
          );
          stderrTruncated = true;
        }
        return;
      }
      stderrBytes += chunk.length;
      const text = chunk.toString('utf8');
      const remaining = STDERR_LIMIT_BYTES - (stderrBytes - chunk.length);
      logs.push(text.slice(0, remaining));
    });

    // ─── 进程退出兜底 ───
    child.on('exit', (code) => {
      if (settled) return;
      if (killedByTimeout) {
        settle('timeout', 'code runner timed out');
      } else if (code !== 0) {
        settle('failed', `code runner exited with code ${code}`);
      } else {
        settle('failed', 'code runner exited without done()');
      }
    });
    child.on('error', (error) => {
      if (settled) return;
      settle('failed', `spawn error: ${error.message}`);
    });
  });
}

/**
 * 执行编排代码（跨平台受限子进程）
 */
export async function runCodeRunner(
  opts: CodeRunnerExecOptions
): Promise<CodeRunResult> {
  const { runDir, wrapperPath } = await prepareRunDir(opts);
  // bun 可执行文件 = 当前运行时 process.execPath
  const child = spawn(process.execPath, ['run', wrapperPath, 'user.ts'], {
    cwd: runDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    // O4（v7.1）"终止按进程组"：POSIX 下让子进程**自成进程组**（组长 pid == 子进程 pid），
    // 使 `process.kill(-pid, sig)` 能一次终止整组（含用户脚本派生的孙进程）。
    // Windows 不需要（`taskkill /T` 按父子树终止），且避免多开控制台窗口。
    detached: process.platform !== 'win32',
  });
  return runRpcChildProcess(child, {
    bridge: opts.bridge,
    timeoutMs: opts.timeoutMs,
  });
}

/**
 * 两阶段终止 —— **按进程组/进程树**（O4 v7.1；原实现只 `child.kill()` 直接子进程）。
 *
 * **为什么必须按组/树**：CodeRunner 执行的是**用户脚本**，它常再派生 shell/子进程；
 * 只 kill 直接子进程会留下**孙进程**（孤儿）—— 继续占用 CPU、继续改写工作目录。
 *
 * 平台差异（先例：[cli-runner/index.ts:205-220](file:///e:/PY/Documents/CODES/PY_APP/app/src/agent/cli-runner/index.ts#L205-L220)）：
 * - **Windows**：`taskkill /PID <pid> /T /F` 按**父子树**终止（不依赖进程组语义）。
 *   Windows 无 POSIX 信号 ⇒ 没有"先 SIGTERM 再 SIGKILL"的余地（`child.kill()` 本身即强杀）。
 * - **POSIX**：子进程以 `detached: true` 启动 ⇒ 自成进程组，用 `process.kill(-pid, sig)`
 *   终止**整组**；先 `SIGTERM`，`KILL_GRACE_MS` 后 `SIGKILL`。
 * - 组/树终止不可用（进程已退出、权限不足、未以 detached 启动等）⇒ **回退 `child.kill(sig)`**
 *   ⇒ 任何情况下都**不弱于**旧行为。
 *
 * ⚠ 误杀边界：只作用于**该子进程自己的进程组/父子树**，不使用 `process.kill(0)` 这类全量信号。
 *
 * 导出供直接单测（本函数的正确性依赖真实进程行为，无法用纯桩覆盖）。
 */
export function twoPhaseKill(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) return;

  if (process.platform === 'win32') {
    killWindowsProcessTree(child);
    return;
  }

  const pid = child.pid;
  const signalGroup = (signal: NodeJS.Signals): boolean => {
    if (pid === undefined) return false;
    try {
      process.kill(-pid, signal); // 负 pid = 进程组
      return true;
    } catch {
      return false;
    }
  };

  if (!signalGroup('SIGTERM')) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already exited */
    }
  }

  const sigkillTimer = setTimeout(() => {
    if (child.exitCode !== null) return;
    if (!signalGroup('SIGKILL')) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already exited */
      }
    }
  }, KILL_GRACE_MS);
  child.once('exit', () => clearTimeout(sigkillTimer));
}

/** Windows：`taskkill /T` 终止整棵父子树（同步执行 —— kill 语义要求"发出即生效"） */
function killWindowsProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
    });
  } catch {
    // 进程已退出 / taskkill 不可用 ⇒ 回退单进程强杀（与旧行为等价）
    try {
      child.kill();
    } catch {
      /* already exited */
    }
  }
}

/** 参数哈希（内部调用摘要，CM-5） */
function hashArgs(args: Record<string, unknown> | undefined): string {
  const raw = JSON.stringify(args ?? {});
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

/** 截断到上限 */
function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

/** 供外部判断绝对路径（保留，onResolve 放行语义对齐） */
export function isAbsolutePath(p: string): boolean {
  return isAbsolute(p);
}
