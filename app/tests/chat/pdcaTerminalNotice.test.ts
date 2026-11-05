/**
 * P0-5（2026-11-06）：任务**终态回执**文案。
 *
 * 背景：P0-4 把任务步骤消息默认从用户会话分离（`isTaskMessage`）⇒「完成/未达成/中止/等审批」
 * 也被一并隐藏，用户只看到任务悄无声息地结束。回执是**一条结论**（不带 `isTaskMessage`），
 * 保留在用户会话；本用例只锁文案与数字口径。
 */
import { describe, expect, it } from 'bun:test';

import { formatPdcaTerminalNotice } from '../../src/chat/launchers/PdcaLauncher';

describe('P0-5 任务终态回执', () => {
  it('完成 ⇒ ✅ + 进度', () => {
    const text = formatPdcaTerminalNotice({
      outcome: 'completed',
      completed: 5,
      total: 5,
    });
    expect(text).toContain('✅');
    expect(text).toContain('5/5 步完成');
    expect(text).toContain('编排面板');
  });

  it('未完全达成 ⇒ ⚠️ + 未达成数', () => {
    const text = formatPdcaTerminalNotice({
      outcome: 'partial',
      completed: 3,
      total: 5,
      failed: 2,
    });
    expect(text).toContain('⚠️');
    expect(text).toContain('3/5 步完成');
    expect(text).toContain('2 步未达成');
  });

  it('中止 ⇒ ⏹ + 可继续', () => {
    const text = formatPdcaTerminalNotice({
      outcome: 'aborted',
      completed: 1,
      total: 4,
    });
    expect(text).toContain('⏹');
    expect(text).toContain('1/4 步完成');
    expect(text).toContain('重新发送需求可继续');
  });

  it('预算耗尽 ⇒ ⚠️ + 预算说明', () => {
    const text = formatPdcaTerminalNotice({
      outcome: 'budget',
      completed: 2,
      total: 6,
    });
    expect(text).toContain('预算耗尽');
    expect(text).toContain('2/6 步完成');
  });

  it('失败 ⇒ ❌ + 原因（空原因也能出文案）', () => {
    const withError = formatPdcaTerminalNotice({
      outcome: 'failed',
      completed: 0,
      total: 0,
      error: 'provider timeout',
    });
    expect(withError).toContain('❌');
    expect(withError).toContain('provider timeout');
    expect(withError).toContain('重试');

    const noError = formatPdcaTerminalNotice({
      outcome: 'failed',
      completed: 0,
      total: 0,
    });
    expect(noError).toContain('❌');
    expect(noError).not.toContain('：');
  });

  it('等审批 ⇒ ⏸ + 阶段单位 + 依赖阻断补充', () => {
    const text = formatPdcaTerminalNotice({
      awaitingApproval: true,
      completed: 1,
      total: 4,
      unit: '阶段',
      blocked: 2,
    });
    expect(text).toContain('⏸');
    expect(text).toContain('1/4 阶段完成');
    expect(text).toContain('2 阶段因依赖阻断未执行');
    expect(text).toContain('编排面板确认');
  });
});
