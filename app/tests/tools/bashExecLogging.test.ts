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
 * `execBashCommand` 成败/拒绝分支可观测性（B 类缺口 ③，2026-10-25 补日志）
 *
 * 缺陷背景：bash 执行**唯一收敛入口**此前只在不常见分支（Landlock init 失败回退）有
 * 一处 warn —— 常规的「成功 / 非 0 退出 / 执行异常 / fail-closed 拒绝」均**零 app.log**
 * （用户会话 `session_mvl0d0a3d6e2e9a764` 实证"bash 构建命令被安全策略拦截"无迹可查）。
 * 修复：各分支统一补 `bash: exec_ok` / `bash: exec_failed` / `bash: exec_error` /
 * `bash: exec_refused`（字段同构：commandPreview + mode/exitCode + durationMs）。
 *
 * 覆盖：
 * - 开关关闭 ⇒ 普通执行成功 ⇒ info `bash: exec_ok`（mode=plain）
 * - 开启 + 能力可用 ⇒ Landlock 域内成功 ⇒ info `bash: exec_ok`（mode=landlock）
 * - 开启但平台不支持 ⇒ fail-closed 拒绝 ⇒ warn `bash: exec_refused`（且不调用普通执行器）
 * - Landlock 域内非 0 退出 ⇒ warn `bash: exec_failed`（exitCode + stderr 截断）
 * - 负向对照：普通执行成功 ⇒ 零条 failed/refused/error（不误报）
 *
 * 日志断言方式与 `bashGateBlockLogging.test.ts` 同构：spy `getLogger('tools:bash:landlock-exec')`
 * 的 info/warn（同一 logger 单例），按消息 key 过滤。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { getLogger } from '@modules/monitoring';
import {
  execBashCommand,
  type LandlockHelperResult,
  type LandlockHelperRunner,
  type PlainRunner,
} from '../../src/tools/bash/bashLandlockExec.js';
import { DEFAULT_LANDLOCK_CONFIG } from '../../src/sandbox';
import type { LandlockCapability, LandlockConfig } from '../../src/sandbox';

/** 造配置：默认项 + 覆盖（与 bashLandlockExec.test.ts 同构） */
function cfg(over: Partial<LandlockConfig> = {}): LandlockConfig {
  return { ...DEFAULT_LANDLOCK_CONFIG, ...over };
}

const AVAILABLE: LandlockCapability = { available: true, abi: 3 };

function plainSpy(
  result: { stdout: string; stderr: string } = {
    stdout: 'plain-out',
    stderr: '',
  }
): { runPlain: PlainRunner } {
  const runPlain: PlainRunner = async (_command, _options) => result;
  return { runPlain };
}

function helperOk(
  over: Partial<LandlockHelperResult> = {}
): LandlockHelperResult {
  return {
    stdout: 'll-out',
    stderr: '',
    exitCode: 0,
    timedOut: false,
    ...over,
  };
}

/** execBashCommand 使用的 logger 单例（与 bashLandlockExec.ts 同一字面量 ⇒ 同一实例） */
const bashExecLogger = getLogger('tools:bash:landlock-exec');

const OK_KEY = 'bash: exec_ok';
const FAILED_KEY = 'bash: exec_failed';
const ERROR_KEY = 'bash: exec_error';
const REFUSED_KEY = 'bash: exec_refused';

type LogCall = [string, Record<string, unknown>];

let infoSpy: ReturnType<typeof spyOn> | undefined;
let warnSpy: ReturnType<typeof spyOn> | undefined;

function callsByKey(
  key: string,
  spy: typeof infoSpy | typeof warnSpy
): LogCall[] {
  const calls = (spy?.mock.calls ?? []) as LogCall[];
  return calls.filter((c) => c[0] === key);
}

afterEach(() => {
  infoSpy?.mockRestore();
  warnSpy?.mockRestore();
  infoSpy = undefined;
  warnSpy = undefined;
});

