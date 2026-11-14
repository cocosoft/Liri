// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G2（2026-11-13）：`decideLoopFallback` 的**负向对照基线**。
 *
 * 依据：`dev_docs/20261112/T2-T3-20261112.md` §T2.5 —— 共 10 条"什么情况**不该**回退"，
 * 外加开关默认关与两类正向命中。该能力最大的风险是**误触发**（不是"不生效"），
 * 因此本文件是将来接线时的回归基线：任何一条变红都说明回退开始越权。
 *
 * 注：函数的判定输入只有"终止归因 + 三个守卫"，所以 #1/#2/#5/#6/#7/#10 的差别体现在
 * 传入的 `terminationReason` 上（这些场景在仓内**不会**产出 `io_loop` / `no_tool_call`）。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import { FEATURE_FLAGS, feature } from '@openliri/kernel';
import type { TerminationReason } from '@modules/query/ReActLoop';
import {
  decideLoopFallback,
  MAX_LOOP_FALLBACKS_PER_TASK,
  type LoopFallbackInput,
} from '@modules/query/taor/modelFallback';

/** 命中态基线：开关开 + `io_loop` + 无任何守卫 */
const ENABLED_BASE: LoopFallbackInput = {
  enabled: true,
  terminationReason: 'io_loop',
  steeringInjectedThisTurn: false,
  fallbackCountInTask: 0,
  userPinnedModel: false,
};

function decide(patch: Partial<LoopFallbackInput> = {}) {
  return decideLoopFallback({ ...ENABLED_BASE, ...patch });
}

/**
 * 非触发归因的**穷举表**（用 `Record` 而非数组 ⇒ 新增 `TerminationReason` 时编译期报错，
 * 强制有人回答"新归因是否该触发回退"）。
 */
type NonTriggerReason = Exclude<TerminationReason, 'io_loop' | 'no_tool_call'>;

const NON_TRIGGER_REASONS: Record<NonTriggerReason, true> = {
  completed: true,
  error: true,
  reasoning_error: true,
  no_progress: true,
  exploration_fatigue: true,
  circuit_breaker: true,
  environment_blocked: true,
  internal_error: true,
  aborted: true,
  system_aborted: true,
  max_turns: true,
  budget_exhausted: true,
  verifier_escalate: true,
  diminishing_returns: true,
  loop_detected: true,
  timeout: true,
  compaction_failed: true,
  awaiting_approval: true,
  output_budget_exhausted: true,
};

describe('T2.5 负向对照（10 条：什么情况不该回退）', () => {
  it('#1 同一工具、不同参数连续调用（正常重试）⇒ none：不进 io_loop 属正常探索', () => {
    expect(decide({ terminationReason: 'completed' })).toEqual({
      action: 'none',
    });
  });

  it('#2 工具执行慢导致 timeout ⇒ none：换模型/反思不改变耗时', () => {
    expect(decide({ terminationReason: 'timeout' })).toEqual({
      action: 'none',
    });
  });

  it('#3 已注入 steering 警告后模型改道 ⇒ none：warnings 分支不置 stopReason', () => {
    expect(
      decide({ terminationReason: 'completed', steeringInjectedThisTurn: true })
    ).toEqual({ action: 'none' });
  });

  it('#3-补 即便归因命中，本回合已注入软纠偏也让路 ⇒ none（防御性守卫）', () => {
    expect(
      decide({ terminationReason: 'io_loop', steeringInjectedThisTurn: true })
    ).toEqual({ action: 'none' });
    expect(
      decide({
        terminationReason: 'no_tool_call',
        steeringInjectedThisTurn: true,
      })
    ).toEqual({ action: 'none' });
  });

  it('#4 no_progress 已注入软纠偏、让路一轮 ⇒ none：软纠偏优先于硬熔断', () => {
    expect(
      decide({
        terminationReason: 'no_progress',
        steeringInjectedThisTurn: true,
      })
    ).toEqual({ action: 'none' });
  });

  it('#5 environment_blocked（权限拒绝/安全拦截/能力未就绪）⇒ none：重试不可能改变结果', () => {
    expect(decide({ terminationReason: 'environment_blocked' })).toEqual({
      action: 'none',
    });
  });

  it('#6 awaiting_approval（等批准）⇒ none：既非完成也非失败', () => {
    expect(decide({ terminationReason: 'awaiting_approval' })).toEqual({
      action: 'none',
    });
  });

  it('#7 用户/系统主动 aborted ⇒ none：人为意图不得被改写为"换模型重试"', () => {
    expect(decide({ terminationReason: 'aborted' })).toEqual({
      action: 'none',
    });
    expect(decide({ terminationReason: 'system_aborted' })).toEqual({
      action: 'none',
    });
  });

  it('#8 同一任务已回退过 1 次 ⇒ none：每任务上限 1 次，防"换模型死循环"', () => {
    expect(MAX_LOOP_FALLBACKS_PER_TASK).toBe(1);
    expect(
      decide({
        terminationReason: 'io_loop',
        fallbackCountInTask: MAX_LOOP_FALLBACKS_PER_TASK,
      })
    ).toEqual({ action: 'none' });
    expect(
      decide({ terminationReason: 'no_tool_call', fallbackCountInTask: 2 })
    ).toEqual({ action: 'none' });
  });

  it('#9 会话显式指定模型 ⇒ none：尊重显式选择，不越权改写用户路由配置', () => {
    expect(
      decide({ terminationReason: 'io_loop', userPinnedModel: true })
    ).toEqual({ action: 'none' });
  });

  it('#10 工具部分成功（allSucceeded=false 但无阻断）⇒ none：blocked 为空即未置 io_loop', () => {
    expect(decide({ terminationReason: 'completed' })).toEqual({
      action: 'none',
    });
  });

  it('穷举：除 io_loop / no_tool_call 外的全部终止归因一律 none', () => {
    for (const reason of Object.keys(
      NON_TRIGGER_REASONS
    ) as NonTriggerReason[]) {
      expect(decide({ terminationReason: reason })).toEqual({ action: 'none' });
    }
  });
});

describe('正向命中（A 档 reflect）', () => {
  it('io_loop + 无守卫 ⇒ reflect，且 reason 如实回带', () => {
    expect(decide({ terminationReason: 'io_loop' })).toEqual({
      action: 'reflect',
      reason: 'io_loop',
    });
  });

  it('no_tool_call + 无守卫 ⇒ reflect', () => {
    expect(decide({ terminationReason: 'no_tool_call' })).toEqual({
      action: 'reflect',
      reason: 'no_tool_call',
    });
  });
});

describe('开关 MODEL_FALLBACK_ON_LOOP（默认关、未接线）', () => {
  afterEach(() => {
    delete process.env['FEATURE_MODEL_FALLBACK_ON_LOOP'];
  });

  it('声明默认值为 false', () => {
    expect(FEATURE_FLAGS.MODEL_FALLBACK_ON_LOOP).toBe(false);
  });

  it('关 ⇒ 即便归因命中、无任何守卫，也恒为 none（零行为变更）', () => {
    expect(decide({ enabled: false, terminationReason: 'io_loop' })).toEqual({
      action: 'none',
    });
    expect(
      decide({ enabled: false, terminationReason: 'no_tool_call' })
    ).toEqual({ action: 'none' });
  });

  it('`FEATURE_MODEL_FALLBACK_ON_LOOP=true` 可灰度开启', () => {
    process.env['FEATURE_MODEL_FALLBACK_ON_LOOP'] = 'true';
    expect(feature('MODEL_FALLBACK_ON_LOOP')).toBe(true);
  });
});
