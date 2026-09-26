/**
 * G1-A2（2026-09-26，《Liri 优化方案》G 组）：**让 `code_run` 真正接入 `sandbox.landlock` 配置**。
 *
 * 背景（实测的名义契约）：`readLandlockConfig()` 此前**零消费者** ⇒
 * `enabled=false` 拦不住 `code_run` 走 Landlock、`failClosed=true` 也不生效。
 *
 * 锁五件事：
 *  ① **`enabled=false` ⇒ 走跨平台执行器**（配置语义"关闭则完全走本地执行路径"）；
 *  ② **能力不可用**：`failClosed=false` ⇒ 降级（既有行为）；`failClosed=true` ⇒ **拒绝**（不静默降级）；
 *  ③ **非 Linux 不因 `failClosed` 被打死**（跨平台执行器是设计内合法执行器）；
 *  ④ **exit 125 判定只看真实退出码**，不看 `error` 文案（CS02：禁止字符串匹配做状态判断）；
 *  ⑤ **真实子进程验证**：`runRpcChildProcess` 确实把退出码带出（本用例用 `bun -e process.exit(125)` 实测）。
 */
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_LANDLOCK_CONFIG,
  isSandboxInitFailure,
} from '@modules/sandbox';
import {
  decideCodeRunnerLandlock,
  landlockRefusalResult,
  resolveSandboxInitFailure,
} from '../../src/tools/CodeRunner/LinuxSandboxRunner';
import { runRpcChildProcess } from '../../src/tools/CodeRunner/CrossPlatformRunner';
import { CodeRunnerBridge } from '../../src/tools/CodeRunner/RuntimeBridge';
import type { CodeRunResult } from '../../src/tools/CodeRunner/types';
import type { LandlockCapability, LandlockConfig } from '../../src/sandbox';

function cfg(over: Partial<LandlockConfig> = {}): LandlockConfig {
  return { ...DEFAULT_LANDLOCK_CONFIG, ...over };
}

const AVAILABLE: LandlockCapability = { available: true, abi: 3 };
const UNAVAILABLE: LandlockCapability = {
  available: false,
  abi: 0,
  reason: 'helper-missing',
};

function result(over: Partial<CodeRunResult> = {}): CodeRunResult {
  return {
    status: 'failed',
    error: 'code runner exited with code 125',
    logs: ['user log line'],
    toolCalls: [],
    durationMs: 12,
    ...over,
  };
}

describe('G1-A2: 门控判据（开关 / 平台 / 能力）', () => {
  it('enabled=false ⇒ plain（配置语义：完全走本地执行路径）', () => {
    expect(
      decideCodeRunnerLandlock({
        config: cfg({ enabled: false }),
        platform: 'linux',
        capability: AVAILABLE,
      })
    ).toEqual({ mode: 'plain', reason: 'master-off' });
  });

  it('非 Linux ⇒ plain（不因 failClosed 打死 Windows/macOS 的 code_run）', () => {
    expect(
      decideCodeRunnerLandlock({
        config: cfg({ failClosed: true }),
        platform: 'win32',
        capability: null,
      })
    ).toEqual({ mode: 'plain', reason: 'platform-unsupported' });
  });

  it('能力不可用 + failClosed=false ⇒ plain（既有降级路径）', () => {
    expect(
      decideCodeRunnerLandlock({
        config: cfg({ failClosed: false }),
        platform: 'linux',
        capability: UNAVAILABLE,
      })
    ).toEqual({ mode: 'plain', reason: 'capability-unavailable' });
  });

  it('能力不可用 + failClosed=true ⇒ refuse（给出可操作出路）', () => {
    const gate = decideCodeRunnerLandlock({
      config: cfg({ failClosed: true }),
      platform: 'linux',
      capability: UNAVAILABLE,
    });
    expect(gate.mode).toBe('refuse');
    expect(gate.message).toContain('failClosed');
    expect(gate.message).toContain('helper-missing');
    expect(gate.message).toContain('LANDLOCK_RUN_HELPER');
  });

  it('能力可用 ⇒ landlock', () => {
    expect(
      decideCodeRunnerLandlock({
        config: cfg(),
        platform: 'linux',
        capability: AVAILABLE,
      })
    ).toEqual({ mode: 'landlock', reason: 'enabled' });
  });

  it('默认配置：总开关开、failClosed 关（默认路径行为不变）', () => {
    expect(DEFAULT_LANDLOCK_CONFIG.enabled).toBe(true);
    expect(DEFAULT_LANDLOCK_CONFIG.failClosed).toBe(false);
  });
});

