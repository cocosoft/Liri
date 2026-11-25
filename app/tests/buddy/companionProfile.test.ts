/**
 * 2026-11-25：伙伴资料（类型 / 名字 / 性格）校验规则。
 *
 * 用户可改：name / personality / species；稀有度与属性仍由 userId 派生（不在此校验范围）。
 */
import { describe, expect, it } from 'bun:test';
import { normalizeCompanionProfilePatch } from '@modules/buddy';

describe('normalizeCompanionProfilePatch', () => {
  it('合法补丁：trim 后保留，只包含提供的字段', () => {
    const result = normalizeCompanionProfilePatch({
      name: '  小兔  ',
      personality: ' 温柔 ',
      species: 'rabbit',
    });
    expect(result).toEqual({
      ok: true,
      value: { name: '小兔', personality: '温柔', species: 'rabbit' },
    });
  });

  it('名字为空 / 超长 ⇒ INVALID_NAME', () => {
    expect(normalizeCompanionProfilePatch({ name: '   ' })).toEqual({
      ok: false,
      error: 'INVALID_NAME',
    });
    expect(normalizeCompanionProfilePatch({ name: 'x'.repeat(25) })).toEqual({
      ok: false,
      error: 'INVALID_NAME',
    });
  });

  it('性格超长 ⇒ INVALID_PERSONALITY（允许空串清空）', () => {
    expect(
      normalizeCompanionProfilePatch({ personality: 'x'.repeat(121) })
    ).toEqual({ ok: false, error: 'INVALID_PERSONALITY' });
    expect(normalizeCompanionProfilePatch({ personality: '' })).toEqual({
      ok: true,
      value: { personality: '' },
    });
  });

  it('未登记物种 ⇒ INVALID_SPECIES', () => {
    expect(normalizeCompanionProfilePatch({ species: 'dinosaur' })).toEqual({
      ok: false,
      error: 'INVALID_SPECIES',
    });
  });
});