describe('execBashCommand 成败/拒绝分支可观测性（B 类缺口 ③）', () => {
  it('开关关闭 ⇒ 普通执行成功 ⇒ info exec_ok（mode=plain + durationMs）', async () => {
    const { runPlain } = plainSpy();
    infoSpy = spyOn(bashExecLogger, 'info');
    warnSpy = spyOn(bashExecLogger, 'warn');
    const out = await execBashCommand({
      command: 'echo hi',
      env: {},
      timeoutMs: 1000,
      maxBufferChars: 1024,
      deps: { config: cfg(), evalForced: false, runPlain },
    });
    expect(out.stdout).toBe('plain-out');

    const ok = callsByKey(OK_KEY, infoSpy);
    expect(ok.length).toBe(1);
    expect(ok[0][1]).toMatchObject({
      commandPreview: 'echo hi',
      mode: 'plain',
      exitCode: 0,
    });
    expect(typeof ok[0][1].durationMs).toBe('number');
    expect(callsByKey(FAILED_KEY, warnSpy).length).toBe(0);
    expect(callsByKey(REFUSED_KEY, warnSpy).length).toBe(0);
    expect(callsByKey(ERROR_KEY, infoSpy).length).toBe(0);
  });

  it('开启 + 能力可用 ⇒ Landlock 域内成功 ⇒ info exec_ok（mode=landlock）', async () => {
    const runHelper: LandlockHelperRunner = async () => helperOk();
    infoSpy = spyOn(bashExecLogger, 'info');
    const out = await execBashCommand({
      command: 'ls -la',
      env: {},
      timeoutMs: 1000,
      maxBufferChars: 1024,
      deps: {
        config: cfg({ enabled: true, bashEnabled: true }),
        evalForced: false,
        platform: 'linux',
        detect: async () => AVAILABLE,
        runHelper,
      },
    });
    expect(out.stdout).toBe('ll-out');

    const ok = callsByKey(OK_KEY, infoSpy);
    expect(ok.length).toBe(1);
    expect(ok[0][1]).toMatchObject({
      commandPreview: 'ls -la',
      mode: 'landlock',
      exitCode: 0,
    });
    expect(typeof ok[0][1].durationMs).toBe('number');
  });

  it('开启但平台不支持 ⇒ fail-closed 拒绝 ⇒ warn exec_refused（且不调用普通执行器）', async () => {
    warnSpy = spyOn(bashExecLogger, 'warn');
    await expect(
      execBashCommand({
        command: 'rm -rf /tmp/x',
        env: {},
        timeoutMs: 1000,
        maxBufferChars: 1024,
        deps: {
          config: cfg({ enabled: true, bashEnabled: true }),
          evalForced: false,
          platform: 'win32',
        },
      })
    ).rejects.toThrow();

    const refused = callsByKey(REFUSED_KEY, warnSpy);
    expect(refused.length).toBe(1);
    expect(refused[0][1]).toMatchObject({
      commandPreview: 'rm -rf /tmp/x',
      reason: 'platform-unsupported',
    });
    expect(String(refused[0][1].message ?? '')).toContain('win32');
  });

  it('Landlock 域内非 0 退出 ⇒ warn exec_failed（exitCode + stderr 截断）', async () => {
    const runHelper: LandlockHelperRunner = async () =>
      helperOk({ exitCode: 2, stderr: 'boom: something failed' });
    warnSpy = spyOn(bashExecLogger, 'warn');
    await expect(
      execBashCommand({
        command: 'false',
        env: {},
        timeoutMs: 1000,
        maxBufferChars: 1024,
        deps: {
          config: cfg({ enabled: true, bashEnabled: true }),
          evalForced: false,
          platform: 'linux',
          detect: async () => AVAILABLE,
          runHelper,
        },
      })
    ).rejects.toThrow(/Command failed/);

    const failed = callsByKey(FAILED_KEY, warnSpy);
    expect(failed.length).toBe(1);
    expect(failed[0][1]).toMatchObject({
      commandPreview: 'false',
      exitCode: 2,
    });
    expect(String(failed[0][1].stderr ?? '')).toContain('boom');
    expect(typeof failed[0][1].durationMs).toBe('number');
  });

  it('负向对照：普通执行成功 ⇒ 零条 failed/refused/error（不误报）', async () => {
    const { runPlain } = plainSpy();
    infoSpy = spyOn(bashExecLogger, 'info');
    warnSpy = spyOn(bashExecLogger, 'warn');
    await execBashCommand({
      command: 'echo clean',
      env: {},
      timeoutMs: 1000,
      maxBufferChars: 1024,
      deps: { config: cfg(), evalForced: false, runPlain },
    });
    expect(callsByKey(FAILED_KEY, warnSpy).length).toBe(0);
    expect(callsByKey(REFUSED_KEY, warnSpy).length).toBe(0);
    expect(callsByKey(ERROR_KEY, warnSpy).length).toBe(0);
  });
});
