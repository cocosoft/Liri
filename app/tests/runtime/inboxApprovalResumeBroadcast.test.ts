// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-24（会话 `session_mwurduuh1b0b38db30`）：审批触发续跑的**启动广播**回归锁。
 *
 * 现场：批准后后端自动续跑 62s（22:24:59 → 22:26:02），期间前端浮动栏不显示
 * （批准前那条 chatStream 已结束，续跑没有客户端 SSE 连接；唯一相关的
 * `session:continued` 在**完成**后才广播）⇒ 用户读到"你还在执行，但没有状态条"。
 *
 * 契约：续跑真正推进（首个非 error chunk）时广播 SSE `session:resumed`
 * `{ id, sessionId, reason: 'approval_resume' }`；广播失败不得影响续跑。
 */
import { describe, it, expect } from 'bun:test';
import { broadcastResumeStarted } from '@openliri/service/runtime/inboxApproval';

describe('审批续跑：启动广播（session:resumed）', () => {
  it('广播事件名与载荷（id / sessionId / reason）', async () => {
    const calls: Array<{ event: string; data?: Record<string, unknown> }> = [];
    await broadcastResumeStarted('sess-r1', (event, data) => {
      calls.push({ event, data });
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].event).toBe('session:resumed');
    expect(calls[0].data).toEqual({
      id: 'sess-r1',
      sessionId: 'sess-r1',
      reason: 'approval_resume',
    });
  });

  it('广播实现抛错 ⇒ 只留痕，不得让续跑流程抛错', async () => {
    await expect(
      broadcastResumeStarted('sess-r2', () => {
        throw new Error('sse down');
      })
    ).resolves.toBeUndefined();
  });
});
