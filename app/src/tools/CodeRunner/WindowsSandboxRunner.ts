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
 * `code_run` 的 Windows 执行器（Low IL + Job Object，2026-10-26）。
 *
 * 与 `LinuxSandboxRunner` / `MacOSSandboxRunner` **同形**：
 * - `sandbox.landlock.enabled=false` ⇒ 不探测、直接交回跨平台执行器（`null`）；
 * - helper 缺失 / 打标失败 ⇒ `failClosed=true` 拒绝（`security-rejected`）、`false` 降级（`null` + warn）；
 * - 可用 ⇒ 对**自有 runDir** 打 Low 强制标签（`icacls /setintegritylevel`），在 helper 下跑
 *   `bun run wrapper user.ts`，RPC 交互复用 `CrossPlatformRunner`。
 *
 * 为什么只给 runDir 打标：Low IL 进程默认写不了 Medium 目录；给用户仓库打标会污染其 ACL
 * （见 spec §3.3），故 v1 只覆盖"我们自己的临时目录"。
 *
 * 子进程的 TEMP/TMP 指向 runDir 内的子目录（同样是 Low）—— 否则 bun 写 `%TEMP%`（Medium）
 * 会被 MIC 拒绝，表现为"沙箱一开就跑不起来"。
 */
import { execFile, spawn } from 'child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  PROCESS_STATUS,
  WIN_SANDBOX_EXIT,
  classifyWinSandboxExit,
  detectWindowsSandboxCapability,
  buildWinSandboxArgv,
  processRegistry,
  readLandlockConfig,
  resolveWinSandboxHelperPath,
} from '@modules/sandbox';
import type { WindowsSandboxCapability } from '@modules/sandbox';
import type { LandlockConfig } from '@modules/sandbox';
import { getLogger } from '@modules/monitoring';

import {
  prepareRunDir,
  runRpcChildProcess,
  type CodeRunnerExecOptions,
} from './CrossPlatformRunner';
import type { CodeRunResult } from './types';

const logger = getLogger('tools:CodeRunner:windows');
const execFileAsync = promisify(execFile);

/** 打标签结果（失败原因回给日志，不吞） */
export interface LowLabelResult {
  ok: boolean;
  error?: string;
}

export interface WindowsSandboxRunnerDeps {
  /** 配置（默认 `readLandlockConfig()`；测试注入） */
  config?: LandlockConfig;
  /** 能力探测（默认 `detectWindowsSandboxCapability`；测试注入） */
  detect?: () => WindowsSandboxCapability;
  /** 给目录打 Low 强制标签（默认 `icacls`；测试注入） */
  applyLowLabel?: (dir: string) => Promise<LowLabelResult>;
}

/**
 * 给**自有目录**打 Low 完整性标签（递归）。
 *
 * `icacls "<dir>" /setintegritylevel (OI)(CI)Low`：只影响该目录树的强制标签，
 * 不改 DACL；目录是一次性 runDir，无需恢复（失败仅记日志）。
 */
