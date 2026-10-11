// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T11（Spec `daily-budget-over-limit-ux.md` §1.2 G-2 / §5-D-1 E）：
// **子代理补计账 + 闸门** —— 接线既有 `canSpawnSubAgent()`（此前**零调用者**）。
//
// 子代理走**非 chat 管线**（`SubAgentEngine.callLLM` / `AgentTool.runDirectCall` 直调 provider）⇒
// 既不经流式闸门也不经非流式闸门，且其用量此前只入成本追踪、**不入每日预算** ⇒ 一次委派可把
// 剩余额度同时放大 N 份（G-2 的绕过路径）。
//
// 断言口径：
//  ① 计账（端到端，经 `llmClientOverride` 注入假供应商）：日预算增量 === 引擎聚合的 `totalTokens`（同源）；
//  ② 闸门（派生前）：额度不足 ⇒ 以**工具结果**返回拒绝（含原因 + 出路），且**不派生**；
//  ③ 档位语义：`canSpawnSubAgent()` 仅 `normal` 放行 ⇒ 告警区（`report_only`）即不派生；
//  ④ 接线守卫：直调路径（provider 来自全局 registry，无法在本层单测）也调用了计账助手。

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AIProvider, ChatResponse } from '@modules/ai';
import { SubAgentEngine } from '../../src/tools/AgentTool/SubAgentEngine';
import { createAgentTool } from '../../src/tools/AgentTool/AgentTool';
import {
  getAgentRunLedger,
  resetAgentRunLedger,
} from '../../src/tools/AgentTool/AgentRunLedger';
import { ToolExecutionStatus } from '../../src/tools/types/ToolResult';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';

const APP_SRC = join(import.meta.dir, '..', '..', 'src');
const SID = 'sess-t11';
/** 假供应商每轮回显的用量（prompt 30 + completion 20） */
const ROUND_USAGE = 50;

/** 最小假供应商：`chat` 直接返回无工具调用的收尾响应（1 轮完成） */
function makeFakeProvider(): AIProvider {
  return {
    id: 'fake-provider',
    displayName: 'fake',
    chat: async () =>
      ({
        content: 'done',
        usage: {
          prompt_tokens: 30,
          completion_tokens: 20,
          total_tokens: ROUND_USAGE,
        },
      }) as unknown as ChatResponse,
    chatStream: async function* (): AsyncGenerator<
      string,
      ChatResponse,
      unknown
    > {
      return { content: '' } as ChatResponse;
    },
    listModels: async () => ['fake-model'],
    validateConfig: () => ({ valid: true, errors: [], warnings: [] }),
  };
}

describe('T11：子代理计账与闸门（G-2/E）', () => {
  beforeEach(() => {
    resetDailyBudgetForTest();
    resetAgentRunLedger();
  });
  afterEach(() => {
    resetDailyBudgetForTest();
    resetAgentRunLedger();
  });

  it('子代理用量计入日预算（与引擎聚合 totalTokens 同源）', async () => {
    const engine = new SubAgentEngine({
      llmClientOverride: makeFakeProvider(),
    });
    const before = getDailyBudget().getMode().todayUsed;

    const result = await engine.execute({
      agentId: 't11-worker',
      systemPrompt: '你是测试 worker',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      toolInstances: new Map(),
      maxTurns: 1,
      model: 'fake-model',
      toolContext: { sessionId: SID } as never,
    });

    expect(result.completed).toBe(true);
    expect(result.tokenUsage.totalTokens).toBe(ROUND_USAGE);
    // 计账口径与引擎聚合**同源**：日预算增量 === 本次子代理真实用量
    expect(getDailyBudget().getMode().todayUsed).toBe(before + ROUND_USAGE);
  });

  it('额度耗尽（locked）⇒ 派生前拒绝：以工具结果回父对话（含原因 + 出路），不派生', async () => {
    const budget = getDailyBudget();
    budget.setLimit(100);
    budget.recordUsage(100);
    expect(budget.getMode().mode).toBe('locked');

    const tool = createAgentTool();
    const result = await tool.execute(
      { description: '内部测试', prompt: '只回报数字 0' } as never,
      {} as never
    );

    expect(result.status).toBe(ToolExecutionStatus.FAILURE);
    const text = String(result.error ?? '');
    expect(text).toContain('预算'); // 原因
    expect(text).toContain('日限额'); // 出路（可操作）
    // 未派生：无任何台账条目残留（拒绝发生在派生之前）
    expect(getAgentRunLedger().liveCount()).toBe(0);
  });

  it('告警区（report_only）⇒ 同样不派生（`canSpawnSubAgent()` 仅 normal 放行）', async () => {
    const budget = getDailyBudget();
    budget.setLimit(100);
    budget.recordUsage(85); // 85% ⇒ report_only（chat 闸门仍放行，但扇出入口更保守）
    expect(budget.getMode().mode).toBe('report_only');

    const tool = createAgentTool();
    const result = await tool.execute(
      { description: '内部测试', prompt: '只回报数字 0' } as never,
      {} as never
    );

    expect(result.status).toBe(ToolExecutionStatus.FAILURE);
    expect(String(result.error ?? '')).toContain('report_only');
  });

  it('接线守卫：直调路径（runDirectCall）用量亦计入日预算', () => {
    // 该路径的 provider 来自全局 registry（无法在本层单测）⇒ 以源码接线守卫兜底：
    // 若有人删掉这行，子代理的"简单任务"分支将重新绕过日预算。
    const code = readFileSync(
      join(APP_SRC, 'tools/AgentTool/AgentTool.ts'),
      'utf-8'
    );
    expect(code).toMatch(/recordDailyBudgetFromUsage\s*\(/);
    expect(code).toMatch(/canSpawnSubAgent\s*\(/);
  });
});
