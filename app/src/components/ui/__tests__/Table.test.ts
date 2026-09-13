// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Table 工具函数单元测试 —— CJK 显示宽度计算（P3-1 对齐修复核心）
 *
 * 覆盖 displayWidth（全角按 2 列）与 truncateToWidth（按显示宽度截断+省略号），
 * 防止终端表格中文错位回归。
 */
import { describe, expect, it } from 'bun:test';
import { displayWidth, truncateToWidth } from '../Table.js';

describe('displayWidth', () => {
  it('ASCII 字符按 1 列计', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('Title')).toBe(5);
  });

  it('中文/全角字符按 2 列计', () => {
    expect(displayWidth('中文')).toBe(4);
    expect(displayWidth('知识库')).toBe(6);
  });

  it('中英混合按各自列宽累计', () => {
    expect(displayWidth('a中b')).toBe(4);
    expect(displayWidth('知识Doc')).toBe(4 + 3);
  });

  it('空字符串宽度为 0', () => {
    expect(displayWidth('')).toBe(0);
  });
});

describe('truncateToWidth', () => {
  it('未超宽时原样返回', () => {
    expect(truncateToWidth('abcdef', 10)).toBe('abcdef');
    expect(truncateToWidth('中文标题', 8)).toBe('中文标题');
  });

  it('ASCII 超宽按显示宽度截断并加省略号', () => {
    expect(truncateToWidth('abcdef', 3)).toBe('ab…');
  });

  it('中文超宽不会截断多字节字符（省略号占 1 列）', () => {
    expect(truncateToWidth('中文标题', 3)).toBe('中…');
    expect(truncateToWidth('中文标题', 4)).toBe('中…');
  });

  it('恰好等于宽度时原样返回（含全角）', () => {
    expect(truncateToWidth('ab', 2)).toBe('ab');
    expect(truncateToWidth('中文', 4)).toBe('中文');
  });

  it('极小宽度兜底为省略号', () => {
    expect(truncateToWidth('abc', 1)).toBe('…');
    expect(truncateToWidth('abc', 0)).toBe('…');
  });
});