async function applyLowLabelWithIcacls(dir: string): Promise<LowLabelResult> {
  try {
    await execFileAsync('icacls.exe', [
      dir,
      '/setintegritylevel',
      '(OI)(CI)Low',
    ]);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 构造"拒绝执行"的结果（与 landlock 的 `security-rejected` 同语义） */
function refusalResult(message: string): CodeRunResult {
  return {
    status: 'security-rejected',
    error: message,
    logs: [],
    toolCalls: [],
    durationMs: 0,
  };
}

/**
 * 在 Windows Low IL 沙箱中执行编排代码。
 *
 * @returns 执行结果；应改走跨平台执行器时返回 `null`（调用方降级）
 */
export async function runCodeRunnerWithWindowsSandbox(
  opts: CodeRunnerExecOptions,
  deps: WindowsSandboxRunnerDeps = {}
): Promise<CodeRunResult | null> {
  const config = deps.config ?? readLandlockConfig();
  if (!config.enabled) {
    logger.debug(
      'sandbox disabled by config, cross-platform runner takes over'
    );
    return null;
  }

  const cap = (deps.detect ?? detectWindowsSandboxCapability)();
  if (!cap.available) {
    if (config.failClosed) {
      logger.warn(
        'Windows 沙箱被强制要求但不可用 ⇒ 拒绝 code_run（failClosed=true）',
        {
          reason: cap.reason,
        }
      );
      return refusalResult(
        `Windows 沙箱不可用（${cap.reason ?? '未知'}；sandbox.landlock.failClosed=true）⇒ 拒绝执行 code_run，` +
          `不降级到无约束执行。请运行 bun run build:win-sandbox，或关闭该开关。`
      );
    }
    logger.warn('Windows 沙箱不可用 ⇒ 按 failClosed=false 降级跨平台执行器', {
      reason: cap.reason,
    });
    return null;
  }

  const { runDir, wrapperPath } = await prepareRunDir(opts);

  // 打 Low 标签：**证明不了写隔离成立时，不得声称受限**（fail-closed）
  const label = await (deps.applyLowLabel ?? applyLowLabelWithIcacls)(runDir);
  if (!label.ok) {
    if (config.failClosed) {
      return refusalResult(
        `无法为运行目录打 Low 完整性标签（${label.error ?? '未知'}；failClosed=true）⇒ 拒绝执行 code_run。`
      );
    }
    logger.warn('打 Low 标签失败 ⇒ 按 failClosed=false 降级跨平台执行器', {
      error: label.error,
    });
    return null;
  }

  // 子进程临时目录也放到 runDir 内（Low 标签覆盖），否则 bun 写 %TEMP% 会被拒
  const lowTemp = join(runDir, 'tmp');
  mkdirSync(lowTemp, { recursive: true });

  const argv = buildWinSandboxArgv({
    program: process.execPath,
    args: ['run', wrapperPath, 'user.ts'],
    // 缺省超时 ⇒ 0（helper 视为不限；由 RPC 层按 opts.timeoutMs 兜底，与其它 runner 同口径）
    timeoutMs: opts.timeoutMs ?? 0,
    maxProcs: 32,
  });
  const helperPath = resolveWinSandboxHelperPath({ platform: 'win32' });
  const child = spawn(helperPath, argv, {
    cwd: runDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TEMP: lowTemp, TMP: lowTemp, TMPDIR: lowTemp },
  });

  // S7：登记进 ProcessRegistry（异步 RPC ⇒ 先 running，close 收敛终态）
  const processEntryId =
    child.pid === undefined
      ? undefined
      : processRegistry.register({
          pid: child.pid,
          command: 'code_run',
          status: PROCESS_STATUS.running,
          metadata: { source: 'code_run', sandbox: 'windows-low-il' },
        });
  child.on('close', (code) => {
    if (processEntryId === undefined) return;
    processRegistry.complete(
      processEntryId,
      (child as { killed?: boolean }).killed
        ? PROCESS_STATUS.timedOut
        : PROCESS_STATUS.completed,
      code ?? undefined
    );
  });

  const result = await runRpcChildProcess(child, {
    bridge: opts.bridge,
    timeoutMs: opts.timeoutMs,
  });

  const semantics = classifyWinSandboxExit(result.exitCode ?? null);
  if (semantics.helperFailed) {
    if (config.failClosed) {
      return {
        ...result,
        status: 'security-rejected',
        error:
          `Windows 沙箱 helper 自身失败（exit ${WIN_SANDBOX_EXIT.helperFailed}；failClosed=true）⇒ 拒绝执行 code_run。` +
          `原始信息：${result.error ?? '（无）'}`,
      };
    }
    logger.warn(
      'Windows 沙箱 helper 自身失败（exit 126）⇒ 按 failClosed=false 降级跨平台执行器',
      { detail: result.error }
    );
    return null;
  }

  return result;
}
