/**
 * `/effort` 会话元数据落库测试（2026-10-22 后端接线）
 *
 * 接线前：命令只写 `context.environment.EFFORT_LEVEL`（仅 REPL 读），
 * 会话里没有任何持久化痕迹 ⇒ 聊天链路无法得知用户设过档位。
 * 现在：有会话上下文 ⇒ 同时写
 *   ① 内存会话对象（下一次发消息读的就是它）
 *   ② 持久层（`SessionGateway.updateSession`）
 * 并带上预留字段 `thinkingBudget`（`auto` ⇒ 清掉）。
 */
import { describe, it, expect } from 'bun:test';

import effortCommand from '../../src/commands/builtin/effort/Effort';
import type { CommandContext } from '../../src/commands/types';

interface FakeSession {
  id: string;
  metadata: Record<string, unknown>;
}

/** 用假的 chatManager 记录写入位置（内存 / 持久层各一份） */
function makeHost(initial: Record<string, unknown> = {}) {
  const memory: FakeSession = { id: 's-1', metadata: { ...initial } };
  const stored: FakeSession = { id: 's-1', metadata: { ...initial } };
  const updates: Array<Record<string, unknown>> = [];

  const chatManager = {
    getSessions: () => [memory],
    getSessionGateway: () => ({
      getSession: async (id: string) => (id === stored.id ? stored : null),
      updateSession: async (session: unknown) => {
        updates.push({ ...(session as FakeSession).metadata });
      },
    }),
  };

  return { memory, stored, updates, chatManager };
}

function makeContext(
  chatManager?: unknown,
  overrides: Partial<CommandContext> = {}
): CommandContext {
  return {
    sessionId: 's-1',
    chatManager,
    ...overrides,
  } as unknown as CommandContext;
}

describe('/effort：写会话元数据', () => {
  it('设置 high ⇒ 内存与持久层都写入，并带预留预算 32000', async () => {
    const { memory, stored, updates, chatManager } = makeHost();

    const result = await effortCommand.execute(
      'high',
      makeContext(chatManager)
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ level: 'high', sessionApplied: true });
    expect(memory.metadata.effortLevel).toBe('high');
    expect(memory.metadata.thinkingBudget).toBe(32000);
    expect(stored.metadata.effortLevel).toBe('high');
    expect(updates).toHaveLength(1);
    expect(updates[0].effortLevel).toBe('high');
  });

  it('设置 auto ⇒ 清掉预留预算（不留下与档位不符的旧值）', async () => {
    const { memory, stored, chatManager } = makeHost({
      effortLevel: 'high',
      thinkingBudget: 32000,
    });

    await effortCommand.execute('auto', makeContext(chatManager));

    expect(memory.metadata.effortLevel).toBe('auto');
    expect('thinkingBudget' in memory.metadata).toBe(false);
    expect(stored.metadata.effortLevel).toBe('auto');
    expect('thinkingBudget' in stored.metadata).toBe(false);
  });

  it('无会话上下文 ⇒ 不写会话，明确告知只影响本次 REPL', async () => {
    const environment: Record<string, string> = {};
    const result = await effortCommand.execute(
      'low',
      makeContext(undefined, { sessionId: undefined, environment })
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ level: 'low', sessionApplied: false });
    expect(result.message).toContain('仅对本次 REPL 生效');
    expect(environment.EFFORT_LEVEL).toBe('low');
  });

  it('非法档位 ⇒ 报错且不触达会话', async () => {
    const { updates, chatManager } = makeHost();

    const result = await effortCommand.execute(
      'xhigh',
      makeContext(chatManager)
    );

    expect(result.success).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('show ⇒ 优先回显会话里的档位', async () => {
    const { chatManager } = makeHost({ effortLevel: 'medium' });

    const result = await effortCommand.execute(
      'show',
      makeContext(chatManager)
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ level: 'medium' });
  });
});