describe('G1-A2: exit 125 分流（判据 = 真实退出码）', () => {
  it('非 125 ⇒ 原样返回（keep）', () => {
    for (const exitCode of [0, 1, 7, undefined]) {
      expect(
        resolveSandboxInitFailure({
          config: cfg({ failClosed: true }),
          result: result({ exitCode }),
        })
      ).toEqual({ action: 'keep' });
    }
  });

  it('125 + failClosed=false ⇒ fallback（既有行为）', () => {
    expect(
      resolveSandboxInitFailure({
        config: cfg({ failClosed: false }),
        result: result({ exitCode: 125 }),
      })
    ).toEqual({ action: 'fallback' });
  });

  it('125 + failClosed=true ⇒ refuse（换成 security-rejected，保留原日志）', () => {
    const action = resolveSandboxInitFailure({
      config: cfg({ failClosed: true }),
      result: result({ exitCode: 125 }),
    });

    expect(action.action).toBe('refuse');
    if (action.action !== 'refuse') return;
    expect(action.refusal.status).toBe('security-rejected');
    expect(action.refusal.error).toContain('exit 125');
    expect(action.refusal.error).toContain('failClosed=true');
    expect(action.refusal.error).toContain('landlock-run helper');
    // 原结果信息不丢（便于排障）
    expect(action.refusal.logs).toEqual(['user log line']);
    expect(action.refusal.durationMs).toBe(12);
  });

  it('**只看退出码**：error 文案里没有 "125" 也照样判为初始化失败', () => {
    const action = resolveSandboxInitFailure({
      config: cfg({ failClosed: true }),
      result: result({ exitCode: 125, error: 'sandbox setup rejected' }),
    });
    expect(action.action).toBe('refuse');
  });
});

describe('G1-A2: 拒绝结果形状', () => {
  it('security-rejected + 零耗时 + 空集合（不进迭代）', () => {
    const refusal = landlockRefusalResult('不可用');
    expect(refusal.status).toBe('security-rejected');
    expect(refusal.error).toBe('不可用');
    expect(refusal.logs).toEqual([]);
    expect(refusal.toolCalls).toEqual([]);
    expect(refusal.durationMs).toBe(0);
  });
});

describe('G1-A2: 真实子进程带出退出码（离线实测）', () => {
  /** 构造真实 bridge（本用例子进程不发 RPC 帧，仅用于满足签名） */
  function makeBridge(): CodeRunnerBridge {
    return new CodeRunnerBridge({
      sessionId: 'g1a2-test',
      executeTool: async () => ({ ok: true }),
      readContext: async () => ({ unavailable: true }),
      writeEvent: async () => undefined,
      toolWhitelist: new Set<string>(),
    });
  }

  it('exit 125 被带出且 isSandboxInitFailure 为真', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(125)'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const res = await runRpcChildProcess(child, {
      bridge: makeBridge(),
      timeoutMs: 10_000,
    });

    expect(res.exitCode).toBe(125);
    expect(isSandboxInitFailure(res.exitCode ?? -1)).toBe(true);
    expect(res.status).toBe('failed');
  }, 20_000);

  it('exit 0 也被带出（用于区分"正常退出但没 done()"）', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const res = await runRpcChildProcess(child, {
      bridge: makeBridge(),
      timeoutMs: 10_000,
    });

    expect(res.exitCode).toBe(0);
    expect(isSandboxInitFailure(res.exitCode ?? -1)).toBe(false);
  }, 20_000);
});
