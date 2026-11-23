// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 「等待审批」提示去重（P3-2/T1，2026-11-16）
 *
 * 真机 `session_mwgj38hv0f7434c756`：90 条转录里 79 条是同一句「⏸ 等待你的审批」。
 * 非流式路径原判据只看**末条 assistant** 的 `finishReason`；而用户批准后 TAOR 会先落
 * 一条新的 assistant(tool_calls)（无 finishReason）⇒ 判据失效 ⇒ 再写一条提示。
 *
 * 本文件锁三件事：
 *   ① 本轮已有提示（无论它后面是否又落了 assistant(tool_calls) / tool 结果）⇒ 不再写；
 *   ② 新提问（`user`）后的首次暂停 ⇒ 必须写；
 *   ③ 写入的提示仍带 `finishReason: 'awaiting_approval'`（落盘语义不变）。
 */
import { describe, expect, it } from 'bun:test';
import { AWAITING_APPROVAL_NOTICE } from '@shared/types';
import {
  ensureAwaitingApprovalNotice,
  hasPriorApprovalNoticeThisTurn,
} from '../../src/chat/orchestrator/awaitingApprovalNotice';
import { clearAwaitingApprovalTurnMarkers } from '../../src/chat/terminationOutput';
import type { Message } from '@modules/session/types/message.js';

function notice(id: string): Message {
  return {
    id,
    role: 'assistant',
    content: AWAITING_APPROVAL_NOTICE,
    metadata: { finishReason: 'awaiting_approval' },
  } as unknown as Message;
}

/** TAOR 续跑先落的那条「带 tool_calls、没有 finishReason」的 assistant */
function toolCallAssistant(id: string): Message {
  return {
    id,
    role: 'assistant',
    content: '',
    metadata: {},
    tool_calls: [{ id: 'tc-1', name: 'bash', arguments: '{}' }],
  } as unknown as Message;
}

function user(id: string): Message {
  return { id, role: 'user', content: '继续' } as unknown as Message;
}

function toolResult(id: string): Message {
  return { id, role: 'tool', content: '{"status":"ok"}' } as unknown as Message;
}

describe('hasPriorApprovalNoticeThisTurn', () => {
  it('本轮已有提示，且其后又落了一条 assistant(tool_calls) ⇒ 仍判定为已提示', () => {
    const messages = [
      user('u1'),
      notice('a-notice'),
      toolCallAssistant('a-tc'),
    ];
    expect(hasPriorApprovalNoticeThisTurn(messages)).toBe(true);
  });

  it('提示后面还有工具结果与多轮 assistant ⇒ 仍判定为已提示（不会被本轮产物挡住）', () => {
    const messages = [
      user('u1'),
      notice('a-notice'),
      toolResult('t1'),
      toolCallAssistant('a-tc1'),
      toolResult('t2'),
      toolCallAssistant('a-tc2'),
    ];
    expect(hasPriorApprovalNoticeThisTurn(messages)).toBe(true);
  });

  it('新提问之后没有提示 ⇒ 不判定为已提示（首次暂停必须写）', () => {
    expect(
      hasPriorApprovalNoticeThisTurn([user('u1'), toolCallAssistant('a-tc')])
    ).toBe(false);
    expect(hasPriorApprovalNoticeThisTurn([user('u1')])).toBe(false);
  });

  it('只认本轮：上一轮（更早的 user 之前）的提示不抑制本轮', () => {
    const messages = [
      user('u-old'),
      notice('a-old-notice'),
      user('u-new'),
      toolCallAssistant('a-new-tc'),
    ];
    expect(hasPriorApprovalNoticeThisTurn(messages)).toBe(false);
  });

  it('无 finishReason 但正文以同一提示结尾 ⇒ 也视为已提示（兼容旧落盘）', () => {
    const legacy = {
      id: 'a-legacy',
      role: 'assistant',
      content: `\n\n${AWAITING_APPROVAL_NOTICE}`,
    } as unknown as Message;
    expect(hasPriorApprovalNoticeThisTurn([user('u1'), legacy])).toBe(true);
  });

  it('currentId 命中的消息被跳过（不把自身当已有提示）', () => {
    const messages = [user('u1'), notice('a-notice')];
    expect(hasPriorApprovalNoticeThisTurn(messages, 'a-notice')).toBe(false);
  });

  it('空消息 / undefined ⇒ false', () => {
    expect(hasPriorApprovalNoticeThisTurn([])).toBe(false);
    expect(hasPriorApprovalNoticeThisTurn(undefined)).toBe(false);
  });
});

