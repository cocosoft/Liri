// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-04：TAOR 长任务「非幂等工具执行中撞限 → 落盘非空 → relief 唤醒 → 幂等续跑」整链。
//
// 与既有用例的分工（CS01：不重复造轮子）：
//  - `taorCheckpointPendingTools`：单点 round-trip / `reExecuteTools` 断言
//  - `budgetSuspendTaor`：挂起落点与启动扫描排除
//  - `taorLoopResumeWiring`：续跑 steering 消费清单
//  - **本文件**：把「消息 → 未完成工具 → budget_suspend 检查点 → relief 唤醒 → 续跑提示」
//    接成一条链；并用「历史存量 `pendingToolCalls: undefined`」作**先红**对照 ——
//    若落盘仍是 `undefined`，正向断言（提示必须带工具名）必然失败。
//
// 只用内存检查点 + 纯函数，不触发模型调用/真实工具（无网络、无 IO）。

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { ChatMessage } from '../../src/ai/models/types.js';
import {
  extractPendingToolCallsFromMessages,
  buildBudgetResumePrompt,
} from '../../src/query/taor/pendingToolCalls.js';
import { MemoryCheckpointStorage } from '../../src/query/taor/MemoryCheckpointStorage.js';
import { ResumeManager } from '../../src/query/ResumeManager.js';
import {
  getBudgetSuspendCoordinator,
  resetBudgetSuspendForTest,
} from '../../src/query/budgetSuspend.js';
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

/** 一个"非幂等工具已发出、结果未回"的会话尾部（模拟执行中撞限） */
function messagesWithInFlightTool(): ChatMessage[] {
  return [
    { role: 'user', content: '把项目编译一遍' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'tc-build',
          type: 'function',
          function: {
            name: 'bash',
            arguments: JSON.stringify({ command: 'npm run build' }),
          },
        },
      ],
    },
  ];
}

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
    type: 'budget_suspend',
    pendingToolCalls,
    messageCount: 2,
  };
}

describe('T25-04：撞限挂起 → 落盘非空 → relief → 续跑提示（整链）', () => {
  beforeEach(() => {
    resetBudgetSuspendForTest();
  });
  afterEach(() => {
    resetBudgetSuspendForTest();
  });

  it('正向：检查点带未完成工具 ⇒ relief 唤醒后续跑提示点名该工具', async () => {
    const sessionId = 'sess-durable';

    // ① 落盘：saveCheckpoint 的取值来源（纯函数）必须能推出未完成工具
    const pending = extractPendingToolCallsFromMessages(
      messagesWithInFlightTool()
    );
    expect(pending).toHaveLength(1);
    expect(pending[0].toolCallId).toBe('tc-build');

    const storage = new MemoryCheckpointStorage();
    const checkpointRef = await storage.save(
      makeCheckpoint(sessionId, pending)
    );

    // ② 挂起登记（事实源 = 检查点，协调器只持内存引用）
    const coordinator = getBudgetSuspendCoordinator();
    coordinator.suspend({
      sessionId,
      chain: 'taor',
      checkpointRef,
      reason: 'daily_budget_exhausted',
    });

    // ③ relief 唤醒：处理器从**检查点**读取清单并生成续跑提示
    let prompt = '';
    coordinator.setResumeHandler(async (sid, chain) => {
      expect(sid).toBe(sessionId);
      expect(chain).toBe('taor');
      const cp = await storage.load(checkpointRef);
      prompt = buildBudgetResumePrompt(cp?.pendingToolCalls);
      return true;
    });

    const { woken } = await coordinator.onReliefApplied('boost', sessionId);

    // ④ 断言：唤醒成功、提示点名未完成工具、挂起已释放
    expect(woken).toEqual([sessionId]);
    expect(prompt).toContain('bash');
    expect(prompt).toContain('npm run build');
    expect(coordinator.isSuspended(sessionId)).toBe(false);
  });

  it('先红对照：历史存量 pendingToolCalls=undefined ⇒ 提示无工具、reExecuteTools=false', async () => {
    const sessionId = 'sess-legacy';

    const storage = new MemoryCheckpointStorage();
    const checkpointRef = await storage.save(
      makeCheckpoint(sessionId, undefined)
    );

    const coordinator = getBudgetSuspendCoordinator();
    coordinator.suspend({
      sessionId,
      chain: 'taor',
      checkpointRef,
      reason: 'daily_budget_exhausted',
    });

    let prompt = '';
    let reExecuteTools: boolean | null = null;
    coordinator.setResumeHandler(async () => {
      const cp = await storage.load(checkpointRef);
      prompt = buildBudgetResumePrompt(cp?.pendingToolCalls);
      const rm = new ResumeManager(storage);
      const integrity = rm.validateCheckpointIntegrity(cp!, 0, 0);
      reExecuteTools = rm.getRestoreStrategy(integrity).reExecuteTools;
      return true;
    });

    await coordinator.onReliefApplied('boost', sessionId);

    // 无清单 ⇒ 退化为通用提示（不臆造工具）；恢复策略不重放
    expect(prompt).toContain('预算挂起点恢复');
    expect(prompt).not.toContain('bash');
    expect(reExecuteTools).toBe(false);
  });
});
