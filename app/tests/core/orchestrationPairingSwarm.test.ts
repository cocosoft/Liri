/**
 * SWARM 批次键的**耗时配对**回归（2026-10-21）
 *
 * 修复前：`SWARM_DISPATCH` 载荷无稳定标识 ⇒ 单桶 FIFO ⇒ 同会话并发/未闭合批次
 * 跨批次错配（与 `PARALLEL_START` 的 H-2-R11 同源）。
 *
 * 锁三件事：
 *  ① 两个批次交错（A dispatch → B dispatch → B complete → A complete）时，各自配对到自己的 dispatch；
 *  ② 键不匹配且多桶时**不退化**（宁可放弃样本，也不跨批次错配）；
 *  ③ 旧事件缺键 ⇒ 键为 `''`，仍走退化单桶（向后兼容）。
 */
import { describe, it, expect } from 'bun:test';

import { OrchestrationEventPairer } from '@modules/core/events/orchestrationPairing';
import { OrchestrationEventType } from '../../src/types/orchestrationEvents';

const DISPATCH = OrchestrationEventType.SWARM_DISPATCH;
const COMPLETE = OrchestrationEventType.SWARM_COMPLETE;

describe('SWARM 批次键：耗时配对', () => {
  it('交错批次各自配对（B 不会被配到 A 的 dispatch）', () => {
    const pairer = new OrchestrationEventPairer();
    pairer.push(DISPATCH, { swarmSessionId: 'A' }, 1000);
    pairer.push(DISPATCH, { swarmSessionId: 'B' }, 2000);

    // B 先完成：只应配到 2000 的 dispatch（500ms），而不是 1000 的（1500ms）
    expect(pairer.push(COMPLETE, { swarmSessionId: 'B' }, 2500)).toEqual({
      startEvent: DISPATCH,
      latencyMs: 500,
    });
    expect(pairer.push(COMPLETE, { swarmSessionId: 'A' }, 4000)).toEqual({
      startEvent: DISPATCH,
      latencyMs: 3000,
    });
  });

  it('终止事件缺键且存在多个待配对桶 ⇒ 不退化配对（不跨批次错配）', () => {
    const pairer = new OrchestrationEventPairer();
    pairer.push(DISPATCH, { swarmSessionId: 'A' }, 1000);
    pairer.push(DISPATCH, { swarmSessionId: 'B' }, 2000);
    // 终止载荷无键 ⇒ 键为 '' ⇒ 与两个桶都不匹配，且多桶 ⇒ 放弃
    expect(pairer.push(COMPLETE, {}, 3000)).toBeNull();
  });

  it('旧事件缺键（单桶）⇒ 仍按退化单桶配对（向后兼容）', () => {
    const pairer = new OrchestrationEventPairer();
    pairer.push(DISPATCH, {}, 1000);
    expect(pairer.push(COMPLETE, {}, 1500)).toEqual({
      startEvent: DISPATCH,
      latencyMs: 500,
    });
  });
});
