// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `SessionRuntimeState`（P2-1 / R04-001 拆分批，2026-11-15）
 *
 * 三张 per-session 表从 `ChatManager` 外移后，其**语义**必须逐项等价：
 *   - 工具轮次按会话隔离（并发会话不串号）
 *   - 续跑意图是一次性（消费即删）
 *   - 状态机同一会话复用同一实例
 */
import { describe, it, expect } from 'bun:test';
import { SessionRuntimeState } from '@modules/chat/manager/sessionRuntimeState';

describe('SessionRuntimeState', () => {
  it('工具轮次按会话隔离，互不串号', () => {
    const state = new SessionRuntimeState();
    expect(state.getToolRound('a')).toBe(0);
    expect(state.incToolRound('a')).toBe(1);
    expect(state.incToolRound('a')).toBe(2);
    expect(state.incToolRound('b')).toBe(1);
    expect(state.getToolRound('a')).toBe(2);
    state.clearToolRound('a');
    expect(state.getToolRound('a')).toBe(0);
    expect(state.getToolRound('b')).toBe(1);
  });

  it('续跑意图是一次性的：消费即删，第二次返回 false', () => {
    const state = new SessionRuntimeState();
    state.markResumeIntent('s1');
    expect(state.consumePendingResumeIntent('s1')).toBe(true);
    expect(state.consumePendingResumeIntent('s1')).toBe(false);
  });

  it('clearResumeIntent 幂等：未登记时调用不抛错', () => {
    const state = new SessionRuntimeState();
    state.clearResumeIntent('nope');
    state.markResumeIntent('s2');
    state.clearResumeIntent('s2');
    expect(state.consumePendingResumeIntent('s2')).toBe(false);
  });

  it('同一会话复用同一状态机实例，不同会话相互独立', () => {
    const state = new SessionRuntimeState();
    const first = state.getSessionMachine('s1');
    expect(state.getSessionMachine('s1')).toBe(first);
    expect(state.getSessionMachine('s2')).not.toBe(first);
  });
});
