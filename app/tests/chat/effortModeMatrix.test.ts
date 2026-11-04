/**
 * 详略 × 模式 生效矩阵（方案 §3.5，2026-11-04 P2）
 *
 * 两个旋钮正交，但都会影响**思考预算** ⇒ 必须有一条唯一规则把冲突定死：
 *   - 思考预算 = `max(详略推导值, 模式下限)`：取大不取小；
 *   - 文字密度**只由详略决定**（模式不覆盖）；
 *   - `auto`（详略）与 `auto`（模式）组合 ⇒ 不注入 ⇒ 与接线前逐字一致。
 *
 * 本用例把 4×5 = 20 种组合逐一钉死，防止后续改动让两个旋钮互相抵消。
 */
import { describe, it, expect } from 'bun:test';

import {
  buildReplyEffortPrompt,
  resolveSessionThinkingBudget,
  resolveThinkingForSession,
} from '../../src/chat/replyEffort';
import {
  CHAT_MODES,
  resolveChatModePolicy,
  type ChatMode,
} from '../../src/chat/chatModePolicy';
import { EFFORT_TO_BUDGET } from '../../src/ai/clients/thinking';

const EFFORTS = ['auto', 'low', 'medium', 'high'] as const;
type Effort = (typeof EFFORTS)[number];

/** 详略侧取值（与 `resolveEffortThinkingBudget` 同口径） */
function effortBudget(effort: Effort): number | undefined {
  return effort === 'auto' ? undefined : EFFORT_TO_BUDGET[effort];
}

/** 模式侧下限（唯一事实源 = chatModePolicy） */
function modeFloor(mode: ChatMode): number | undefined {
  return resolveChatModePolicy(mode).thinkingFloor;
}

describe('详略 × 模式：思考预算取较大值（4×5 全矩阵）', () => {
  it('20 种组合都满足 max(详略, 模式下限)，两侧皆无 ⇒ 不注入', () => {
    for (const effort of EFFORTS) {
      for (const mode of CHAT_MODES) {
        const candidates = [effortBudget(effort), modeFloor(mode)].filter(
          (v): v is number => typeof v === 'number'
        );
        const expected =
          candidates.length > 0 ? Math.max(...candidates) : undefined;

        const actual = resolveSessionThinkingBudget({
          effortLevel: effort,
          chatMode: mode,
        });

        expect({ effort, mode, budget: actual }).toEqual({
          effort,
          mode,
          budget: expected,
        });
      }
    }
  });

  it('默认组合（详略 auto + 模式 auto）⇒ 不注入（零行为变更）', () => {
    expect(resolveSessionThinkingBudget({})).toBeUndefined();
    expect(
      resolveSessionThinkingBudget({ effortLevel: 'auto', chatMode: 'auto' })
    ).toBeUndefined();
    expect(resolveThinkingForSession({}, true)).toBeUndefined();
  });

  it('deep 不被详略 low 压低；详略 high 也不被模式调低', () => {
    expect(
      resolveSessionThinkingBudget({ effortLevel: 'low', chatMode: 'deep' })
    ).toBe(EFFORT_TO_BUDGET.medium);
    expect(
      resolveSessionThinkingBudget({ effortLevel: 'high', chatMode: 'deep' })
    ).toBe(EFFORT_TO_BUDGET.high);
    expect(
      resolveSessionThinkingBudget({ effortLevel: 'high', chatMode: 'auto' })
    ).toBe(EFFORT_TO_BUDGET.high);
  });

  it('显式 thinkingBudget 同样参与取大（不被模式下限覆盖，也不覆盖模式下限）', () => {
    expect(
      resolveSessionThinkingBudget({ thinkingBudget: 1_000, chatMode: 'deep' })
    ).toBe(EFFORT_TO_BUDGET.medium);
    expect(
      resolveSessionThinkingBudget({
        thinkingBudget: 64_000,
        chatMode: 'deep',
      })
    ).toBe(64_000);
  });

  it('模型不支持思考 ⇒ 即使 deep 也不注入', () => {
    expect(
      resolveThinkingForSession({ chatMode: 'deep' }, false)
    ).toBeUndefined();
    expect(resolveThinkingForSession({ chatMode: 'deep' }, true)).toEqual({
      type: 'enabled',
      budgetTokens: EFFORT_TO_BUDGET.medium,
    });
  });

  it('脏值 chatMode 按 auto 处理（不因脏值抬高预算）', () => {
    expect(
      resolveSessionThinkingBudget({ effortLevel: 'auto', chatMode: 'DEEP!' })
    ).toBeUndefined();
    // 大小写差异不算脏值
    expect(
      resolveSessionThinkingBudget({ effortLevel: 'auto', chatMode: ' Deep ' })
    ).toBe(EFFORT_TO_BUDGET.medium);
  });
});

describe('详略 × 模式：文字密度只由详略决定', () => {
  it('模式策略不含任何"话术/密度"字段（防止模式偷偷改文字长度）', () => {
    for (const mode of CHAT_MODES) {
      const keys = Object.keys(resolveChatModePolicy(mode));
      expect(
        keys.filter((k) => /prompt|density|verbosity|length/i.test(k))
      ).toEqual([]);
    }
  });

  it('auto 详略 ⇒ 不注入话术（与模式无关）', () => {
    expect(buildReplyEffortPrompt('auto')).toBe('');
    expect(buildReplyEffortPrompt(undefined)).toBe('');
  });
});
