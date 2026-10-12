// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// F1（债二-预算挂起续跑 §Task 1）：检查点落盘 `pendingToolCalls` 的 round-trip 与恢复策略联动。
// 正向：落盘真实未完成工具 ⇒ 读回一致 ⇒ ACT 阶段恢复策略 `reExecuteTools === true`；
// 负向：`pendingToolCalls: undefined` ⇒ 历史存量语义不变（`reExecuteTools === false`）。

import { describe, it, expect } from 'bun:test';
import { MemoryCheckpointStorage } from '../../src/query/taor/MemoryCheckpointStorage.js';
import { ResumeManager } from '../../src/query/ResumeManager.js';
import { buildBudgetResumePrompt } from '../../src/query/taor/pendingToolCalls.js';
import { TAORPhase } from '../../src/query/types.js';
import type { TAORCheckpoint } from '../../src/query/types.js';
import { TokenBudgetStatus } from '../../src/tokenBudget/TokenBudgetController.js';
import type { TokenBudgetState } from '../../src/tokenBudget/TokenBudgetController.js';

const budgetState: TokenBudgetState = {
  status: TokenBudgetStatus.NORMAL,
  currentTokens: 0,
  maxTokens: 100000,
  maxOutputTokens: 4096,
  percentUsed: 0,
  isWarning: false,
  isCritical: false,
  remainingTokens: 100000,
  remainingOutputTokens: 4096,
  resetAt: 0,
  totalTokensUsed: 0,
  totalCacheReadTokens: 0,
  totalCacheCreationTokens: 0,
  totalOutputTokensUsed: 0,
  messagesProcessed: 0,
  shouldCompact: false,
  modelName: 'test-model',
};

function makeCheckpoint(
  sessionId: string,
  pendingToolCalls: TAORCheckpoint['pendingToolCalls']
): TAORCheckpoint {
  return {
    id: `cp-${sessionId}`,
    sessionId,
    turnCount: 1,
    phase: TAORPhase.ACT,
    budgetState,
    conversationSummary: '',
    lastPrompt: '',
    createdAt: Date.now(),
    type: 'auto',
    pendingToolCalls,
    messageCount: 1,
  };
}

describe('TAORCheckpoint.pendingToolCalls round-trip（F1）', () => {
  it('落盘后 getLatestIncomplete 读回一致，ACT 恢复策略 reExecuteTools === true', async () => {
    const storage = new MemoryCheckpointStorage();
    await storage.save(
      makeCheckpoint('sess-1', [
        { toolCallId: 'tc-1', toolName: 'bash', args: { command: 'ls' } },
      ])
    );

    const loaded = await storage.getLatestIncomplete('sess-1');
    expect(loaded?.pendingToolCalls?.length).toBe(1);
    expect(loaded?.pendingToolCalls?.[0].toolCallId).toBe('tc-1');

    const rm = new ResumeManager(storage);
    const integrity = rm.validateCheckpointIntegrity(loaded!, 0, 0);
    expect(integrity.pendingToolCalls).toBe(1);
    expect(rm.getRestoreStrategy(integrity).reExecuteTools).toBe(true);
  });

  it('负向：pendingToolCalls undefined ⇒ 历史数据语义不变（reExecuteTools === false）', async () => {
    const storage = new MemoryCheckpointStorage();
    await storage.save(makeCheckpoint('sess-2', undefined));

    const loaded = await storage.getLatestIncomplete('sess-2');
    expect(loaded).not.toBeNull();

    const rm = new ResumeManager(storage);
    const integrity = rm.validateCheckpointIntegrity(loaded!, 0, 0);
    expect(integrity.pendingToolCalls).toBe(0);
    expect(rm.getRestoreStrategy(integrity).reExecuteTools).toBe(false);
  });

  it('负向（M5）：pendingToolCalls null ⇒ 与 undefined 等价（reExecuteTools === false）', async () => {
    const storage = new MemoryCheckpointStorage();
    await storage.save(makeCheckpoint('sess-3', null as never));

    const loaded = await storage.getLatestIncomplete('sess-3');
    expect(loaded).not.toBeNull();

    const rm = new ResumeManager(storage);
    const integrity = rm.validateCheckpointIntegrity(loaded!, 0, 0);
    expect(integrity.pendingToolCalls).toBe(0);
    expect(rm.getRestoreStrategy(integrity).reExecuteTools).toBe(false);
  });
});

// ─── I4（最终整支评审）：`pendingToolCalls` 的运行时消费者 —— 续跑提示生成 ────────
describe('buildBudgetResumePrompt（I4）', () => {
  it('含 2 条未完成工具 ⇒ 提示包含工具名与参数摘要', () => {
    const prompt = buildBudgetResumePrompt([
      { toolCallId: 'tc-1', toolName: 'bash', args: { command: 'ls' } },
      { toolCallId: 'tc-2', toolName: 'grep', args: { pattern: 'todo' } },
    ]);
    expect(prompt).toContain('尚未完成');
    expect(prompt).toContain('bash');
    expect(prompt).toContain('grep');
  });

  it('空/未提供清单 ⇒ 退化为通用续跑提示（不报错）', () => {
    for (const empty of [undefined, null, [] as const]) {
      const prompt = buildBudgetResumePrompt(empty as never);
      expect(prompt).toContain('预算挂起点恢复');
      expect(prompt).not.toContain('尚未完成');
    }
  });
});
