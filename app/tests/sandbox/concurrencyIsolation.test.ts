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
 * R2 **执行能力矩阵**之「并发执行 ⇒ 工作区 / 权限 / 进程记录不串线」。
 *
 * 两处并发面：
 *  ① `ProcessRegistry`：并发登记不产生重复 id、`updateStatus` 只改目标任务、统计一致、清理幂等；
 *  ② `execBashCommand`：**并发调用的策略按调用点构造**（argv 中 `--rw <cwd>` 各自指向自身 cwd）
 *     ⇒ 无共享可变状态导致的串线（用注入 runner 离线断言，跨平台稳定）。
 */
import { describe, it, expect } from 'bun:test';
import { ProcessRegistry } from '../../src/sandbox/ProcessRegistry';
import {
  execBashCommand,
  type LandlockHelperRunner,
} from '../../src/tools/bash/bashLandlockExec';
import { DEFAULT_LANDLOCK_CONFIG } from '../../src/sandbox';
import type { LandlockCapability, LandlockConfig } from '../../src/sandbox';

const AVAILABLE: LandlockCapability = { available: true, abi: 3 };
const cfg: LandlockConfig = { ...DEFAULT_LANDLOCK_CONFIG, bashEnabled: true };

describe('R2 并发：进程记录不串线（ProcessRegistry）', () => {
  it('并发登记 100 条 ⇒ id 唯一 + 统计一致', () => {
    const reg = new ProcessRegistry(1000);
    const ids = Array.from({ length: 100 }, (_, i) =>
      reg.register({ pid: 10000 + i, command: `cmd-${i}`, status: 'running' })
    );
    expect(new Set(ids).size).toBe(100);
    expect(reg.getStats()).toEqual({
      total: 100,
      running: 100,
      completed: 0,
      killed: 0,
      errors: 0,
    });
  });

  it('updateStatus 只改目标任务（其余不串）', () => {
    const reg = new ProcessRegistry(100);
    const ids = Array.from({ length: 5 }, (_, i) =>
      reg.register({ pid: 20000 + i, command: `cmd-${i}`, status: 'running' })
    );
    reg.updateStatus(ids[3], 'completed', 0);

    expect(reg.getProcess(ids[3])?.status).toBe('completed');
    expect(reg.getProcess(ids[3])?.exitCode).toBe(0);
    expect(reg.getProcess(ids[4])?.status).toBe('running');
    expect(reg.getStats()).toEqual({
      total: 5,
      running: 4,
      completed: 1,
      killed: 0,
      errors: 0,
    });
  });

  it('清理幂等：重复 removeProcess 安全（二次返回 false）', () => {
    const reg = new ProcessRegistry(10);
    const id = reg.register({ pid: 1, command: 'x', status: 'running' });
    expect(reg.removeProcess(id)).toBe(true);
    expect(reg.removeProcess(id)).toBe(false);
  });
});

describe('R2 并发：各自策略不串线（execBashCommand）', () => {
  it('并发调用各自 argv 的 `--rw` 指向自身 cwd（无交叉）', async () => {
    const seen: Array<{ command: string; argv: string[]; cwd?: string }> = [];
    const runHelper: LandlockHelperRunner = async (input) => {
      seen.push({
        command: input.command,
        argv: [...input.argv],
        cwd: input.cwd,
      });
      return {
        stdout: `out:${input.command}`,
        stderr: '',
        exitCode: 0,
        timedOut: false,
      };
    };
    const deps = {
      config: cfg,
      platform: 'linux' as NodeJS.Platform,
      detect: async (): Promise<LandlockCapability> => AVAILABLE,
      pathExists: () => true,
      runHelper,
    };

    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        execBashCommand({
          command: `echo job-${i}`,
          cwd: `/work/job-${i}`,
          env: {},
          timeoutMs: 1000,
          maxBufferChars: 2048,
          deps,
        })
      )
    );

    // 每个调用拿回自己的输出（不交叉）
    results.forEach((r, i) => {
      expect(r.stdout).toBe(`out:echo job-${i}`);
    });

    // 每个 argv 都把自己的 cwd 声明为 `--rw`（策略按调用点构造，无共享可变状态）
    expect(seen).toHaveLength(N);
    for (const entry of seen) {
      expect(entry.cwd).toBeDefined();
      const idx = entry.argv.indexOf(entry.cwd as string);
      expect(idx).toBeGreaterThan(0);
      expect(entry.argv[idx - 1]).toBe('--rw');
    }
  });
});
