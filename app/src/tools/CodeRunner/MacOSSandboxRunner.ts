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
 * `code_run` 的 macOS 执行器（Seatbelt / `sandbox-exec`，2026-10-26）。
 *
 * 与 `LinuxSandboxRunner.runCodeRunnerWithLandlock` **同形**：
 * - `sandbox.landlock.enabled=false` ⇒ 不探测、直接交回跨平台执行器（`null`）；
 * - 能力不可用 ⇒ `failClosed=true` 拒绝（`security-rejected`）、`false` 降级（`null` + warn）；
 * - 可用 ⇒ `sandbox-exec` 下跑 `bun run wrapper user.ts`，RPC 交互与超时复用
 *   `CrossPlatformRunner` 的 `prepareRunDir` / `runRpcChildProcess`。
 *
 * 写入白名单与 `buildBunLandlockPolicy` 对齐：runDir / `~/.bun` / 临时目录；
 * 读取面首版不收紧（见方案 §3.5）。
 */
import { spawn } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';

import {
  MACOS_SANDBOX_EXEC_PATH,
  buildMacOSSandboxProfile,
  buildSandboxExecArgv,
  detectMacOSSandboxCapability,
  processRegistry,
  readLandlockConfig,
} from '@modules/sandbox';
import { getLogger } from '@modules/monitoring';

import {
  prepareRunDir,
  runRpcChildProcess,
  type CodeRunnerExecOptions,
} from './CrossPlatformRunner';
import type { CodeRunResult } from './types';

const logger = getLogger('tools:CodeRunner:macos');

/**
 * 在 macOS Seatbelt 域中执行编排代码。
 *
 * @returns 执行结果；应改走跨平台执行器时返回 `null`（调用方降级）
 */
export async function runCodeRunnerWithMacOSSandbox(
  opts: CodeRunnerExecOptions
): Promise<CodeRunResult | null> {
  const config = readLandlockConfig();
  // 总开关关闭 ⇒ 连探测都不做（配置语义："关闭则完全走本地执行路径"）
  if (!config.enabled) {
    logger.debug(
      'sandbox disabled by config, cross-platform runner takes over'
    );
    return null;
  }

  const cap = detectMacOSSandboxCapability();
  if (!cap.available) {
    if (config.failClosed) {
      logger.warn(
        'macOS 沙箱被强制要求但不可用 ⇒ 拒绝 code_run（failClosed=true）',
        { reason: cap.reason }
      );
      return {
        status: 'security-rejected',
        error:
          `macOS 沙箱不可用（${cap.reason ?? '未知'}；sandbox.landlock.failClosed=true）⇒ 拒绝执行 code_run，` +
          `不降级到无约束执行。请确认系统存在 ${MACOS_SANDBOX_EXEC_PATH}，或关闭该开关。`,
        logs: [],
        toolCalls: [],
        durationMs: 0,
      };
    }
    logger.warn('macOS 沙箱不可用 ⇒ 按 failClosed=false 降级跨平台执行器', {
      reason: cap.reason,
    });
    return null;
  }

  const { runDir, wrapperPath } = await prepareRunDir(opts);
  const profile = buildMacOSSandboxProfile({
    writablePaths: [
      runDir,
      // bun 缓存（首次运行会写 ~/.bun）
      join(homedir(), '.bun'),
      // 运行时临时文件
      '/tmp',
      '/private/tmp',
      '/private/var/folders',
    ],
  });
  const argv = buildSandboxExecArgv({
    profile,
    command: `"${process.execPath}" run "${wrapperPath}" user.ts`,
  });

  const child = spawn(MACOS_SANDBOX_EXEC_PATH, argv, {
    cwd: runDir,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // S7：登记进 `ProcessRegistry`（异步 RPC 子进程 ⇒ 先 `running`，close 时收敛终态）
  const processEntryId =
    child.pid === undefined
      ? undefined
      : processRegistry.register({
          pid: child.pid,
          command: 'code_run',
          status: 'running',
          metadata: { source: 'code_run', sandbox: 'macos-seatbelt' },
        });
  child.on('close', (code) => {
    if (processEntryId === undefined) return;
    processRegistry.complete(
      processEntryId,
      (child as { killed?: boolean }).killed ? 'timed_out' : 'completed',
      code ?? undefined
    );
  });

  return await runRpcChildProcess(child, {
    bridge: opts.bridge,
    timeoutMs: opts.timeoutMs,
  });
}