describe('ensureAwaitingApprovalNotice', () => {
  function makeDeps(messages: Message[], currentId?: string) {
    const persisted: Message[] = [];
    return {
      persisted,
      deps: {
        messages,
        currentId,
        sessionId: 'sess-1',
        createAssistantMessage: (content: string) =>
          ({
            id: `notice-${persisted.length + 1}`,
            role: 'assistant',
            content,
            metadata: {},
          }) as unknown as Message,
        addAndPersistMessage: (_sessionId: string, m: Message) => {
          persisted.push(m);
        },
      },
    };
  }

  it('首次暂停 ⇒ 写一条，且 metadata.finishReason 落盘', () => {
    const { deps, persisted } = makeDeps([user('u1')]);
    const written = ensureAwaitingApprovalNotice(deps);

    expect(written).toBeDefined();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].content).toBe(AWAITING_APPROVAL_NOTICE);
    expect(persisted[0].metadata?.finishReason).toBe('awaiting_approval');
  });

  it('连续暂停（中间夹着 assistant(tool_calls)）⇒ 只写一次', () => {
    const { deps, persisted } = makeDeps([
      user('u1'),
      notice('a-notice'),
      toolCallAssistant('a-tc'),
    ]);
    const written = ensureAwaitingApprovalNotice(deps);

    expect(written).toBeUndefined();
    expect(persisted).toHaveLength(0);
  });

  it('新提问后再次暂停 ⇒ 再写一条（不跨轮抑制）', () => {
    const { deps, persisted } = makeDeps([
      user('u-old'),
      notice('a-old'),
      user('u-new'),
      toolCallAssistant('a-tc'),
    ]);
    const written = ensureAwaitingApprovalNotice(deps);

    expect(written).toBeDefined();
    expect(persisted).toHaveLength(1);
  });
});

/**
 * 2026-11-24（真机 `session_mwrf18pu00456e0f2b`）：审批通过后的续跑必须把上一轮
 * 「因等待审批收尾」的标记与正文提示一起清掉，否则会话被反复写回 `requires_action`。
 */
describe('clearAwaitingApprovalTurnMarkers（续跑清理陈旧审批标记）', () => {
  it('metadata + 顶层标记与正文提示一并清除，其它字段保持', () => {
    const { message, changed } = clearAwaitingApprovalTurnMarkers({
      role: 'assistant',
      content: `正文\n\n${AWAITING_APPROVAL_NOTICE}`,
      finishReason: 'awaiting_approval',
      terminationReason: 'awaiting_approval',
      metadata: {
        finishReason: 'awaiting_approval',
        terminationReason: 'awaiting_approval',
        model: 'm-1',
      },
    });

    expect(changed).toBe(true);
    expect(message.content).toBe('正文');
    expect(message.finishReason).toBeUndefined();
    expect(message.terminationReason).toBeUndefined();
    expect(message.metadata?.finishReason).toBeUndefined();
    expect(message.metadata?.terminationReason).toBeUndefined();
    expect(message.metadata?.model).toBe('m-1');
  });

  it('text 块里的提示同样剥离', () => {
    const { message, changed } = clearAwaitingApprovalTurnMarkers({
      role: 'assistant',
      content: '',
      metadata: { finishReason: 'awaiting_approval' },
      blocks: [
        { type: 'text', content: `正文\n\n${AWAITING_APPROVAL_NOTICE}` },
        { type: 'tool_call', content: 'bash' },
      ],
    });

    expect(changed).toBe(true);
    const blocks = message.blocks as Array<{
      type?: string;
      content?: unknown;
    }>;
    expect(blocks[0].content).toBe('正文');
    // 非 text 块原样保留
    expect(blocks[1]).toEqual({ type: 'tool_call', content: 'bash' });
  });

  it('无审批标记 / 无提示 ⇒ changed=false（不产生多余写盘）', () => {
    const { changed } = clearAwaitingApprovalTurnMarkers({
      role: 'assistant',
      content: '正常回复',
      finishReason: 'stop',
      metadata: { finishReason: 'stop' },
    });
    expect(changed).toBe(false);
  });
});
