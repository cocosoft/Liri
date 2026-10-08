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
 * landlock-run **协议部件**（P1，2026-08-25）
 *
 * 提供与 `landlock-run` helper 的 CLI 契约两件套：
 * 1. `buildLandlockArgv`：`LandlockPolicy` → CLI 参数（`--ro/--rw` · `--net-deny`）；
 * 2. `isSandboxInitFailure`：exit 125 归因契约。
 *
 * fail-closed 协议（对齐参考仓库 cli-contract.md / postmortem 0004）：
 * - exit 125 = 沙箱初始化失败（helper 内部 ABI/规则/restrict 失败），stderr 前缀 `landlock-run: `
 * - partial 通知（`landlock-run: partial: ...`）非致命，命令继续执行
 * - 非 125 退出码 = 目标命令本身结果（消费者归因仅看 exit 125）
 *
 * ⚠️ 2026-10-08（P1-续 S5）：原 `runWithLandlock()`（在 Landlock 域内直接 spawn 的"执行器"）
 * **无任何调用点** ⇒ 已删。真实执行由消费者**直接** `buildLandlockArgv` + `spawn` 承担：
 * bash = `tools/bash/bashLandlockExec.ts`；code_run = `tools/CodeRunner/LinuxSandboxRunner.ts`。
 */
import { existsSync } from 'node:fs';
import type { LandlockPolicy } from './types';

/** fail-closed：沙箱初始化失败退出码 */
const EXIT_SANDBOX_INIT_FAILED = 125;

/**
 * exit 125 归因契约（postmortem 0004）：
 * 消费者判定"沙箱初始化失败"只看 exit 125，禁止"stderr 前缀 + 非零退出码"。
 */
export function isSandboxInitFailure(exitCode: number): boolean {
  return exitCode === EXIT_SANDBOX_INIT_FAILED;
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
