/**
 * `/v1/agents/:id/stop` 授权意图（O14 显式化，2026-10-23）
 *
 * 原实现 `privileged: sessionId === undefined` ⇒ "不传会话"**自动**成为特权调用，
 * 无法区分"运维确有意"与"漏传/拼错字段"。本用例锁定新契约：
 *  ① 带 `sessionId` ⇒ 走 Tier2 归属校验（privileged=false）；
 *  ② 无 `sessionId` ⇒ 必须显式 `privileged: true`，否则 400；
 *  ③ 两者同时出现 ⇒ 拒绝（不允许"带会话却偷偷提权"）。
 */
import { describe, expect, it } from 'bun:test';
import { resolveStopAgentAuthIntent } from '../../src/infrastructure/http/handlers/agent-control-handlers.js';

describe('resolveStopAgentAuthIntent（/agents/:id/stop）', () => {
  it('带 sessionId ⇒ 归属校验（privileged=false）', () => {
    expect(resolveStopAgentAuthIntent({ sessionId: 'sess-1' })).toEqual({
      ok: true,
      requesterSessionId: 'sess-1',
      privileged: false,
    });
  });

  it('sessionId 前后空白会被裁剪', () => {
    const intent = resolveStopAgentAuthIntent({ sessionId: '  sess-1  ' });
    expect(intent.ok).toBe(true);
    if (intent.ok) expect(intent.requesterSessionId).toBe('sess-1');
  });

  it('无 sessionId 且显式 privileged:true ⇒ 运维级停止', () => {
    expect(resolveStopAgentAuthIntent({ privileged: true })).toEqual({
      ok: true,
      privileged: true,
    });
  });

  it('空 body / 空对象 / null ⇒ 400（不再隐式授予特权）', () => {
    for (const body of [{}, null, undefined, '']) {
      const intent = resolveStopAgentAuthIntent(body);
      expect(intent.ok).toBe(false);
      if (!intent.ok) expect(intent.reason).toContain('privileged');
    }
  });

  it('privileged 必须是严格 true（字符串/数字不算）', () => {
    for (const value of ['true', 1, 'yes', {}]) {
      expect(resolveStopAgentAuthIntent({ privileged: value }).ok).toBe(false);
    }
    expect(resolveStopAgentAuthIntent({ privileged: false }).ok).toBe(false);
  });

  it('sessionId 与 privileged 同时出现 ⇒ 拒绝（不允许隐式提权）', () => {
    const intent = resolveStopAgentAuthIntent({
      sessionId: 'sess-1',
      privileged: true,
    });
    expect(intent.ok).toBe(false);
    if (!intent.ok) expect(intent.reason).toContain('不可同时');
  });

  it('非对象 / 非字符串 sessionId ⇒ 按缺失处理（fail-closed）', () => {
    for (const body of [[], ['s'], { sessionId: 123 }, { sessionId: '   ' }]) {
      expect(resolveStopAgentAuthIntent(body).ok).toBe(false);
    }
  });
});
