// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1-5（2026-11-05）：消息数/轮次数的单一口径 —— **持久层优先**。
 *
 * 实证：`GET /v1/sessions/{id}` 返回 `messageCount=7`、`roundCount=16`；
 * 同会话 `/messages` 返回 698 条（assistant 147 / tool 533 / user 18）；导出 165 条 / 18 轮。
 * 根因是计数取自**进程内存切片** `chatSessions[].messages`，而非持久层消息。
 */
import { describe, it, expect } from 'bun:test';
import { resolveSessionCounts } from '../../src/runtime/api/sessionAgentOps';

describe('P1-5：会话计数口径（持久层优先）', () => {
  it('持久层有消息 ⇒ 用持久层（不受内存切片影响）', () => {
    const persisted = [
      { role: 'user' },
      { role: 'assistant' },
      { role: 'tool' },
      { role: 'assistant' },
      { role: 'user' },
      { role: 'tool' },
    ];
    const counts = resolveSessionCounts({
      persistedMessages: persisted,
      memoryMessages: [{ role: 'user' }],
      metadataRoundCount: 16,
    });
    // 对话消息 = user + assistant（tool 不计入），轮次 = user
    expect(counts).toEqual({ messageCount: 4, roundCount: 2 });
  });

  it('持久层为空（新会话尚未落盘）⇒ 回退内存', () => {
    const counts = resolveSessionCounts({
      persistedMessages: [],
      memoryMessages: [{ role: 'user' }, { role: 'assistant' }],
      metadataRoundCount: 3,
    });
    expect(counts).toEqual({ messageCount: 2, roundCount: 1 });
  });

  it('两边都空 ⇒ messageCount=0、roundCount 取 metadata（legacy 兜底）', () => {
    expect(resolveSessionCounts({ metadataRoundCount: 5 })).toEqual({
      messageCount: 0,
      roundCount: 5,
    });
  });
});
