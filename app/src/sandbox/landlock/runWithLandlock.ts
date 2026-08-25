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
 * landlock-run 执行器（P1，2026-08-25）
 *
 * 通过 landlock-run 在 Landlock 域中执行命令（/bin/sh -c 使 shell 及全部子进程受域约束）。
 *
 * fail-closed 协议（对齐参考仓库 cli-contract.md / postmortem 0004）：
 * - exit 125 = 沙箱初始化失败（helper 内部 ABI/规则/restrict 失败），stderr 前缀 `landlock-run: `
 * - partial 通知（`landlock-run: partial: ...`）非致命，命令继续执行
 * - 非 125 退出码 = 目标命令本身结果
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LandlockPolicy, LandlockRunResult } from './types';

/** fail-closed：沙箱初始化失败退出码 */
const EXIT_SANDBOX_INIT_FAILED = 125;

export interface RunWithLandlockOptions {
  helperPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/**
 * 在 Landlock 域中执行命令。
 * 注意：本函数假设调用方已通过 `LandlockDetector.detect()` 确认可用；
 * 非 Linux 平台为防御性门控（正常不会走到）。
 */
export async function runWithLandlock(
  policy: LandlockPolicy,
  command: string,
  options: RunWithLandlockOptions = {}
): Promise<LandlockRunResult> {
  // 防御性平台门控（正常应经 LandlockDetector 过滤）
  if (process.platform !== 'linux') {
    return {
      stdout: '',
      stderr: 'landlock-run: unsupported platform',
      exitCode: 1,
      sandboxInitFailed: false,
    };
  }

  const helper = options.helperPath ?? 'landlock-run';
  const dir = await mkdtemp(join(tmpdir(), 'landlock-'));
  const policyPath = join(dir, 'policy.json');
  await writeFile(policyPath, JSON.stringify(policy));

  try {
    // landlock-run <policy.json> -- /bin/sh -c "<command>"
    const args = [policyPath, '--', '/bin/sh', '-c', command];
    return await new Promise<LandlockRunResult>((resolve) => {
      const child = spawn(helper, args, {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeoutMs,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      child.on('error', (err: NodeJS.ErrnoException) => {
        resolve({
          stdout,
          stderr: String(err),
          exitCode: EXIT_SANDBOX_INIT_FAILED,
          sandboxInitFailed: true,
        });
      });
      child.on('close', (code) => {
        const exitCode = code ?? 1;
        resolve({
          stdout,
          stderr,
          exitCode,
          sandboxInitFailed: exitCode === EXIT_SANDBOX_INIT_FAILED,
        });
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
