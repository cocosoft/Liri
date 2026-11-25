/**
 * 2026-11-25 形状收口：config 里的伙伴条目（历史 `{name, soul}`）→ `Companion`。
 *
 * 回归点：旧实现 `{...stored, ...bones}` 直接展开 ⇒ `personality`/`hatchedAt`
 * 为 undefined，前端（LiriPage/BuddyPage）展示成 undefined。
 */
import { describe, expect, it } from 'bun:test';
import { buildCompanionFromStored, rollWithSeed } from '@modules/buddy';

const { bones } = rollWithSeed('companion-shape');

describe('config companion → Companion 形状收口', () => {
  it('旧配置（只有 name/soul）⇒ personality 回退 soul，hatchedAt 取 0', () => {
    const companion = buildCompanionFromStored(
      { name: 'PY', soul: '好奇' },
      bones
    );
    expect(companion.name).toBe('PY');
    expect(companion.personality).toBe('好奇');
    expect(companion.hatchedAt).toBe(0);
    expect(companion.species).toBe(bones.species);
    expect(companion.stats).toEqual(bones.stats);
  });

  it('新配置字段优先于历史 soul', () => {
    const companion = buildCompanionFromStored(
      { name: 'PY', soul: '旧个性', personality: '务实', hatchedAt: 123 },
      bones
    );
    expect(companion.personality).toBe('务实');
    expect(companion.hatchedAt).toBe(123);
  });

  it('用户选择的物种覆盖派生骨骼，其余骨骼保持不变', () => {
    const companion = buildCompanionFromStored(
      { name: 'PY', soul: '好奇', species: 'dragon' },
      bones
    );
    expect(companion.species).toBe('dragon');
    expect(companion.rarity).toBe(bones.rarity);
    expect(companion.eye).toBe(bones.eye);
    expect(companion.stats).toEqual(bones.stats);
  });

  it('非法物种忽略，回退派生骨骼', () => {
    const companion = buildCompanionFromStored(
      { name: 'PY', soul: '好奇', species: 'dinosaur' },
      bones
    );
    expect(companion.species).toBe(bones.species);
  });
});
