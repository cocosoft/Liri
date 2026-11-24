/**
 * 2026-11-25：伙伴交互动作边界归一。
 *
 * 回归点：输入框把用户原文当作 `action` 提交（`BuddyPage.tsx:312` / `LiriPage.tsx:574`），
 * 旧实现按未知 key 取 `RESPONSES[action]` ⇒ `pickRandom(undefined)` 抛错（交互 500）。
 * 现非动作词汇一律按 `talk` 处理，合法动作原样保留。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  InteractionManager,
  normalizeInteractionAction,
  rollWithSeed,
} from '@modules/buddy';
import type { Companion } from '@modules/buddy';
import { setBuddyMemoryPort } from '@modules/buddy/memoryPort';

const makeCompanion = (): Companion => {
  const { bones } = rollWithSeed('interaction-action');
  return {
    ...bones,
    name: 'Action',
    personality: 'calm',
    hatchedAt: Date.now(),
  };
};

describe('伙伴交互动作边界归一', () => {
  afterEach(() => {
    setBuddyMemoryPort(null);
  });

  it('合法动作原样返回', () => {
    expect(normalizeInteractionAction('pet')).toBe('pet');
    expect(normalizeInteractionAction('compliment')).toBe('compliment');
  });

  it('输入框原文（非动作词汇）归一为 talk', () => {
    expect(normalizeInteractionAction('你好，今天怎么样')).toBe('talk');
    expect(normalizeInteractionAction('toString')).toBe('talk');
  });

  it('未知 action 不再抛错，按 talk 落库', async () => {
    const manager = new InteractionManager();
    const result = await manager.execute(makeCompanion(), '你好，今天怎么样');
    expect(result.action).toBe('talk');
    expect(result.response.length).toBeGreaterThan(0);
  });
});
