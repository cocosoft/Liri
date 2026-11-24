/**
 * P2-1（2026-11-25）：伙伴读记忆端口 —— 未注入不伪造、注入后 talk 引用真实记忆、
 * 非 talk 动作不读取记忆。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { InteractionManager, rollWithSeed } from '@modules/buddy';
import type { Companion } from '@modules/buddy';
import { setBuddyMemoryPort } from '@modules/buddy/memoryPort';

const makeCompanion = (): Companion => {
  const { bones } = rollWithSeed('p2-1-buddy');
  return { ...bones, name: 'P21', personality: 'calm', hatchedAt: Date.now() };
};

describe('伙伴读记忆端口（P2-1）', () => {
  afterEach(() => {
    setBuddyMemoryPort(null);
  });

  it('未注入端口 ⇒ talk 不追加回忆（不伪造记忆）', async () => {
    const result = await new InteractionManager().execute(
      makeCompanion(),
      'talk'
    );
    expect(result.response.includes('It recalls')).toBe(false);
  });

  it('注入端口 ⇒ talk 引用最近一条真实记忆', async () => {
    setBuddyMemoryPort({
      getRecentMemories: async (limit) => {
        expect(limit).toBe(1);
        return [
          {
            name: '偏好',
            description: '用户偏好 TypeScript',
            updatedAt: Date.now(),
          },
        ];
      },
    });

    const result = await new InteractionManager().execute(
      makeCompanion(),
      'talk'
    );
    expect(result.response).toContain('用户偏好 TypeScript');
  });

  it('非 talk 动作不读取记忆', async () => {
    let called = 0;
    setBuddyMemoryPort({
      getRecentMemories: async () => {
        called++;
        return [];
      },
    });

    await new InteractionManager().execute(makeCompanion(), 'pet');
    expect(called).toBe(0);
  });
});
