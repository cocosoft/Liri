// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// B3 回归（2026-10-12，真实 E2E 暴露）：TAOR 链"唤醒后续跑"被**残留终态标志**短路。
//
// 缺陷（真实服务实证，日志 `TAOR shouldContinue:有工具调用但被判不继续 {stopped:true}`）：
// 挂起时 `TAORLoop.beforeReasoning` 的 `budget_exhausted` 分支置 `stopped=true`；唤醒路径
// （`ChatManager.resumeSuspendedSession('taor')`）为保住恢复的游标/steering **刻意跳过
// `reset()`**（G-T3-1），而 `resumeFromCheckpoint` 只恢复 `turnCount/phase/...`、**不复位
// run 级终态标志** ⇒ `stopped` 仍为 `true` ⇒ 首个（seeded）ACT 的 `shouldContinue` 直接判
// "不继续"、有工具调用却被静默丢弃 ⇒ **任务并未真正续跑**。
//
// 修复：`resumeFromCheckpoint` 复位 run 级终态（`stopped=false` / `stopReason='completed'`）
// —— "恢复 ⇒ 循环再度可运行"。同步复位 abort 控制器，避免把上一轮的取消信号带进恢复轮。

import { describe, expect, it } from 'bun:test';
import { TAORLoop } from '../../src/query/TAORLoop';
import type { QueryEngine } from '../../src/query/QueryEngine';
import type { TAORCheckpoint } from '../../src/query/types';

interface TestableLoop {
  stopped: boolean;
  stopReason: string;
  checkpointStorage: { load(id: string): Promise<unknown> };
  resumeFromCheckpoint(id?: string): Promise<boolean>;
  shouldContinue(
    input: unknown,
    result: { toolCalls: Array<{ name: string }> }
  ): boolean;
}

function makeLoop(): TestableLoop {
  return new TAORLoop({} as unknown as QueryEngine) as unknown as TestableLoop;
}

/** 最小可用 checkpoint（`resumeFromCheckpoint` 读取的字段） */
function suspendCheckpoint(): TAORCheckpoint {
  return {
    id: 'cp-suspend',
    sessionId: 's-taor-resume',
    turnCount: 0,
    phase: 'act',
    budgetState: {
      modelName: 'default',
      maxTokens: 200000,
      currentTokens: 0,
      maxOutputTokens: 8000,
    },
    conversationSummary: '',
    lastPrompt: '',
    createdAt: Date.now(),
    type: 'budget_suspend',
  } as unknown as TAORCheckpoint;
}

describe('B3：resumeFromCheckpoint 复位终态标志（TAOR 续跑不被短路）', () => {
  it('挂起态（stopped=true）经 resumeFromCheckpoint ⇒ 移除 stopped，再跑时"继续"', async () => {
    const loop = makeLoop();
    // 模拟"挂起时置终态"（TAORLoop.beforeReasoning 的 budget_exhausted 分支）
    loop.stopped = true;
    loop.stopReason = 'budget_exhausted';
    loop.checkpointStorage = {
      load: async () => suspendCheckpoint(),
    };

    const ok = await loop.resumeFromCheckpoint('cp-suspend');

    expect(ok).toBe(true);
    // 终态停止标志已清除（修复前恒为 true ⇒ 下一条断言失败）
    expect(loop.stopped).toBe(false);
    // 关键行为：seeded ACT 有工具调用时必须判"继续"（修复前因 stopped 短路为 false）
    expect(
      loop.shouldContinue(
        {} as never,
        { toolCalls: [{ name: 'glob' }] } as never
      )
    ).toBe(true);
  });
});
