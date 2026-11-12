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
 * `sandbox-exec` 执行器（macOS Seatbelt，2026-10-26）。
 *
 * 与 `runWithLandlock` **同形**：结果字段、超时、输出软上限、取消即强杀进程树都一致，
 * 便于上层（`bashLandlockExec`）用同一段后处理（exit-125 协议除外，见下）。
 *
 * 与 landlock 的差异（如实）：
 * - 没有 exit 125 协议 ⇒ `sandboxInitFailed` 恒 `false`；profile 语法错会以非 0 退出 + stderr 暴露；
 * - profile 直接经 `-p <string>` 传入（不落临时文件，减少子进程读取面）。
 */
import { spawn } from 'node:child_process';
import { appendWithinLimit } from '../SandboxPolicy';
import { killProcessTree } from '../utils/killProcessTree';
import { CHILD_PROCESS_ERROR_EVENT } from '../ProcessRegistry';
import { MACOS_SANDBOX_EXEC_PATH } from './MacOSSandboxDetector';

export interface SandboxExecRunInput {
  /** SBPL profile 文本（`buildMacOSSandboxProfile` 产出） */
  profile: string;
  /** 待执行命令（交 `shell -c`，使 shell 及其子进程全部受 profile 约束） */
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** 输出软上限（按字符，与 bash / PTY 同口径） */
  maxBufferChars: number;
  /** 取消/中止信号 ⇒ 按进程树强杀 */
  signal?: AbortSignal;
  /** 默认 `/bin/bash`；测试可注入 */
  shell?: string;
  /** 默认 `/usr/bin/sandbox-exec`；测试可注入 */
  sandboxExecPath?: string;
}

export interface SandboxExecRunResult {
  stdout: string;
  stderr: string;
  /** `null` = 未取到退出码（spawn 失败 / 被杀 / 超时） */
  exitCode: number | null;
  timedOut: boolean;
  error?: Error;
  /** 恒 `false`：`sandbox-exec` 无 exit-125 初始化失败协议（字段保留以与 landlock 结果同形） */
  sandboxInitFailed: boolean;
  pid?: number;
}

/**
 * 构造 `sandbox-exec` 的 argv（单独导出供离线断言形状）
 *
 * 形状：`['-p', <profile>, '--', <shell>, '-c', <command>]`
 */
export function buildSandboxExecArgv(input: {
  profile: string;
  command: string;
  shell?: string;
}): string[] {
  return [
    '-p',
    input.profile,
    '--',
    input.shell ?? '/bin/bash',
    '-c',
    input.command,
  ];
}

export async function runWithSandboxExec(
  input: SandboxExecRunInput
): Promise<SandboxExecRunResult> {
  // 防御性平台门控（正常应经 `detectMacOSSandboxCapability` 过滤）
  if (process.platform !== 'darwin') {
    return {
      stdout: '',
      stderr: 'sandbox-exec: unsupported platform',
      exitCode: 1,
      timedOut: false,
      sandboxInitFailed: false,
    };
  }

  const args = buildSandboxExecArgv({
    profile: input.profile,
    command: input.command,
    ...(input.shell ? { shell: input.shell } : {}),
  });

  return await new Promise<SandboxExecRunResult>((resolve) => {
    const child = spawn(
      input.sandboxExecPath ?? MACOS_SANDBOX_EXEC_PATH,
      args,
      {
        cwd: input.cwd,
        env: input.env,
        timeout: input.timeoutMs,
        windowsHide: true,
        // 自成进程组组长：`process.kill(-pid)` 可整组终止（含 shell 派生的孙进程）
        detached: true,
      }
    );

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
    const maxChars = input.maxBufferChars;
    const append = (acc: string, block: string): string =>
      maxChars === undefined
        ? acc + block
        : appendWithinLimit(acc, block, maxChars).text;

    child.stdout.on('data', (d: Buffer) => {
      stdout = append(stdout, d.toString());
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr = append(stderr, d.toString());
    });
    child.on(CHILD_PROCESS_ERROR_EVENT, (err: NodeJS.ErrnoException) => {
      cleanupAbort();
      resolve({
        stdout,
        stderr: stderr ? `${stderr}\n${String(err)}` : String(err),
        exitCode: null,
        timedOut: false,
        error: err,
        sandboxInitFailed: false,
        pid: child.pid,
      });
    });
    child.on('close', (code) => {
      cleanupAbort();
      resolve({
        stdout,
        stderr,
        exitCode: code,
        timedOut: !!(child as { killed?: boolean }).killed,
        sandboxInitFailed: false,
        pid: child.pid,
      });
    });
  });
}
