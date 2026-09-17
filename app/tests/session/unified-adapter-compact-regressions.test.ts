// MIT License
// Copyright (c) 2026 190615273@qq.com

import { describe, it, expect } from 'bun:test';
import { UnifiedStorageAdapter } from '../../src/session/storage/UnifiedStorageAdapter';
import type { UnifiedSessionStorage } from '../../src/session/storage/UnifiedStorage';
import { AppError } from '../../src/error/types';
import { createChatManagerTAORDeps } from '../../src/query/ChatManagerTAORAdapter';
import type { ChatManagerTAORContext } from '../../src/query/ChatManagerTAORAdapter';

/**
 * M3 回归：UnifiedStorageAdapter.compactSession 由静默 no-op 改为显式抛
 * UnsupportedOperationError —— 调用方不再误以为压缩已生效。
 */
describe('M3 — UnifiedStorageAdapter.compactSession 显式失败', () => {
  it('compactSession 抛 AppError 而非静默 no-op', async () => {
    const storage: UnifiedSessionStorage = {
      getMessages: async () => [],
    } as unknown as UnifiedSessionStorage;
    const adapter = new UnifiedStorageAdapter(storage);

    await expect(adapter.compactSession('s1')).rejects.toThrow(AppError);
  });

  it('错误 code 标记为 UNSUPPORTED_OPERATION（业务可识别）', async () => {
    const storage: UnifiedSessionStorage = {
      getMessages: async () => [],
    } as unknown as UnifiedSessionStorage;
    const adapter = new UnifiedStorageAdapter(storage);

    try {
      await adapter.compactSession('s1');
      // 应抛错；若走到这里，用标志断言（bun no-explicit-any 无 expect.unreachable）
      throw new Error('compactSession 未抛错');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('UNSUPPORTED_OPERATION');
    }
  });
});

/**
 * P4 回归：非流式路径（TAOR 适配器 executeTools）工具结果含 _todoData 时
 * 产出 assistant/todo 事件落盘——此前从不提取，TaskCard 永不更新。
 */
describe('P4 — 非流式 TAOR 适配器产出 assistant/todo', () => {
  it('工具结果中含 _todoData 时调用 appendStreamEvent 落盘 todo 事件', async () => {
    const appended: Array<Record<string, unknown>> = [];
    const ctx: ChatManagerTAORContext = {
      sessionId: 'sess-1',
      toolDefinitions: [],
      toolRegistry: {
        getTool: () => undefined,
      },
      sendModelRequest: async () => ({ content: '' }),
      executeTool: async () =>
        ({
          result: {
            ok: true,
          },
          metadata: {
            _todoData: {
              title: '项目计划',
              phase: 'executing',
              tasks: [
                { id: 't1', name: '任务一', status: 'in_progress' },
                { id: 't2', name: '任务二', status: 'pending' },
              ],
            },
          },
        }) as never,
      persistMessage: () => {},
      appendStreamEvent: async (_sid, event) => {
        appended.push(event as unknown as Record<string, unknown>);
        return { ok: true };
      },
      onToolCall: () => {},
    };

    const deps = createChatManagerTAORDeps(ctx);
    const results = await deps.executeTools(
      [
        {
          id: 'tc-1',
          name: 'todo_write',
          arguments: {},
        },
      ],
      new AbortController().signal
    );

    // 工具正常执行成功
    expect(results).toHaveLength(1);
    // todo 事件已落盘
    expect(appended.length).toBeGreaterThanOrEqual(1);
    const todoEvent = appended[0] as Record<string, unknown>;
    expect(todoEvent.type).toBe('assistant/todo');
    const data = todoEvent.data as Record<string, unknown>;
    const taskCard = data.taskCard as Record<string, unknown>;
    expect(taskCard.title).toBe('项目计划');
    expect(taskCard.status).toBe('executing');
  });

  it('工具结果无 _todoData 时不产出 todo 事件', async () => {
    let appendedCount = 0;
    const ctx: ChatManagerTAORContext = {
      sessionId: 'sess-2',
      toolDefinitions: [],
      toolRegistry: {
        getTool: () => undefined,
      },
      sendModelRequest: async () => ({ content: '' }),
      executeTool: async () => ({ result: { text: '普通结果' } }) as never,
      persistMessage: () => {},
      appendStreamEvent: async (_sid, _event) => {
        appendedCount++;
        return { ok: true };
      },
      onToolCall: () => {},
    };

    const deps = createChatManagerTAORDeps(ctx);
    await deps.executeTools(
      [{ id: 'tc-1', name: 'read_file', arguments: {} }],
      new AbortController().signal
    );

    expect(appendedCount).toBe(0);
  });
});