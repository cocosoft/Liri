// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * parseToolOutput 单元测试 —— 工具 UI 统一解析入口
 *
 * 覆盖三态（string JSON / 数组 / 对象）与失败兜底，
 * 防止 P1-1（Snapshots 数组解析错位）/ P1-2（Delete 候选数组误判）类契约回归。
 */
import { describe, expect, it } from 'bun:test';
import { parseToolOutput } from '../tools/parseToolOutput.js';

describe('parseToolOutput', () => {
  it('对象输入原样返回（delete 成功 / write / import / export / restore result）', () => {
    const obj = { title: '文档A', filePath: '/x/a.md' };
    expect(parseToolOutput(obj)).toBe(obj);
  });

  it('数组输入原样返回（snapshots 文件名数组 / delete 候选列表 / search 结果数组）', () => {
    const arr = ['snapshot_2026-01-01.md', 'snapshot_2025-12-01.md'];
    expect(parseToolOutput(arr)).toBe(arr);
  });

  it('JSON 字符串解析成功（对象形式）', () => {
    expect(parseToolOutput('{"imported": 3, "skipped": 1}')).toEqual({
      imported: 3,
      skipped: 1,
    });
  });

  it('JSON 字符串解析成功（数组形式）', () => {
    expect(parseToolOutput('["a.md", "b.md"]')).toEqual(['a.md', 'b.md']);
  });

  it('非法 JSON 字符串返回空对象（不抛异常，不吞调用方）', () => {
    expect(parseToolOutput('Document "X" deleted successfully.')).toEqual({});
    expect(parseToolOutput('')).toEqual({});
  });

  it('null / undefined 返回空对象', () => {
    expect(parseToolOutput(null)).toEqual({});
    expect(parseToolOutput(undefined)).toEqual({});
  });
});
