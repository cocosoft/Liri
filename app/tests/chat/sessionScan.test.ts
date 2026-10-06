/**
 * U4 历史会话补评：`rankRecentSessionIds` 纯函数单测。
 *
 * 规格：`.trae/specs/online-quality-evaluation.md` §7 步骤 6 遗留项（历史会话补评）。
 */
import { describe, expect, it } from 'bun:test';
import { rankRecentSessionIds } from '../../src/chat/quality/sessionScan';

describe('U4 rankRecentSessionIds：最近更新优先', () => {
  it('按 updatedAt 降序返回，并截断到 limit', () => {
    const records = [
      { id: 'a', updatedAt: 100 },
      { id: 'b', updatedAt: 300 },
      { id: 'c', updatedAt: 200 },
    ];
    expect(rankRecentSessionIds(records, 2)).toEqual(['b', 'c']);
    expect(rankRecentSessionIds(records, 10)).toEqual(['b', 'c', 'a']);
  });

  it('ISO 字符串时间同样可比（与数字混用）', () => {
    const records = [
      { id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'new', updatedAt: 1_800_000_000_000 }, // 2027-01-15 附近
    ];
    expect(rankRecentSessionIds(records, 2)).toEqual(['new', 'old']);
  });

  it('时间无法解析 ⇒ 排最后（不丢、不当作最旧优先）', () => {
    const records = [
      { id: 'bad', updatedAt: 'not-a-date' },
      { id: 'good', updatedAt: 5 },
    ];
    expect(rankRecentSessionIds(records, 2)).toEqual(['good', 'bad']);
  });

  it('按 id 去重 + 丢弃空 id；limit ≤ 0 ⇒ 空数组', () => {
    const records = [
      { id: 'a', updatedAt: 10 },
      { id: 'a', updatedAt: 20 },
      { id: '', updatedAt: 30 },
    ];
    expect(rankRecentSessionIds(records, 5)).toEqual(['a']);
    expect(rankRecentSessionIds(records, 0)).toEqual([]);
  });
});
