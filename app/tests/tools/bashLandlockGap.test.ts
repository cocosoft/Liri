/**
 * G1-C（2026-09-26，《Liri 优化方案》G 组）：**bash 无内核级约束**的顾问性提示。
 *
 * 锁四件事：
 *  ① **平台门控**：非 Linux 一律不提示（Windows/macOS 上没有可接入的 Landlock）；
 *  ② **能力门控**：LSM 列表无 `landlock` ⇒ 不提示（无能力可接入，提示没有信息量）；
 *  ③ **恰一次**：Linux + 可用 ⇒ 告警**一次**，之后（含再调用）不再告警；已提示时**零 IO**；
 *  ④ **绝不反噬**：告警出口抛错 ⇒ 函数**照常 resolve**（顾问性提示不得让 bash 执行失败），
 *     且原因如实报 `probe-failed` 而**不**混淆成 `landlock-not-enabled`。
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import {
  judgeBashLandlockGap,
  reportBashLandlockGapOnce,
  resetBashLandlockGapReported,
} from '../../src/tools/bash/bashLandlockGap';

/** 造一个记录型告警出口 */
function spyWarn(): {
  calls: Array<{ message: string; meta?: Record<string, unknown> }>;
  warn: (message: string, meta?: Record<string, unknown>) => void;
} {
  const calls: Array<{ message: string; meta?: Record<string, unknown> }> = [];
  return {
    calls,
    warn: (message, meta) => {
      calls.push(meta === undefined ? { message } : { message, meta });
    },
  };
}

beforeEach(() => {
  resetBashLandlockGapReported();
});

describe('G1-C: 纯判据（零 IO，逐分支）', () => {
  it('非 Linux ⇒ 不提示（reason=not-linux）', () => {
    expect(
      judgeBashLandlockGap({
        platform: 'win32',
        lsm: 'capability,landlock,yama',
        alreadyReported: false,
      })
    ).toEqual({ report: false, reason: 'not-linux' });
  });

  it('Linux 但读不到 LSM 列表 ⇒ 不提示（不臆断为可用）', () => {
    expect(
      judgeBashLandlockGap({
        platform: 'linux',
        lsm: null,
        alreadyReported: false,
      })
    ).toEqual({ report: false, reason: 'landlock-not-enabled' });
  });

  it('Linux 但 LSM 不含 landlock ⇒ 不提示', () => {
    expect(
      judgeBashLandlockGap({
        platform: 'linux',
        lsm: 'capability,yama,apparmor',
        alreadyReported: false,
      })
    ).toEqual({ report: false, reason: 'landlock-not-enabled' });
  });

  it('Linux + LSM 含 landlock ⇒ 提示', () => {
    expect(
      judgeBashLandlockGap({
        platform: 'linux',
        lsm: 'capability,landlock,yama\n',
        alreadyReported: false,
      })
    ).toEqual({ report: true, reason: 'landlock-available-but-unused' });
  });

  it('已提示过 ⇒ 不再提示（即便能力可用）', () => {
    expect(
      judgeBashLandlockGap({
        platform: 'linux',
        lsm: 'landlock',
        alreadyReported: true,
      })
    ).toEqual({ report: false, reason: 'already-reported' });
  });
});

describe('G1-C: 探测 + 告警（恰一次）', () => {
  it('Windows ⇒ 不读 LSM、不告警', async () => {
    const spy = spyWarn();
    let readCount = 0;
    const verdict = await reportBashLandlockGapOnce({
      platform: 'win32',
      readLsm: async () => {
        readCount += 1;
        return 'landlock';
      },
      warn: spy.warn,
    });

    expect(verdict).toEqual({ report: false, reason: 'not-linux' });
    expect(readCount).toBe(0);
    expect(spy.calls).toEqual([]);
  });

  it('Linux + 可用 ⇒ 告警一次；第二次调用不再告警且不再读 LSM', async () => {
    const spy = spyWarn();
    let readCount = 0;
    const readLsm = async (): Promise<string | null> => {
      readCount += 1;
      return 'capability,landlock';
    };

    const first = await reportBashLandlockGapOnce({
      platform: 'linux',
      readLsm,
      warn: spy.warn,
    });
    const second = await reportBashLandlockGapOnce({
      platform: 'linux',
      readLsm,
      warn: spy.warn,
    });

    expect(first).toEqual({
      report: true,
      reason: 'landlock-available-but-unused',
    });
    expect(second).toEqual({ report: false, reason: 'already-reported' });
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0].message).toContain('bash 无内核级约束');
    expect(spy.calls[0].meta?.lsmPath).toBe('/sys/kernel/security/lsm');
    // 已提示 ⇒ 后续调用短路（不再产生 IO）
    expect(readCount).toBe(1);
  });

  it('Linux 但未启用 ⇒ 不告警', async () => {
    const spy = spyWarn();
    const verdict = await reportBashLandlockGapOnce({
      platform: 'linux',
      readLsm: async () => 'capability,yama',
      warn: spy.warn,
    });

    expect(verdict).toEqual({ report: false, reason: 'landlock-not-enabled' });
    expect(spy.calls).toEqual([]);
  });
});

describe('G1-C: 绝不反噬执行路径', () => {
  it('告警出口抛错 ⇒ 仍正常返回（原因如实为 probe-failed，不混淆成"未启用"）', async () => {
    const verdict = await reportBashLandlockGapOnce({
      platform: 'linux',
      readLsm: async () => 'landlock',
      warn: () => {
        throw new Error('logger 通道异常（模拟）');
      },
    });

    expect(verdict).toEqual({ report: false, reason: 'probe-failed' });
  });

  it('读 LSM 抛错 ⇒ 仍正常返回，不抛给调用方', async () => {
    const verdict = await reportBashLandlockGapOnce({
      platform: 'linux',
      readLsm: async () => {
        throw new Error('读 LSM 失败（模拟）');
      },
      warn: spyWarn().warn,
    });

    expect(verdict).toEqual({ report: false, reason: 'probe-failed' });
  });
});
