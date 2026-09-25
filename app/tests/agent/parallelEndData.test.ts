/**
 * P1-11（2026-09-25）：`PARALLEL_END` 载荷的两个取消量必须**并列派生、不可互相替代**。
 *
 * 背景（对标分析报告 §五 P1-11）：修复前事件只发 `cancelledTasks`（= 投递缺口），
 * 而**收尾阶段**（门禁/合成）被取消时任务已全部投递 ⇒ 缺口为 0 ⇒ 消费端把
 * "3/3 成功后被取消"读成"正常结束"。本次把派生收敛为单一入口 `deriveParallelEndData`
 * 并把 `cancelledFact` 一并发布；以下用例锁定该语义（含修复前必失败的用例）。
 */

import { describe, it, expect } from 'bun:test';
import { deriveParallelEndData } from '../../src/agent/events/OrchestrationEvents.js';

describe('deriveParallelEndData（P1-11 取消量语义）', () => {
  it('正常完成（全部投递、未取消）⇒ 缺口 0 且取消事实为 false', () => {
    const d = deriveParallelEndData({
      totalTasks: 3,
      succeededTasks: 3,
      deliveredTasks: 3,
      cancelledFact: false,
    });
    expect(d).toEqual({
      totalTasks: 3,
      completedTasks: 3,
      failedTasks: 0,
      cancelledTasks: 0,
      cancelledFact: false,
    });
  });

  it('收尾阶段被取消（3/3 全部投递且成功）⇒ 缺口为 0 但取消事实为 true（修复前无法表达）', () => {
    const d = deriveParallelEndData({
      totalTasks: 3,
      succeededTasks: 3,
      deliveredTasks: 3,
      cancelledFact: true,
    });
    // 修复前：事件只发 cancelledTasks ⇒ 该场景对外**完全看不到"被取消"** ⇒ 本条必失败
    expect(d.cancelledTasks).toBe(0);
    expect(d.cancelledFact).toBe(true);
  });

  it('投递阶段被取消（5 计划 / 3 投递 / 1 成功）⇒ 缺口 2、失败 2、取消事实 true', () => {
    const d = deriveParallelEndData({
      totalTasks: 5,
      succeededTasks: 1,
      deliveredTasks: 3,
      cancelledFact: true,
    });
    expect(d.cancelledTasks).toBe(2);
    expect(d.failedTasks).toBe(2);
    expect(d.cancelledFact).toBe(true);
  });

  it('失败数只统计**已投递**任务（未投递的不计失败）', () => {
    const d = deriveParallelEndData({
      totalTasks: 4,
      succeededTasks: 0,
      deliveredTasks: 2,
      cancelledFact: true,
    });
    // 修复前 `tasks.length - succeeded` 会把 2 个未投递任务也算成失败 ⇒ 4 ⇒ 本条必失败
    expect(d.failedTasks).toBe(2);
    expect(d.cancelledTasks).toBe(2);
  });

  it('异常输入不得产生负数（delivered > total / succeeded > delivered 均钳到 0）', () => {
    const overDelivered = deriveParallelEndData({
      totalTasks: 2,
      succeededTasks: 2,
      deliveredTasks: 5,
      cancelledFact: false,
    });
    expect(overDelivered.cancelledTasks).toBe(0);

    const overSucceeded = deriveParallelEndData({
      totalTasks: 3,
      succeededTasks: 9,
      deliveredTasks: 3,
      cancelledFact: false,
    });
    expect(overSucceeded.failedTasks).toBe(0);
  });
});
