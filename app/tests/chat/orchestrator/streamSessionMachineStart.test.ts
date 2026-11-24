// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1 根因回归（2026-11-24，真机 `session_mwq5ookl21aa28ea96`）：**流式入口必须把会话状态机
 * 置为 `running`**。
 *
 * 取证：`ChatManager.streamMessage` 已委托 `ChatOrchestrator.streamMessage`，而后者只在
 * `sendMessage`（非流式）调用 `start()`；流式准备阶段从未 `start()` ⇒ 机器恒停在 `idle`，
 * 等待审批收尾的 `pause()` 抛 `idle → requires_action`（兜底再写 `turn/end{canceled}`，
 * 前端把"等待审批"显示成"已中断"）。
 */
import { describe, expect, it } from 'bun:test';
import { SessionStateMachine } from '@openliri/infra/state/session/SessionStateMachine';
import { IllegalTransitionError } from '@openliri/infra/state/errors';
import { ChatOrchestrator } from '../../../src/chat/orchestrator/ChatOrchestrator.js';
import { createTestHost, createTestSession } from './helpers.js';

const SESSION_ID = 'sess-machine-start';

describe('流式入口的会话状态机生命周期', () => {
  it('回合开始即 idle → running；随后 pause（等待审批）合法', async () => {
    const session = createTestSession({ id: SESSION_ID });
    const machine = new SessionStateMachine(SESSION_ID);
    const host = createTestHost({
      session,
      llmChunks: [{ content: 'ok' }],
      getSessionMachine: () => machine,
    });
    const orch = new ChatOrchestrator({ host });

    for await (const _chunk of orch.streamMessage('hi', {
      sessionId: SESSION_ID,
    })) {
      void _chunk;
    }

    const edges = machine.getHistory().map((r) => `${r.from}->${r.to}`);
    expect(edges).toContain('idle->running');

    // 关键回归：此时收口为"等待审批"不得抛非法转移（修复前必抛）
    expect(() => machine.pause('等待审批')).not.toThrow();
    expect(machine.getState()).toBe('requires_action');
  });

  it('负向对照：未 start 的机器直接 pause 仍抛（证明修复点在"入口 start"，不是放松转移表）', () => {
    const bare = new SessionStateMachine('sess-bare');
    expect(() => bare.pause('等待审批')).toThrow(IllegalTransitionError);
  });
});
