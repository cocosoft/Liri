// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-11（P1）：单条 assistant 删除的**结构性守卫**。
 *
 * 真机缺陷：守卫只看投影消息上的 `metadata.tool_calls`/`blocks`，而服务层对象可能不含
 * `blocks` ⇒ 携带工具卡片的消息被放行删除。现改为以**派生结果**收集声明的 toolCallId，
 * 并检查是否仍有 tool 结果引用；派生不可用 ⇒ fail-closed（409）。
 */
import { describe, expect, it } from 'bun:test';
import { MessageMutation } from '@openliri/service/runtime/api/messageMutation';

type Msg = Record<string, unknown>;

function buildMutation(options: {
  messages: Msg[];
  derived: Msg[] | null | Error;
  deleted: string[];
}) {
  const gateway = {
    getMessages: async () => options.messages,
    deleteMessages: async (_sid: string, ids: string[]) => {
      options.deleted.push(...ids);
    },
    getSession: async () => null,
    updateSession: async () => undefined,
  };
  return new MessageMutation({
    getChatManager: () =>
      ({
        getSessionGateway: () => gateway,
      }) as never,
    getSessionManager: () =>
      ({
        getSession: () => undefined,
        updateSession: () => undefined,
      }) as never,
    getCleanupOrphanAttachments: () => async () => undefined,
    getDeriveSessionMessagesFromEvents: () => async () => {
      if (options.derived instanceof Error) throw options.derived;
      return options.derived;
    },
  });
}

describe('deleteMessage：assistant 工具归属守卫', () => {
  it('派生消息声明了 tool_calls（投影对象无 blocks）⇒ 拒绝 400', async () => {
    const deleted: string[] = [];
    const mutation = buildMutation({
      messages: [{ id: 'a1', role: 'assistant', content: '' }],
      derived: [
        {
          id: 'a1',
          role: 'assistant',
          lastEventSeq: 10,
          metadata: { tool_calls: [{ id: 'call_1' }] },
        },
      ],
      deleted,
    });
    await expect(mutation.deleteMessage('s1', 'a1')).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(deleted).toEqual([]);
  });

  it('tool 结果仍引用该消息声明的 id ⇒ 拒绝 400', async () => {
    const deleted: string[] = [];
    const mutation = buildMutation({
      messages: [
        { id: 'a2', role: 'assistant', content: '' },
        { id: 't2', role: 'tool', content: 'x', toolCallId: 'call_2' },
      ],
      derived: [
        {
          id: 'a2',
          role: 'assistant',
          lastEventSeq: 11,
          blocks: [{ type: 'tool_call', toolCallId: 'call_2' }],
        },
        { id: 't2', role: 'tool', lastEventSeq: 12, toolCallId: 'call_2' },
      ],
      deleted,
    });
    await expect(mutation.deleteMessage('s1', 'a2')).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(deleted).toEqual([]);
  });

  it('派生不可用 ⇒ fail-closed 409（无法证明无归属就不删）', async () => {
    const deleted: string[] = [];
    const mutation = buildMutation({
      messages: [{ id: 'a3', role: 'assistant', content: '' }],
      derived: new Error('derive down'),
      deleted,
    });
    await expect(mutation.deleteMessage('s1', 'a3')).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(deleted).toEqual([]);
  });

  it('纯文本助手消息 ⇒ 放行并只删这一条', async () => {
    const deleted: string[] = [];
    const mutation = buildMutation({
      messages: [
        { id: 'a4', role: 'assistant', content: '重复提示' },
        { id: 'u4', role: 'user', content: '下一个问题' },
      ],
      derived: [{ id: 'a4', role: 'assistant', lastEventSeq: 20 }],
      deleted,
    });
    const result = await mutation.deleteMessage('s1', 'a4');
    expect(result.success).toBe(true);
    expect(deleted).toEqual(['a4']);
  });
});
