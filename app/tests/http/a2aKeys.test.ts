// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * `parseA2AKeys` —— A2A 密钥清单解析（**多钥 + 可选过期**，2026-10-07）
 *
 * Spec：`.trae/specs/a2a-multikey-rotation.md`。
 *
 * 锁四件事：
 *   ① 格式（逗号分隔；`key` 或 `key@<ISO-8601>`；空白项忽略；`@` 取 `lastIndexOf` ⇒ D5）；
 *   ② **过期语义**：`now >= expiresAt` ⇒ 失效（**边界**用例锁定）；
 *   ③ **fail-closed 的解析面**：格式非法（无钥值 / 时间串不可解析）⇒ **丢弃并上报**，
 *      **绝不**当作"永不过期"；
 *   ④ 返回值是**裸钥**（不含 `@过期` 后缀）。
 */
import { describe, it, expect } from 'bun:test';

import { parseA2AKeys } from '../../src/infrastructure/http/handlers/routes/a2a-routes.js';

const NOW = Date.parse('2026-10-07T00:00:00Z');
const FUTURE = '2026-12-31T00:00:00Z';
const PAST = '2026-01-01T00:00:00Z';

describe('parseA2AKeys（A2A 密钥清单）', () => {
  it('未配置 / 空串 ⇒ 空结果（无有效钥 ⇒ 上层 401）', () => {
    expect(parseA2AKeys(undefined, NOW)).toEqual({
      keys: [],
      invalidEntries: [],
    });
    expect(parseA2AKeys('', NOW)).toEqual({ keys: [], invalidEntries: [] });
    expect(parseA2AKeys('  ,  ,', NOW)).toEqual({
      keys: [],
      invalidEntries: [],
    });
  });

  it('① 单钥无 @ ⇒ 有效且不含后缀（永不过期）', () => {
    expect(parseA2AKeys('k1', NOW).keys).toEqual(['k1']);
  });

  it('① 多钥（含空白项）⇒ 全部有效', () => {
    expect(parseA2AKeys(' k1 ,, k2 , ', NOW).keys).toEqual(['k1', 'k2']);
  });

  it('① 带 @ 且未过期 ⇒ 返回**裸钥**（不含 @过期）', () => {
    expect(parseA2AKeys(`k1@${FUTURE}`, NOW).keys).toEqual(['k1']);
  });

  it('① D5：`@` 取 lastIndexOf ⇒ 键内若含 @ 亦不误切', () => {
    expect(parseA2AKeys(`a@b@${FUTURE}`, NOW).keys).toEqual(['a@b']);
  });

  it('② 过期边界：now+1 有效 / now 恰好到期 ⇒ 失效 / now−1 ⇒ 失效', () => {
    const at = NOW;
    const iso = new Date(at).toISOString();
    expect(parseA2AKeys(`k@${iso}`, at - 1).keys).toEqual(['k']);
    expect(parseA2AKeys(`k@${iso}`, at).keys).toEqual([]);
    expect(parseA2AKeys(`k@${iso}`, at + 1).keys).toEqual([]);
  });

  it('② 已过期 ⇒ 剔除（不报非法）', () => {
    const r = parseA2AKeys(`k1@${PAST}`, NOW);
    expect(r.keys).toEqual([]);
    expect(r.invalidEntries).toEqual([]);
  });

  it('③ 时间串不可解析 ⇒ 丢弃 + 上报（**不**当作永不过期）', () => {
    const r = parseA2AKeys('k1@not-a-date', NOW);
    expect(r.keys).toEqual([]);
    expect(r.invalidEntries).toEqual(['k1@not-a-date']);
  });

  it('③ 只有过期时间、没有钥 ⇒ 丢弃 + 上报', () => {
    const r = parseA2AKeys(`@${FUTURE}`, NOW);
    expect(r.keys).toEqual([]);
    expect(r.invalidEntries).toEqual([`@${FUTURE}`]);
  });

  it('③ 混合：合法与非法项并存 ⇒ 只留合法项，非法项上报', () => {
    const r = parseA2AKeys(`k1@${FUTURE},bad@nope,k2`, NOW);
    expect(r.keys).toEqual(['k1', 'k2']);
    expect(r.invalidEntries).toEqual(['bad@nope']);
  });
});
