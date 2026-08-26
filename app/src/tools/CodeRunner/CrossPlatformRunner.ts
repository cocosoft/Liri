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

import { spawn, type ChildProcess } from 'child_process';
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
  });
  return runRpcChildProcess(child, {
    bridge: opts.bridge,
    timeoutMs: opts.timeoutMs,
  });
}

/** 两阶段终止（参考 StdioTransport.killProcess：SIGTERM → 2s → SIGKILL） */
function twoPhaseKill(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) return;
  try {
    child.kill('SIGTERM');
  } catch {
    try {
      child.kill();
    } catch {
      /* already exited */
    }
    return;
  }
  const sigkillTimer = setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      try {
        child.kill();
      } catch {
        /* already exited */
      }
    }
  }, KILL_GRACE_MS);
  child.once('exit', () => clearTimeout(sigkillTimer));
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
