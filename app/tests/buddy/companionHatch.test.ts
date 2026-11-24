/**
 * 2026-11-25：首条用户消息自动孵化的**命名/个性**规则（纯函数）。
 *
 * 口径（用户拍板）：按确定性骨骼（物种 + 最高属性）生成，不使用模型、可复现。
 */
import { describe, expect, it } from 'bun:test';
import { buildHatchProfile } from '@modules/buddy';
import type { CompanionBones } from '@modules/buddy';

const makeBones = (): CompanionBones => ({
  rarity: 'common',
  species: 'rabbit',
  eye: '·',
  hat: 'none',
  shiny: false,
  stats: { DEBUGGING: 10, PATIENCE: 20, CHAOS: 90, WISDOM: 30, SNARK: 80 },
});

describe('buildHatchProfile：孵化命名与个性', () => {
  it('名字 = 前缀 + 物种中文名，且同输入可复现', () => {
    const a = buildHatchProfile(makeBones(), 'user-1');
    const b = buildHatchProfile(makeBones(), 'user-1');
    expect(a.name).toBe(b.name);
    expect(a.name.endsWith('兔兔')).toBe(true);
  });

  it('个性取最高两项属性', () => {
    expect(buildHatchProfile(makeBones(), 'user-1').personality).toBe(
      '跳脱又毒舌'
    );
  });

  it('不同 userId 不保证同名，但命名始终落在「前缀 + 物种名」形态', () => {
    const name = buildHatchProfile(makeBones(), 'another-user').name;
    expect(/^.{1,2}兔兔$/.test(name)).toBe(true);
  });
});
