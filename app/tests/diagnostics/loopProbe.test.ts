/**
 * 事件循环阻塞探针 · P1（2026-09-22）
 *
 * 锁定 `loopProbeCore` 的**纯函数**契约（方案 §5 验证要求）：
 *  - 假 lag 序列 ⇒ 第一次 `arm`、第二次 `dump`、用尽份数后 `closed`；
 *  - 阈值以下不参与状态迁移（不误触发）；
 *  - arm 超时 ⇒ 丢弃并回待命（保证 profiler 不长期在场）；
 *  - `off` 档位零动作；
 *  - profile 摘要的 self-time 口径正确（含 GC 占比）。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import {
  DEFAULT_PROBE_CONFIG,
  decideOnArmTimeout,
  decideOnLag,
  initProbeState,
  resolveProbeMode,
  summarizeProfile,
  type CpuProfileLike,
} from '../../src/diagnostics/loopProbe/loopProbeCore';
import {
  LoopProbe,
  resetLoopProbeForTest,
} from '../../src/diagnostics/loopProbe/loopProbe';
import {
  enterPhase,
  exitPhase,
  isPhaseStackEnabled,
  setPhaseStackEnabled,
} from '../../src/diagnostics/loopProbe/phaseStack';

// 状态机用例显式固定 maxDumps=3（与默认值解耦，默认值调整不影响本文件语义）
const CFG = { ...DEFAULT_PROBE_CONFIG, lagThresholdMs: 3000, maxDumps: 3 };

afterEach(async () => {
  await resetLoopProbeForTest();
  delete process.env['LOOP_PROBE'];
  // 复位被 off 档位关闭的全局阶段栈开关（其他用例仍需要）
  setPhaseStackEnabled(true);
});

describe('探针档位解析', () => {
  test('未设置 ⇒ 默认 p1（D-P6 ①：该问题已持续 11 天）', () => {
    expect(resolveProbeMode({})).toBe('p1');
  });

  test('显式 off ⇒ off；其它值一律 p1', () => {
    expect(resolveProbeMode({ LOOP_PROBE: 'off' })).toBe('off');
    expect(resolveProbeMode({ LOOP_PROBE: ' OFF ' })).toBe('off');
    expect(resolveProbeMode({ LOOP_PROBE: 'p1' })).toBe('p1');
    expect(resolveProbeMode({ LOOP_PROBE: 'whatever' })).toBe('p1');
  });
});

describe('默认配置：受"探针自身开销"实测约束', () => {
  test('待命窗口 ≤ 60s（profiler 常开实测占 ~5–7% 单核，不可长时间 armed）', () => {
    // 2026-09-22 实测：armed 态 5ms=7.34% / 10ms=5.00% / 20ms=5.86% / 50ms=7.10%
    // ⇒ 与采样间隔无单调关系，属 inspector 固定成本 ⇒ 只能靠**缩短 armed 时长**控制总开销。
    // 本断言防止默认值被无意改回长窗口（如 20 分钟 ⇒ 白白消耗 7% CPU 达 20 分钟）。
    expect(DEFAULT_PROBE_CONFIG.armTimeoutMs).toBeLessThanOrEqual(60_000);
  });

  test('采样间隔 ≥ 10ms（更细不划算：开销与间隔无关，40s 阻塞仍有约 4000 点）', () => {
    expect(DEFAULT_PROBE_CONFIG.samplingIntervalUs).toBeGreaterThanOrEqual(
      10_000
    );
  });

  test('单进程份数 ≥ 5（取证验收要求"≥5 次一致归因"可单进程满足）', () => {
    expect(DEFAULT_PROBE_CONFIG.maxDumps).toBeGreaterThanOrEqual(5);
  });
});

describe('守株待兔状态机：decideOnLag', () => {
  test('阈值以下不迁移（正常抖动不误触发）', () => {
    const s0 = initProbeState();
    const d = decideOnLag(s0, 2500, 1000, CFG);
    expect(d.action).toBe('none');
    expect(d.state).toEqual(s0);
  });

  test('假 lag 序列：第一次 arm、第二次 dump（第一次不转储）', () => {
    const s0 = initProbeState();
    const first = decideOnLag(s0, 40_000, 1000, CFG);
    expect(first.action).toBe('arm');
    expect(first.state.phase).toBe('armed');
    expect(first.state.dumps).toBe(0); // 关键：第一次**不**转储
    expect(first.state.armLagMs).toBe(40_000);

    const second = decideOnLag(first.state, 38_000, 2000, CFG);
    expect(second.action).toBe('dump');
    expect(second.state.dumps).toBe(1);
    expect(second.state.phase).toBe('idle');
  });

  test('用尽 maxDumps 份数 ⇒ closed，此后不再动作', () => {
    let s = initProbeState();
    for (let i = 0; i < 3; i++) {
      s = decideOnLag(s, 30_000, i * 100, CFG).state; // arm
      const d = decideOnLag(s, 30_000, i * 100 + 1, CFG);
      expect(d.action).toBe('dump');
      s = d.state;
    }
    expect(s.dumps).toBe(3);
    expect(s.phase).toBe('closed');
    expect(decideOnLag(s, 30_000, 9999, CFG).action).toBe('none');
  });
});

describe('守株待兔状态机：decideOnArmTimeout', () => {
  test('未 armed ⇒ 不动作', () => {
    expect(decideOnArmTimeout(initProbeState(), 10 ** 9, CFG).action).toBe(
      'none'
    );
  });

  test('未到超时 ⇒ 不动作；到超时 ⇒ 丢弃并回待命', () => {
    const armed = decideOnLag(initProbeState(), 30_000, 1_000_000, CFG).state;
    // 阈值取自配置（不硬编码，避免默认值调整后本用例失效）
    expect(
      decideOnArmTimeout(
        armed,
        1_000_000 + Math.floor(CFG.armTimeoutMs / 2),
        CFG
      ).action
    ).toBe('none');

    const timedOut = decideOnArmTimeout(
      armed,
      1_000_000 + CFG.armTimeoutMs,
      CFG
    );
    expect(timedOut.action).toBe('discard');
    expect(timedOut.state.phase).toBe('idle');
    expect(timedOut.state.armedAt).toBe(0);
  });
});

describe('阻塞事件（P2 阶段级归因，不依赖 profiler）', () => {
  test('每一次真实阻塞都记录事件：即使 profile 未命中（已 arm、尚未 dump）', async () => {
    const probe = new LoopProbe(CFG);
    expect(probe.getIncidentCount()).toBe(0);

    probe.onLag(40_000); // 第 1 次阻塞 ⇒ 只 arm，不 dump
    expect(probe.getState().phase).toBe('armed');
    expect(probe.getState().dumps).toBe(0); // 关键：profile 尚未产生
    // 但阶段级归因**已经**记录 ⇒ 稀疏期（profile 永远等不到下一次阻塞）仍有归因
    expect(probe.getIncidentCount()).toBe(1);
    expect(probe.getLastIncident()?.lagMs).toBe(40_000);

    await probe.reset();
  });

  test('事件携带与 lag 匹配的疑似阶段（阻塞源首选判定）', async () => {
    // 该用例把阈值降到 2000ms：阶段自记 1.1s ≥ 门槛 max(1000, lag/2=1000) ⇒ 应判为疑似
    const probe = new LoopProbe({ ...CFG, lagThresholdMs: 2000 });
    enterPhase('fts:saveToDisk');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    exitPhase('fts:saveToDisk');

    probe.onLag(2000);
    const incident = probe.getLastIncident();
    expect(incident?.suspects).toEqual([
      { name: 'fts:saveToDisk', durationMs: expect.any(Number) },
    ]);
    expect(incident?.memRssMb).toBeGreaterThan(0);
    // P4 交叉判据（2026-09-22）：libuv 在飞请求/句柄数必须被采集（-1 = 运行时不可用，仍属已采集）
    expect(typeof incident?.activeRequests).toBe('number');
    expect(typeof incident?.activeHandles).toBe('number');

    await probe.reset();
  });

  test('阈值以下的正常抖动不记录（避免噪声污染归因）', async () => {
    const probe = new LoopProbe(CFG);
    probe.onLag(1500); // < lagThresholdMs(3000)
    expect(probe.getIncidentCount()).toBe(0);
    expect(probe.getLastIncident()).toBeNull();

    await probe.reset();
  });

  test('off 档位不记录任何事件（关闭后零行为差异）', async () => {
    process.env['LOOP_PROBE'] = 'off';
    const probe = new LoopProbe(CFG);
    probe.onLag(40_000);
    expect(probe.getIncidentCount()).toBe(0);

    await probe.reset();
  });
});

describe('off 档位：零动作（关闭后行为与今日一致）', () => {
  test('mode=off ⇒ onLag 不迁移状态，且阶段栈整体关闭', async () => {
    process.env['LOOP_PROBE'] = 'off';
    const probe = new LoopProbe(CFG);
    expect(probe.getMode()).toBe('off');

    probe.onLag(40_000);
    expect(probe.getState()).toEqual(initProbeState());
    expect(isPhaseStackEnabled()).toBe(false);

    await probe.reset();
  });
});

describe('profile 摘要（self time 口径）', () => {
  test('按采样点累加自身耗时，并聚合文件名与 GC 占比', () => {
    const profile: CpuProfileLike = {
      nodes: [
        {
          id: 1,
          callFrame: { functionName: 'hotFn', url: 'a.ts', lineNumber: 9 },
        },
        {
          id: 2,
          callFrame: { functionName: 'coldFn', url: 'b.ts', lineNumber: 0 },
        },
        {
          id: 3,
          callFrame: { functionName: '(garbage collector)', url: '' },
        },
      ],
      // 三次采样：3000µs + 1000µs + 1000µs = 5ms
      samples: [1, 1, 2, 3],
      timeDeltas: [3000, 1000, 1000, 1000],
    };
    const s = summarizeProfile(profile);

    expect(s.sampleCount).toBe(4);
    expect(s.totalMs).toBe(6);
    expect(s.top[0].fn).toBe('hotFn');
    expect(s.top[0].ms).toBe(4);
    expect(s.top[0].line).toBe(10); // lineNumber 0-based ⇒ +1
    expect(s.gcPct).toBeCloseTo(16.7, 1);
    expect(s.topFiles[0].file).toBe('a.ts');
  });

  test('空 samples ⇒ 全零，不抛错', () => {
    const s = summarizeProfile({ nodes: [], samples: [], timeDeltas: [] });
    expect(s.totalMs).toBe(0);
    expect(s.top).toEqual([]);
    expect(s.gcPct).toBe(0);
  });
});
