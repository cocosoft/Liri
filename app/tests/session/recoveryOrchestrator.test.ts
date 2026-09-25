/**
 * P2-7（2026-09-25）：恢复编排层单测。
 *
 * 覆盖 spec §7「编排行为」：固定顺序 / 逐步隔离降级 / 报告结构 / 幂等 / 失败项记录。
 *
 * **纯端口注入**（无 `mock.module`）—— 上轮教训：`mock.module` 是进程级替换、会跨文件泄漏。
 */
import { describe, test, expect } from 'bun:test';
import {
  RecoveryOrchestrator,
  type RecoveryPorts,
} from '../../src/session/recovery/RecoveryOrchestrator';
import type { CrashRecoveryResult } from '../../src/session/recovery/CrashRecoveryManager';

function crashResult(): CrashRecoveryResult {
  return {
    totalChecked: 3,
    recoveredSessions: 1,
    failedSessions: 1,
    pausedSessions: 1,
    skippedSessions: 0,
    details: [],
  };
}

/** 造端口：每步被调用时把名字压入 `order`，便于断言顺序 */
function makePorts(
  order: string[],
  over?: Partial<RecoveryPorts>
): RecoveryPorts {
  return {
    sessionCrash: {
      recover: async () => {
        order.push('sessionCrash');
        return crashResult();
      },
    },
    sessionState: {
      rebuild: async () => {
        order.push('sessionState');
        return { scopes: 2, ftsDocs: 7, roundCountFixed: 1, failures: [] };
      },
    },
    yieldRecovery: {
      bootstrap: async () => {
        order.push('yieldRecovery');
        return { restored: 4, resumerInstalled: true };
      },
    },
    lineage: {
      describe: () => {
        order.push('lineage');
        return { size: 5 };
      },
    },
    ...over,
  };
}

describe('RecoveryOrchestrator（P2-7 编排层）', () => {
  test('固定顺序：sessionCrash → yieldRecovery → lineage（默认跳过全量重建）', async () => {
    const order: string[] = [];
    const report = await new RecoveryOrchestrator(makePorts(order)).bootstrap();

    expect(order).toEqual(['sessionCrash', 'yieldRecovery', 'lineage']);
    expect(report.failures).toEqual([]);
  });

  test('rebuildState=true ⇒ sessionState 在 sessionCrash 之后、yieldRecovery 之前', async () => {
    const order: string[] = [];
    const report = await new RecoveryOrchestrator(makePorts(order)).bootstrap({
      rebuildState: true,
    });

    expect(order).toEqual([
      'sessionCrash',
      'sessionState',
      'yieldRecovery',
      'lineage',
    ]);
    expect(report.sessionState).toEqual({
      scopes: 2,
      ftsDocs: 7,
      roundCountFixed: 1,
      failures: [],
    });
  });

  test('默认不执行全量重建 ⇒ sessionState 为 null，且 skipped 说明原因（不静默跳过）', async () => {
    const order: string[] = [];
    const report = await new RecoveryOrchestrator(makePorts(order)).bootstrap();

    expect(report.sessionState).toBeNull();
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0].step).toBe('sessionState');
    expect(report.skipped[0].reason).toContain('rebuildState');
  });

  test('任一步抛错 ⇒ 记入 failures 且**后续步骤仍执行**，且 bootstrap 不向调用方抛错', async () => {
    const order: string[] = [];
    const ports = makePorts(order, {
      sessionCrash: {
        recover: async () => {
          order.push('sessionCrash');
          throw new Error('磁盘不可用');
        },
      },
    });

    const report = await new RecoveryOrchestrator(ports).bootstrap();

    // 失败被隔离：后续步骤照常执行
    expect(order).toEqual(['sessionCrash', 'yieldRecovery', 'lineage']);
    expect(report.sessionCrash).toBeNull();
    expect(report.failures).toEqual([
      { step: 'sessionCrash', error: '磁盘不可用' },
    ]);
    // 未失败步骤的结果仍在报告里
    expect(report.yieldRecovery).toEqual({
      restored: 4,
      resumerInstalled: true,
    });
  });

  test('yield 步骤失败同样被隔离（lineage 仍执行）', async () => {
    const order: string[] = [];
    const ports = makePorts(order, {
      yieldRecovery: {
        bootstrap: async () => {
          order.push('yieldRecovery');
          throw new Error('outbox 打不开');
        },
      },
    });

    const report = await new RecoveryOrchestrator(ports).bootstrap();

    expect(order).toEqual(['sessionCrash', 'yieldRecovery', 'lineage']);
    expect(report.yieldRecovery).toBeNull();
    expect(report.failures[0]).toEqual({
      step: 'yieldRecovery',
      error: 'outbox 打不开',
    });
  });

  test('报告如实声明 lineage 不重建（rebuilt=false + 原因）', async () => {
    const report = await new RecoveryOrchestrator(makePorts([])).bootstrap();

    expect(report.lineage.size).toBe(5);
    expect(report.lineage.rebuilt).toBe(false);
    expect(report.lineage.reason).toContain('fail-closed');
  });

  test('sessionCrash 的结构化结果被映射进报告', async () => {
    const report = await new RecoveryOrchestrator(makePorts([])).bootstrap();

    expect(report.sessionCrash).toEqual({
      totalChecked: 3,
      recovered: 1,
      failed: 1,
      paused: 1,
    });
  });

  test('可重复调用（各步骤幂等由实现方保证），报告结构稳定', async () => {
    const order: string[] = [];
    const orchestrator = new RecoveryOrchestrator(makePorts(order));

    const first = await orchestrator.bootstrap();
    const second = await orchestrator.bootstrap();

    expect(first.failures).toEqual([]);
    expect(second.failures).toEqual([]);
    expect(second.lineage).toEqual(first.lineage);
    expect(second.costMs).toBeGreaterThanOrEqual(0);
  });
});
