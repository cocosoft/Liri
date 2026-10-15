// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 日预算「放行留痕」源码守卫（2026-10-15）：
//
// 缺陷（真机实证）：`daily-budget-state.json` 出现 `relief.kind="unlock-today"`（放行至日界）
// 而 app.log 对 `relief` **零命中** ⇒ 当日日限额整体不拦截却**无法追溯来路**。
// 根因：`clearRelief()` 有 `relief_revoked` 日志，而 `applyRelief()` **完全静默**（不对称）。
//
// 本守卫钉住"放行与撤销两侧都必须留痕"，防回流。
// 注：此处**不做行为调用**（`applyRelief` 会经 `_schedulePersist()` 写真实状态文件，
// 测试中调用会污染用户 `daily-budget-state.json`）⇒ 采用零副作用的源码守卫。

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(
  __dirname,
  '..',
  '..',
  'src',
  'query',
  'DailyBudgetManager.ts'
);

describe('日预算：放行/撤销留痕守卫', () => {
  const src = readFileSync(SRC, 'utf-8');

  it('① `applyRelief` 记录 `dailyBudget:relief_applied`（原为静默）', () => {
    expect(src).toContain("logger.info('dailyBudget:relief_applied'");
  });

  it('② `clearRelief` 维持既有 `dailyBudget:relief_revoked`（两侧对称）', () => {
    expect(src).toContain("logger.info('dailyBudget:relief_revoked'");
  });

  it('③ 放行留痕包含 kind / expiresAt / effectiveLimit 三个可追溯字段', () => {
    const idx = src.indexOf("logger.info('dailyBudget:relief_applied'");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 420);
    expect(block).toContain('kind: input.kind');
    expect(block).toContain('expiresAt: appliedExpiresAt');
    expect(block).toContain('effectiveLimit: this._effectiveLimit()');
  });
});
