// A 阶段一（2026-09-05）：Durable Resume 恢复归属分流（C 语义）单测
// 覆盖：goal 检查点跳过（走 /goal 恢复）、chat/缺省（历史存量宽容读）候选保留
import { describe, expect, test } from 'bun:test';
import { ResumeManager } from './ResumeManager.js';
import {
  TAORPhase,
  type TAORCheckpoint,
  type TAORCheckpointKind,
  type CheckpointStorage,
} from './types.js';
import { TokenBudgetStatus } from '../core/tokenBudget/TokenBudgetController.js';

function makeCheckpoint(
  sessionId: string,
  kind?: TAORCheckpointKind
): TAORCheckpoint {
  return {
    id: `cp_${sessionId}`,
    sessionId,
    turnCount: 3,
    phase: TAORPhase.THINK,
    budgetState: {
      status: TokenBudgetStatus.NORMAL,
      currentTokens: 0,
      maxTokens: 10000,
      maxOutputTokens: 2000,
      percentUsed: 0,
      isWarning: false,
      isCritical: false,
      remainingTokens: 10000,
      remainingOutputTokens: 2000,
      resetAt: 0,
      totalTokensUsed: 0,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      totalOutputTokensUsed: 0,
      messagesProcessed: 0,
      shouldCompact: false,
      modelName: 'test-model',
    },
    conversationSummary: 'summary',
    lastPrompt: 'prompt',
    createdAt: Date.now(),
    type: 'auto',
    kind,
  };
}

/** 内存版 CheckpointStorage：仅 scanPending 路径所需的两个方法有真实实现 */
class FakeStorage implements CheckpointStorage {
  constructor(private latestBySession: Map<string, TAORCheckpoint>) {}

  async save(): Promise<string> {
    return 'cp_fake';
  }
  async load(): Promise<TAORCheckpoint | null> {
    return null;
  }
  async findBySessionId(): Promise<TAORCheckpoint[] | null> {
    return null;
  }
  async delete(): Promise<boolean> {
    return true;
  }
  async cleanup(): Promise<number> {
    return 0;
  }
  async getLatestIncomplete(sessionId: string): Promise<TAORCheckpoint | null> {
    return this.latestBySession.get(sessionId) ?? null;
  }
  async getPendingSessions(): Promise<string[]> {
    return [...this.latestBySession.keys()];
  }
  async deleteSession(): Promise<number> {
    return 0;
  }
}

describe('ResumeManager.scanPending（A 阶段一恢复归属分流 C）', () => {
  test('chat/缺省检查点保留，goal 检查点跳过（同一扫描批次）', async () => {
    const storage = new FakeStorage(
      new Map([
        // 历史存量：无 kind 字段 → 宽容读按 chat 处理，仍属 Durable Resume 范畴
        ['chat-session', makeCheckpoint('chat-session')],
        // PDL 快路径目标运行产物：Durable Resume 跳过，走 /goal 恢复
        ['goal-session', makeCheckpoint('goal-session', 'goal')],
      ])
    );
    const rm = new ResumeManager(storage);
    const candidates = await rm.scanPending();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].sessionId).toBe('chat-session');
  });

  test('纯 goal 会话不产出恢复候选', async () => {
    const storage = new FakeStorage(
      new Map([['goal-session', makeCheckpoint('goal-session', 'goal')]])
    );
    const rm = new ResumeManager(storage);
    const candidates = await rm.scanPending();
    expect(candidates).toHaveLength(0);
  });
});
