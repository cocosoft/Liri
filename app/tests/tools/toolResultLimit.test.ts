// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * F4（2026-11-22）：工具结果单条上限 = **工具声明优先**。
 *
 * 背景（二次复查）：`maxResultSizeChars` 只被 `ToolFactory` 透传与 `tools info` 展示，
 * 真实截断一律用全局 50k ⇒ bash 100k / web_fetch 500k / file_read Infinity 的声明
 * 从未生效。`resolveSingleResultLimit` 是接线后的唯一判据。
 */

import { describe, expect, it } from 'bun:test';

import {
  PREVIEW_CHARS,
  SINGLE_RESULT_LIMIT_CHARS,
  TURN_BUDGET_CHARS,
  resolveSingleResultLimit,
} from '../../src/tools/services/ToolResultPersister';

describe('F4：单条结果上限解析', () => {
  it('未声明 ⇒ 全局预算', () => {
    expect(resolveSingleResultLimit(undefined)).toBe(SINGLE_RESULT_LIMIT_CHARS);
    expect(resolveSingleResultLimit(0)).toBe(SINGLE_RESULT_LIMIT_CHARS);
    expect(resolveSingleResultLimit(Number.NaN)).toBe(
      SINGLE_RESULT_LIMIT_CHARS
    );
  });

  it('声明生效（含放宽与 Infinity）', () => {
    expect(resolveSingleResultLimit(100_000)).toBe(100_000);
    expect(resolveSingleResultLimit(500_000)).toBe(500_000);
    expect(resolveSingleResultLimit(Infinity)).toBe(Infinity);
  });

  it('单轮聚合硬兜底仍存在', () => {
    expect(TURN_BUDGET_CHARS).toBeGreaterThan(SINGLE_RESULT_LIMIT_CHARS);
    expect(PREVIEW_CHARS).toBeLessThan(SINGLE_RESULT_LIMIT_CHARS);
  });
});
