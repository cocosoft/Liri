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
 * 第九轮审查 §九 —— **「沙箱执行」回归测试组**（2026-10-10）。
 *
 * 审查原文：*"验证最终 spawn 路径确实应用了预期的文件系统、网络和工作区限制"*。
 *
 * 与既有测试的分工（**互补、不重复**）：
 *  - `sandbox/negativeEnforcement.test.ts`：Landlock **真实内核拒绝**（越权读/写/子进程），
 *    仅 Linux + helper 可用时运行，其余平台显式 skip。
 *  - `tools/bashLandlockExec.test.ts`：bash 门控判据 + 策略形状 + argv 形状。
 *  - `sandbox/concurrencyIsolation.test.ts`：并发执行的策略不串线。
 *
 * 本文件补的是**跨 runner 的"最终 spawn 参数"契约**：在 `execBashCommand`（bash 唯一收敛
 * 入口）与 `runCodeRunnerWithLandlock`（code_run 的 spawn 组装）**真正构造 spawn 参数的位置**，
 * 断言文件系统 / 网络 / 工作区三类限制**均已按各自设计落地且未被静默放松**：
 *  - bash：cwd 可写、系统路径只读、`~/.pyapp` **不放行**、**网络按设计不受限**（不得谎称受限）；
 *  - code_run：运行目录可写、bun 解释器只读、**网络全禁**（`--net-deny`）、`~/.pyapp` 不放行。
 *
 * 纯离线（注入 runner / 纯函数），跨平台稳定。
 */
import { describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  execBashCommand,
  type LandlockHelperRunner,
} from '../../src/tools/bash/bashLandlockExec.js';
import { buildLandlockArgv } from '../../src/sandbox/landlock/runWithLandlock.js';
import { buildBunLandlockPolicy } from '../../src/tools/CodeRunner/LinuxSandboxRunner.js';
import {
  DEFAULT_LANDLOCK_CONFIG,
  type LandlockCapability,
  type LandlockConfig,
} from '../../src/sandbox/index.js';

const AVAILABLE: LandlockCapability = { available: true, abi: 3 };
const CWD = '/repo/work';

/** 执行 bash 且**捕获**最终交给 helper 的 spawn 参数（argv/policy） */
async function captureBashSpawn(config: LandlockConfig): Promise<{
  argv: string[];
  policy: { fs: { path: string; allow: string[] }[]; net?: unknown };
}> {
  let captured: { argv: string[]; policy: never } | undefined;
  const runner: LandlockHelperRunner = async (input) => {
    captured = { argv: input.argv, policy: input.policy as never };
    return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
  };
  await execBashCommand({
    command: 'echo spawn-probe',
    cwd: CWD,
    env: {} as NodeJS.ProcessEnv,
    timeoutMs: 1000,
    maxBufferChars: 4096,
    deps: {
      config,
      evalForced: false,
      platform: 'linux',
      detect: async () => AVAILABLE,
      pathExists: () => true,
      runHelper: runner,
    },
  });
  if (!captured) throw new Error('runner 未被调用（未走到 spawn 组装）');
  return captured;
}

const BASH_ON: LandlockConfig = {
  ...DEFAULT_LANDLOCK_CONFIG,
  enabled: true,
  bashEnabled: true,
};

describe('§九 沙箱执行 —— bash 最终 spawn 路径限制', () => {
  it('工作区（cwd）以 `--rw` 落地：可在工作区内读写', async () => {
    const { argv } = await captureBashSpawn(BASH_ON);
    const i = argv.indexOf(CWD);
    expect(i).toBeGreaterThan(0);
    expect(argv[i - 1]).toBe('--rw');
  });

  it('系统路径以 `--ro` 落地：shell/动态库可读可执行，但不可写', async () => {
    const { argv } = await captureBashSpawn(BASH_ON);
    for (const sysPath of ['/usr', '/bin', '/lib', '/etc']) {
      const i = argv.indexOf(sysPath);
      expect(i).toBeGreaterThan(0);
      expect(argv[i - 1]).toBe('--ro');
    }
  });

  it('`~/.pyapp` 整棵目录树**不放行**（工作区外写被收窄）', async () => {
    const { argv } = await captureBashSpawn(BASH_ON);
    const pyapp = join(homedir(), '.pyapp');
    expect(argv).not.toContain(pyapp);
  });

  it('命令以**单个 argv 元素**交给 `/bin/sh -c`（无 shell 拼接注入面）', async () => {
    const { argv } = await captureBashSpawn(BASH_ON);
    expect(argv.slice(-4)).toEqual(['--', '/bin/sh', '-c', 'echo spawn-probe']);
  });

  it('网络按**设计**不受限：不传 `--net-deny`（不得谎称已限网络）', async () => {
    const { argv } = await captureBashSpawn(BASH_ON);
    // bash 从来不是网络受限通道（见 buildBashLandlockPolicy 注释）；
    // 若未来要限网络，必须**同时**改策略与断言 —— 此断言防"静默改语义"。
    expect(argv).not.toContain('--net-deny');
  });

  it('用户额外可写路径（`bashExtraWritablePaths`）逐条 `--rw` 落地', async () => {
    const { argv } = await captureBashSpawn({
      ...BASH_ON,
      bashExtraWritablePaths: ['/data/extra'],
    });
    const i = argv.indexOf('/data/extra');
    expect(i).toBeGreaterThan(0);
    expect(argv[i - 1]).toBe('--rw');
  });
});

describe('§九 沙箱执行 —— code_run 最终 spawn 路径限制', () => {
  /** 复刻 `runCodeRunnerWithLandlock` 第 234-241 行的 spawn 参数组装 */
  function codeRunArgv(runDir: string): string[] {
    const policy = buildBunLandlockPolicy(runDir, 3);
    return [...buildLandlockArgv(policy, () => true)];
  }

  it('运行目录以 `--rw` 落地（运行时产物可写）', () => {
    const runDir = '/tmp/coderun-x';
    const argv = codeRunArgv(runDir);
    const i = argv.indexOf(runDir);
    expect(i).toBeGreaterThan(0);
    expect(argv[i - 1]).toBe('--rw');
  });

  it('网络**全禁**：`--net-deny` 落地（与 bash 相反，code_run 是网络受限通道）', () => {
    const argv = codeRunArgv('/tmp/coderun-x');
    expect(argv).toContain('--net-deny');
  });

  it('`~/.pyapp` 不在 code_run 策略内（敏感目录不因 runDir 之外被放行）', () => {
    const argv = codeRunArgv('/tmp/coderun-x');
    expect(argv).not.toContain(join(homedir(), '.pyapp'));
  });
});
