// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 设计稿 §4 指标 2/3 的取数口径（2026-11-10）。
 *
 * 覆盖：ask 按会话归组、回执覆盖率分母（仅日志窗口内的终态任务）、
 * 缺回执清单、日志时间窗过滤、非 JSON / 缺字段行不参与统计。
 */

import { describe, expect, it } from 'bun:test';
import {
  filterLogLinesSince,
  summarizeDemandAcceptance,
} from '../../scripts/lib/demandAcceptance';
import type { RootTaskInfo } from '../../scripts/lib/demandConvergence';

const log = (
  message: string,
  meta: Record<string, unknown>,
  timestamp = '2026-11-10T01:00:00.000Z'
): string => JSON.stringify({ timestamp, level: 'info', message, meta });

const approval = (sessionId: string): string =>
  log('Tool approval submitted to Inbox', { sessionId, toolName: 'bash' });

const receipt = (taskId: string): string =>
  log('PDCA 终态回执已发出', { taskId, sessionId: 's' });

const task = (
  taskId: string,
  demand: boolean,
  sessionId: string,
  terminal?: string
): RootTaskInfo => ({
  taskId,
  sessionId,
  demand,
  ...(terminal ? { terminal } : {}),
});

describe('demandAcceptance：指标 2/3 取数', () => {
  it('ask 按会话归组：demand 与 interactive 分开计数', () => {
    const tasks = [
      task('t_d1', true, 's_d', 'completed'),
      task('t_i1', false, 's_i', 'completed'),
    ];
    const summary = summarizeDemandAcceptance(tasks, [
      approval('s_d'),
      approval('s_i'),
      approval('s_i'),
      // 未知会话（不在检查点里）⇒ 不归任何一组
      approval('s_unknown'),
    ]);
    expect(summary.approvals).toEqual({ demand: 1, interactive: 2 });
  });

  it('回执覆盖率只统计日志窗口内的终态任务', () => {
    const tasks = [
      task('t_d1', true, 's_d', 'completed'),
      task('t_d2', true, 's_d', 'failed'),
      // 日志里从未出现 ⇒ 窗口外（老任务），不计入分母
      task('t_d3', true, 's_d', 'completed'),
      // 非终态 ⇒ 不计入
      task('t_d4', true, 's_d'),
    ];
    const summary = summarizeDemandAcceptance(tasks, [
      receipt('t_d1'),
      log('长程任务开始', { taskId: 't_d1' }),
      log('长程任务开始', { taskId: 't_d2' }),
      log('长程任务开始', { taskId: 't_d4' }),
    ]);
    expect(summary.delivery.demand.terminals).toBe(2);
    expect(summary.delivery.demand.delivered).toBe(1);
    expect(summary.delivery.demand.missing).toEqual(['t_d2']);
    expect(summary.delivery.demand.missingCount).toBe(1);
    expect(summary.delivery.demand.outsideWindow).toBe(1);
  });

  it('非 JSON 行与缺 sessionId 的 ask 不参与统计', () => {
    const tasks = [task('t_d1', true, 's_d', 'completed')];
    const summary = summarizeDemandAcceptance(tasks, [
      'not json at all',
      JSON.stringify({ message: 'Tool approval submitted to Inbox', meta: {} }),
      receipt('t_d1'),
    ]);
    expect(summary.approvals.demand).toBe(0);
    expect(summary.delivery.demand.delivered).toBe(1);
    expect(summary.log.parsed).toBe(2);
  });

  it('指标 1：demand 专属日志按任务归组，interactive 上出现即泄漏', () => {
    const tasks = [
      task('t_d1', true, 's_d', 'completed'),
      task('t_i1', false, 's_i', 'completed'),
    ];
    const summary = summarizeDemandAcceptance(tasks, [
      log('demand 交付回执已落盘', { taskId: 't_d1', path: 'delivery.md' }),
      log('demand 交付回执已落盘', { taskId: 't_i1', path: 'delivery.md' }),
      log('demand 交付回执已落盘', { taskId: 't_unknown', path: 'x.md' }),
    ]);
    expect(summary.demandOnlyLogs).toEqual({
      demand: 1,
      interactive: 1,
      unknown: 1,
    });
  });

  it('阶段子任务的回执/日志归一到根任务（demand 走阶段链时交付写在 <父>_<stage>）', () => {
    const tasks = [task('pdca_root', true, 's_d', 'completed')];
    const summary = summarizeDemandAcceptance(tasks, [
      log('PDCA 终态回执已发出', { taskId: 'pdca_root_design' }),
      log('demand 交付回执已落盘', { taskId: 'pdca_root_design' }),
    ]);
    expect(summary.delivery.demand.delivered).toBe(1);
    expect(summary.delivery.demand.terminals).toBe(1);
    expect(summary.demandOnlyLogs).toEqual({
      demand: 1,
      interactive: 0,
      unknown: 0,
    });
  });

  it('delivery.md 已落盘也算交付（PDL 快路径不经 audit 回执）', () => {
    const tasks = [task('pdca_pdl', true, 's_d', 'completed')];
    const summary = summarizeDemandAcceptance(
      tasks,
      [log('任务开始', { taskId: 'pdca_pdl' })],
      new Set(['pdca_pdl'])
    );
    expect(summary.delivery.demand.delivered).toBe(1);
    expect(summary.delivery.demand.missingCount).toBe(0);
  });

  it('指标 2 归因：demand 会话的 ask 按工具名分组（次数降序、同名升序）', () => {
    const tasks = [task('t_d1', true, 's_d', 'completed')];
    const summary = summarizeDemandAcceptance(tasks, [
      log('Tool approval submitted to Inbox', {
        sessionId: 's_d',
        toolName: 'file_write',
      }),
      log('Tool approval submitted to Inbox', {
        sessionId: 's_d',
        toolName: 'bash',
      }),
      log('Tool approval submitted to Inbox', {
        sessionId: 's_d',
        toolName: 'file_write',
      }),
      // 缺 toolName ⇒ 归入 (unknown)，不丢弃计数
      log('Tool approval submitted to Inbox', { sessionId: 's_d' }),
      // 非 demand 会话不进归因面
      log('Tool approval submitted to Inbox', {
        sessionId: 's_unknown',
        toolName: 'bash',
      }),
    ]);
    expect(summary.approvals.demand).toBe(4);
    expect(summary.demandApprovalsByTool).toEqual([
      { tool: 'file_write', count: 2 },
      { tool: '(unknown)', count: 1 },
      { tool: 'bash', count: 1 },
    ]);
  });

  it('filterLogLinesSince：按 timestamp 过滤，无 timestamp 行保留', () => {
    const lines = [
      log('a', {}, '2026-10-31T23:00:00.000Z'),
      log('b', {}, '2026-11-10T00:00:00.000Z'),
      JSON.stringify({ message: 'no-timestamp' }),
    ];
    const kept = filterLogLinesSince(lines, '2026-11-01');
    expect(kept).toHaveLength(2);
    expect(kept.some((l) => l.includes('"a"'))).toBe(false);
  });
});
