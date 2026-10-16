/**
 * TG-4 / `T1-13`：会话 profile 能力标签 → 追加工具类别（2026-10-13）
 * P4b（2026-10-16）：写入口的边界校验 `isKnownToolProfileTag`
 *
 * 覆盖：未声明 ⇒ 空（零行为变更）· media/coding 映射 · 去重 · 未知标签忽略（不臆造）·
 * 已登记标签判定（与映射表**同源**，防第 7 张手写清单）。
 */
import { describe, it, expect } from 'bun:test';
import {
  isKnownToolProfileTag,
  resolveToolProfileCategories,
  TOOL_PROFILE_CATEGORIES,
} from '../../src/tools/toolProfile.js';

describe('TG-4 会话 profile 能力标签 → 追加类别', () => {
  it('未声明 / 空 ⇒ 空（零行为变更）', () => {
    expect(resolveToolProfileCategories(undefined)).toEqual([]);
    expect(resolveToolProfileCategories([])).toEqual([]);
  });

  it('media ⇒ image/video/media；coding ⇒ code', () => {
    expect(resolveToolProfileCategories(['media']).sort()).toEqual([
      'image',
      'media',
      'video',
    ]);
    expect(resolveToolProfileCategories(['coding'])).toEqual(['code']);
  });

  it('多标签 ⇒ 去重合并', () => {
    expect(
      resolveToolProfileCategories(['media', 'media', 'coding']).sort()
    ).toEqual(['code', 'image', 'media', 'video']);
  });

  it('未知标签 ⇒ 忽略（不臆造类别，不阻断）', () => {
    expect(resolveToolProfileCategories(['nope', 'media']).sort()).toEqual([
      'image',
      'media',
      'video',
    ]);
  });

  it('映射表只含已登记能力（防凭想象扩充）', () => {
    expect(Object.keys(TOOL_PROFILE_CATEGORIES).sort()).toEqual([
      'coding',
      'media',
    ]);
  });

  it('isKnownToolProfileTag：与映射表键集逐项一致（含原型链名不误判）', () => {
    // 正向：映射表每个键都判真（防"写入口拒掉合法标签"——正是 P4b 要修的反向 bug）
    for (const tag of Object.keys(TOOL_PROFILE_CATEGORIES)) {
      expect(isKnownToolProfileTag(tag)).toBe(true);
    }
    // 反向：未登记 / 空串 / 原型链属性名（`Object.prototype` 上的名字不算"已登记"）判假
    expect(isKnownToolProfileTag('nope')).toBe(false);
    expect(isKnownToolProfileTag('')).toBe(false);
    expect(isKnownToolProfileTag('toString')).toBe(false);
    expect(isKnownToolProfileTag('constructor')).toBe(false);
  });
});
