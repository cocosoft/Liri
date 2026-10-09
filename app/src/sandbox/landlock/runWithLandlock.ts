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
 * CLI 语法与 `native/main.c` 对齐：`--ro/--rw`（FS 规则）、`--net-deny`（网络全禁）、
 * `-- <argv>...`（命令）。
 *
 * fail-closed 协议（对齐参考仓库 cli-contract.md / postmortem 0004）：
 * - exit 125 = 沙箱初始化失败（helper 内部 ABI/规则/restrict 失败），stderr 前缀 `landlock-run: `
 * - partial 通知（`landlock-run: partial: ...`）非致命，命令继续执行
 * - 非 125 退出码 = 目标命令本身结果（消费者归因仅看 exit 125）
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LandlockPolicy, LandlockRunResult } from './types';
// S5（2026-10-09）：输出软上限复用 B1 的"逐块按剩余量切片"助手（截断口径单一来源）
import { appendWithinLimit } from '../SandboxPolicy';
// R21（2026-10-09）：取消/中止时按**进程树**强杀（防 shell 与孙进程成为孤儿）
import { killProcessTree } from '../utils/killProcessTree';

/** fail-closed：沙箱初始化失败退出码 */
const EXIT_SANDBOX_INIT_FAILED = 125;

/**
 * exit 125 归因契约（postmortem 0004）：
 * 消费者判定"沙箱初始化失败"只看 exit 125，禁止"stderr 前缀 + 非零退出码"。
 */
export function isSandboxInitFailure(exitCode: number): boolean {
  return exitCode === EXIT_SANDBOX_INIT_FAILED;
}

export interface RunWithLandlockOptions {
  helperPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /**
   * 输出软上限（**按字符**比较，与 bash / PTY 同口径）：超出即截断并追加标记，
   * 防止 stdout/stderr 无界累积撑爆内存（B1 / G1-A 同一机制，`appendWithinLimit`）。
   * 缺省 = 不限制。
   */
  maxBufferChars?: number;
  /**
   * R21（2026-10-09）：取消信号 —— `abort` 时按**进程树**强杀（Unix 杀进程组 / Windows `taskkill /T`），
   * 否则会话取消后 `landlock-run → /bin/sh → 孙进程` 会继续运行（孤儿进程）。
   */
  signal?: AbortSignal;
}

/**
 * 将 LandlockPolicy 转换为 landlock-run CLI 参数。
 * - 含 write 的规则 → `--rw`（完整 FS 访问，含 read/execute）
 * - 仅 read/execute 的规则 → `--ro`（read+execute）
 * - `net.denyAll === true` → `--net-deny`（网络全禁）；**不设 `net` ⇒ 不传网络参数**（网络不受限）
 *
 * **统一按存在性过滤（2026-10-05）**：`landlock-run` 对**不存在的规则路径**直接 `exit 125`
 * （沙箱初始化失败 ⇒ 按 `failClosed` 拒绝或回退，**整只沙箱失效**）—— 实测 `--ro /NOPE` 即 125。
 * 而策略里的系统路径（`/lib32`/`/opt`…）与平台特有路径（WSL 的 `/mnt/wsl`…）在部分发行版/环境
 * 可能不存在 ⇒ 此处**缺失即跳过该规则**（策略声明意图、argv 只保留真实存在的路径）。
 * `pathExists` 可注入，便于离线断言两分支（默认 `fs.existsSync`）。
 *
 * ⚠️ 2026-09-29（台账 D-36-① / D-38）：原实现对 `net.allow` 里的 `connect_tcp`/`connect_udp`
 * 逐个输出 `--net-connect tcp|udp` —— 而该 flag 在内核侧的实际语义是**拒绝**该协议 CONNECT
 * 且**放行** bind（详见 `types.ts` 的 `LandlockNetRule` 注释）⇒ 与调用方意图相反。现按
 * **可表达的两态**输出。
 */
export function buildLandlockArgv(
  policy: LandlockPolicy,
  pathExists: (path: string) => boolean = existsSync
): string[] {
  const args: string[] = [];
  for (const rule of policy.fs) {
    // 缺失路径 ⇒ 跳过（否则 helper exit 125，整只沙箱失效）
    if (!pathExists(rule.path)) continue;
    if (rule.allow.includes('write')) {
      args.push('--rw', rule.path);
    } else {
      args.push('--ro', rule.path);
    }
  }
  if (policy.net?.denyAll) {
    args.push('--net-deny');
  }
  return args;
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
      timedOut: false,
      sandboxInitFailed: false,
    };
  }

  const helper = options.helperPath ?? 'landlock-run';
  // 写 policy 到临时目录仅用于审计/调试（helper 本身经 argv 读取规则）
  const dir = await mkdtemp(join(tmpdir(), 'landlock-'));
  const policyPath = join(dir, 'policy.json');
  await writeFile(policyPath, JSON.stringify(policy));

  try {
    // landlock-run [--ro p]... [--rw p]... [--net-deny] -- /bin/sh -c "<command>"
    const args = [...buildLandlockArgv(policy), '--', '/bin/sh', '-c', command];
    return await new Promise<LandlockRunResult>((resolve) => {
      const child = spawn(helper, args, {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeoutMs,
        windowsHide: true,
        // R21：Unix 下自成进程组组长（供 `process.kill(-pid)` **整组**终止含孙进程）；
        //       Windows 无组语义，保持默认（改用 `taskkill /T`）。
        detached: process.platform !== 'win32',
      });
      // R21（2026-10-09）：取消/中止 ⇒ 强杀**进程树**（含 `/bin/sh` 与命令派生的孙进程）
      const signal = options.signal;
      const onAbort = (): void => killProcessTree(child);
      const cleanupAbort = (): void =>
        signal?.removeEventListener('abort', onAbort);
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      let stdout = '';
      let stderr = '';
      const maxChars = options.maxBufferChars;
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
      child.on('error', (err: NodeJS.ErrnoException) => {
        cleanupAbort();
        // spawn 失败（helper 缺失等）：**不**归因为 exit 125 —— 125 是"沙箱初始化失败"的专用信号
        // （`isSandboxInitFailure` 只看退出码，混用会触发错误的 fail-closed 分支）
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
          sandboxInitFailed: isSandboxInitFailure(code ?? -1),
          pid: child.pid,
        });
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
