/**
 * 工具调用纠偏（2026-11-01，从 `ReActToolLoop` 外移）。
 *
 * 钉住两条软纠偏的**触发边界**（都通过注入的宿主回调，不依赖真实循环）：
 *   ① 相邻两轮工具名+参数完全一致 ⇒ 注入"改用不同参数"的纠偏；
 *   ② 跨轮重读本会话已读文件（参数只差 offset/limit）⇒ 注入"已读过"的锚定，且每路径仅一次；
 *   ③ 普通推进（不同工具 / 首次读） ⇒ 不注入、不让路。
 */
import { describe, expect, it } from 'bun:test';
import { ToolCallCorrection } from '../../src/chat/manager/toolCallCorrection';

function makeGuard() {
  const reminders: string[] = [];
  let turn = 1;
  let pending = 0;
  const guard = new ToolCallCorrection({
    argsKey: (input) => JSON.stringify(input),
    getToolTurn: () => turn,
    getSessionId: () => 's1',
    pushReminder: (text) => reminders.push(text),
    markCorrectionPending: () => {
      pending += 1;
    },
  });
  return {
    guard,
    reminders,
    setTurn: (t: number) => {
      turn = t;
    },
    pendingCount: () => pending,
  };
}

describe('工具调用纠偏', () => {
  it('首次读取 / 正常换工具 ⇒ 不注入、不让路', () => {
    const h = makeGuard();
    h.guard.evaluate([{ name: 'file_read', input: { path: 'a.md' } }]);
    h.setTurn(2);
    h.guard.evaluate([{ name: 'grep', input: { pattern: 'x' } }]);

    expect(h.reminders).toHaveLength(0);
    expect(h.pendingCount()).toBe(0);
  });

  it('相邻两轮完全一致 ⇒ 注入"改用不同参数"纠偏，并让路一次', () => {
    const h = makeGuard();
    const calls = [{ name: 'file_read', input: { path: 'a.md' } }];
    h.guard.evaluate(calls);
    h.guard.evaluate(calls);

    expect(h.reminders).toHaveLength(1);
    expect(h.reminders[0]).toContain('完全相同的工具');
    expect(h.pendingCount()).toBe(1);
  });

  it('跨轮重读同一文件（参数只差 offset）⇒ 注入"已读过"锚定，每路径仅一次', () => {
    const h = makeGuard();
    h.guard.evaluate([{ name: 'file_read', input: { path: 'a.md' } }]);
    h.setTurn(3);
    h.guard.evaluate([
      { name: 'file_read', input: { path: 'a.md', offset: 200 } },
    ]);

    expect(h.reminders).toHaveLength(1);
    expect(h.reminders[0]).toContain('a.md');
    expect(h.reminders[0]).toContain('第 1 轮已读');
    expect(h.pendingCount()).toBe(1);

    // 第 5 轮再读同一文件 ⇒ 已提示过，不再注入
    h.setTurn(5);
    h.guard.evaluate([
      { name: 'file_read', input: { path: 'a.md', offset: 400 } },
    ]);
    expect(h.reminders).toHaveLength(1);
  });
});
