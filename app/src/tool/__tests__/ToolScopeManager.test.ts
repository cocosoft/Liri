/**
 * ToolScopeManager 框架测试（T1.4）
 *
 * 1. 工具级 scope 在工具执行结束自动 dispose
 * 2. 会话级 scope 在会话销毁时 dispose（会话切换不触发）
 * 3. 订阅类副作用在工具结束、会话切换后仍存活（登记在会话级），仅在会话销毁时释放
 */

import { describe, test, expect } from 'bun:test';
import { ToolScopeManager } from '../ToolScopeManager.js';

describe('ToolScopeManager（T1.4）', () => {
  test('工具级 scope 在工具执行结束自动 dispose（短生命周期副作用释放）', async () => {
    const mgr = new ToolScopeManager();
    const sessionId = 's1';
    let released = 0;

    // 模拟一次工具执行
    const toolScope = mgr.startToolScope(sessionId);
    toolScope.onDispose(() => released++);
    expect(mgr.getCurrentToolScope()).toBe(toolScope);

    await mgr.endToolScope(toolScope);
    expect(released).toBe(1);
    // 工具结束后当前工具级 scope 已清除
    expect(mgr.getCurrentToolScope()).toBeUndefined();
  });

  test('会话级 scope 在会话销毁时 dispose（切换不触发）', async () => {
    const mgr = new ToolScopeManager();
    let sessionReleased = 0;

    // 会话 s1 执行一次工具（短生命周期）
    const toolScope = mgr.startToolScope('s1');
    toolScope.onDispose(() => {});
    // 长生命周期副作用：登记到会话级
    mgr.getSessionScope('s1').onDispose(() => sessionReleased++);
    await mgr.endToolScope(toolScope);

    // 会话"切换"（不销毁）：会话级 scope 仍存活
    expect(mgr.hasSessionScope('s1')).toBe(true);
    expect(sessionReleased).toBe(0);

    // 会话销毁：会话级 scope dispose，长生命周期副作用释放
    await mgr.disposeSession('s1');
    expect(sessionReleased).toBe(1);
    expect(mgr.hasSessionScope('s1')).toBe(false);

    // disposeSession 幂等
    await mgr.disposeSession('s1');
    expect(sessionReleased).toBe(1);
  });

  test('订阅类副作用在工具结束、会话切换后仍存活，仅在会话销毁时释放', async () => {
    const mgr = new ToolScopeManager();
    const sessionId = 's2';
    const released: string[] = [];

    // 第一次工具执行：短生命周期副作用登记工具级
    const tool1 = mgr.startToolScope(sessionId);
    tool1.onDispose(() => released.push('tool1'));
    // 订阅类副作用：提升登记到会话级
    mgr
      .getSessionScope(sessionId)
      .onDispose(() => released.push('session-sub'));
    await mgr.endToolScope(tool1);
    expect(released).toEqual(['tool1']); // 工具结束释放短生命周期

    // 会话切换（不销毁）：订阅仍存活
    expect(mgr.hasSessionScope(sessionId)).toBe(true);
    expect(released).toEqual(['tool1']);

    // 第二次工具执行（模拟切回后再次使用）
    const tool2 = mgr.startToolScope(sessionId);
    await mgr.endToolScope(tool2);
    expect(released).toEqual(['tool1']); // 订阅仍存活

    // 会话销毁：订阅释放
    await mgr.disposeSession(sessionId);
    expect(released).toEqual(['tool1', 'session-sub']);
  });
});
