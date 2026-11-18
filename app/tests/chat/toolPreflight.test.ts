// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `evaluateToolPreflight` 的特征化测试（2026-11-17，T3 复杂度清理 stage 2）。
 *
 * 背景：两段入口拒绝逻辑（渠道来源 Taint / 用户「拒绝」终态）原先内联在
 * `ToolExecutionService._executeInternal`，现搬出为不依赖 `this` 的函数
 * （`app/src/chat/services/toolPreflight.ts`）并直接单测。
 *
 * 钉住的行为：
 *  ① 可信会话 + 未被拒绝 ⇒ `null`（放行）；
 *  ② 不可信会话 + 有副作用工具（本地写 / 外部命令 / 未声明效果）⇒ `UNTRUSTED_ORIGIN` 拒绝；
 *  ③ 不可信会话 + 只读工具（`sideEffect: 'none'`）⇒ 放行；
 *  ④ 用户已拒绝 ⇒ `USER_DENIED` 终态（`failureKind: permission_denied` + `userDenied` 标记）；
 *  ⑤ `isUntrustedSession` 为惰性 getter，每次求值只调用一次。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import * as permission from '@openliri/infra/permission';
import { evaluateToolPreflight } from '../../src/chat/services/toolPreflight';

const spies: Array<{ mockRestore: () => void }> = [];

function denyAll() {
  const s = spyOn(permission, 'isToolCallDenied').mockReturnValue(true);
  spies.push(s as unknown as { mockRestore: () => void });
  return s as unknown as { mock: { calls: unknown[][] } };
}

afterEach(() => {
  for (const s of spies.splice(0, spies.length)) s.mockRestore();
});

describe('evaluateToolPreflight：入口拒绝守卫（特征化）', () => {
  it('① 可信会话 + 未被拒绝 ⇒ 放行（null）', () => {
    const result = evaluateToolPreflight({
      toolCall: { id: 'call-1', name: 'file_write', sessionId: 's1' },
      isUntrustedSession: () => false,
    });

    expect(result).toBeNull();
  });

  it('② 不可信会话 + 本地写工具 ⇒ UNTRUSTED_ORIGIN 拒绝', () => {
    const result = evaluateToolPreflight({
      toolCall: { id: 'call-2', name: 'file_write', sessionId: 's2' },
      isUntrustedSession: () => true,
    });

    expect(result).toMatchObject({
      toolCallId: 'call-2',
      toolName: 'file_write',
      result: { blocked: true, reason: 'UNTRUSTED_ORIGIN' },
    });
    expect(String(result?.error)).toContain('不可信来源');
  });

  it('② 不可信会话 + 外部命令工具 ⇒ 同样拒绝', () => {
    const result = evaluateToolPreflight({
      toolCall: { id: 'call-3', name: 'bash', sessionId: 's3' },
      isUntrustedSession: () => true,
    });

    expect(result?.result).toMatchObject({ reason: 'UNTRUSTED_ORIGIN' });
  });

  it('③ 不可信会话 + 只读工具 ⇒ 放行', () => {
    const result = evaluateToolPreflight({
      toolCall: { id: 'call-4', name: 'file_read', sessionId: 's4' },
      isUntrustedSession: () => true,
    });

    expect(result).toBeNull();
  });

  it('④ 用户已拒绝 ⇒ USER_DENIED 终态（结构化失败类别 + 标记）', () => {
    const denied = denyAll();

    const result = evaluateToolPreflight({
      toolCall: { id: 'call-5', name: 'file_write', sessionId: 's5' },
      isUntrustedSession: () => false,
    });

    expect(denied.mock.calls).toEqual([['s5', 'call-5']]);
    expect(result).toMatchObject({
      result: { denied: true, reason: 'USER_DENIED' },
      failureKind: 'permission_denied',
      metadata: { userDenied: true },
    });
    expect(String(result?.error)).toContain('用户拒绝');
  });

  it('⑤ isUntrustedSession 为惰性 getter：每次求值只调用一次', () => {
    let calls = 0;

    evaluateToolPreflight({
      toolCall: { id: 'call-6', name: 'file_read', sessionId: 's6' },
      isUntrustedSession: () => {
        calls++;
        return true;
      },
    });

    expect(calls).toBe(1);
  });
});
