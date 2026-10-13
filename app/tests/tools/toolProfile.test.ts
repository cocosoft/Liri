/**
 * TG-4 / `T1-13`：会话 profile 能力标签 → 追加工具类别（2026-10-13）
 *
 * 覆盖：未声明 ⇒ 空（零行为变更）· media/coding 映射 · 去重 · 未知标签忽略（不臆造）。
 */
import { describe, it, expect } from 'bun:test';
import {
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
});
