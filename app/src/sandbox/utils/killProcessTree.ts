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
 * 进程树终止助手（R21，2026-10-09）
 *
 * **动机**：bash / code_run 的子进程是**多层**（`landlock-run` helper → `/bin/sh -c` → 命令自身
 * 派生的孙进程）。仅 `child.kill()` 只终止**直接子进程** ⇒ shell 与其孙进程会成为**孤儿进程**
 * 继续消耗 CPU/FD（Gemini 二轮审计所指的 "Orphan Processes"）。
 *
 * **口径**：
 *  - **Unix**：`spawn(..., { detached: true })` 使子进程自成**进程组组长** ⇒
 *    `process.kill(-pid, 'SIGKILL')` 一次终止**整组**（含孙进程）。
 *  - **Windows**：无信号语义 ⇒ `taskkill /PID <pid> /T /F` 终止整树。
 *  - 任一分支失败（进程已退出 / 组不存在 / taskkill 缺失）⇒ **降级**为 `child.kill('SIGKILL')`，
 *    尽力而为、**不抛错**（清理路径不得反过来打断主流程）。
 *
 * `deps` 可注入 ⇒ 离线可测（不真正杀进程）。
 */
import { spawn } from 'node:child_process';

/** 终止所需的最小子进程投影（便于用替身离线断言） */
export interface KillableChild {
  pid?: number | undefined;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface KillProcessTreeDeps {
  platform?: NodeJS.Platform;
  /** Unix：按**进程组**强杀（默认 `process.kill(-pid, 'SIGKILL')`） */
  killGroup?: (pid: number) => void;
  /** Windows：整树强杀（默认 `taskkill /PID <pid> /T /F`，异步、失败忽略） */
  runTaskkill?: (pid: number) => void;
}

function defaultKillGroup(pid: number): void {
  process.kill(-pid, 'SIGKILL');
}

function defaultTaskkill(pid: number): void {
  const proc = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
    stdio: 'ignore',
  });
  proc.on('error', () => {
    /* taskkill 缺失 / 进程已退出：忽略 */
  });
}

export function killProcessTree(
  child: KillableChild,
  deps: KillProcessTreeDeps = {}
): void {
  const platform = deps.platform ?? process.platform;
  const pid = child.pid;
  try {
    if (pid !== undefined && pid > 0) {
      if (platform === 'win32') {
        (deps.runTaskkill ?? defaultTaskkill)(pid);
      } else {
        (deps.killGroup ?? defaultKillGroup)(pid);
      }
      return;
    }
  } catch {
    // 落下方"直接子进程"降级
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // @ignore-catch: 进程可能已退出（清理路径不得抛错）
  }
}
