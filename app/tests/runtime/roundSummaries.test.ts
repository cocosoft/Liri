/**
 * B2（2026-10-30，一致性核查 §9.4）：按轮摘要的**服务端**实现单测。
 *
 * 锁定三件事：
 *  ① 切分口径 —— 一条 user 消息开启一轮，`roundIndex` 是**绝对轮号**；
 *  ② 文本口径 —— 换行归一 + 60 字截断补 `…`；助手文本 `blocks.text` 优先，
 *     工具循环里的"无正文助手消息"不覆盖已有摘要；
 *  ③ 供给口径 —— `getSessionRoundSummaries` **一次**全量读取即可覆盖整会话
 *     （不为每轮各读一次），裁剪时 `roundIndex` 仍是绝对轮号、`hasMore` 为真。
 */
import { describe, it, expect } from 'bun:test';

import {
  ROUND_SUMMARY_MAX_CHARS,
  ROUND_SUMMARY_MAX_ROUNDS_PER_REQUEST,
  buildSessionRoundSummaries,
  summarizeRoundText,
  type RoundSummarySourceMessage,
} from '../../src/runtime/api/roundSummaries.js';
import { SessionMessagesRead } from '../../src/runtime/api/sessionMessagesRead.js';
import type { ChatManager } from '@modules/chat';
import type { SessionManager } from '../../src/session/types/session.js';

function msg(
  id: string,
  role: string,
  content: string,
  extra: Partial<RoundSummarySourceMessage> = {}
): RoundSummarySourceMessage {
  return { id, role, content, timestamp: 1_700_000_000_000, ...extra };
}

describe('summarizeRoundText（B2 文本口径）', () => {
  it('换行归一为空格并 trim', () => {
    expect(summarizeRoundText('第一行\n\n  第二行  ')).toBe('第一行 第二行');
  });

  it('超长截断到 60 字并补省略号', () => {
    const out = summarizeRoundText('啊'.repeat(ROUND_SUMMARY_MAX_CHARS + 5));
    expect(out.length).toBe(ROUND_SUMMARY_MAX_CHARS + 1);
    expect(out.endsWith('…')).toBe(true);
  });

  it('空文本返回空串（兜底文案由前端决定，服务端不产出）', () => {
    expect(summarizeRoundText(undefined)).toBe('');
    expect(summarizeRoundText('   \n ')).toBe('');
  });
});

describe('buildSessionRoundSummaries（B2 切分口径）', () => {
  it('user 开启一轮、assistant 填回复，轮号为绝对轮号', () => {
    const { rounds, totalRounds } = buildSessionRoundSummaries([
      msg('u1', 'user', '第一个问题'),
      msg('a1', 'assistant', '第一个回答'),
      msg('u2', 'user', '第二个问题'),
      msg('a2', 'assistant', '第二个回答'),
    ]);
    expect(totalRounds).toBe(2);
    expect(rounds).toEqual([
      {
        roundIndex: 1,
        userMsgId: 'u1',
        userMsg: '第一个问题',
        assistantMsg: '第一个回答',
        timestamp: 1_700_000_000_000,
      },
      {
        roundIndex: 2,
        userMsgId: 'u2',
        userMsg: '第二个问题',
        assistantMsg: '第二个回答',
        timestamp: 1_700_000_000_000,
      },
    ]);
  });

  it('助手文本取 blocks 的 text 块，且工具循环的无正文消息不覆盖已有摘要', () => {
    const { rounds } = buildSessionRoundSummaries([
      msg('u1', 'user', '问题'),
      msg('a1', 'assistant', '', {
        blocks: [
          { id: 'b1', type: 'text', content: '第一段' },
          { id: 'b2', type: 'tool_call', content: '' },
          { id: 'b3', type: 'text', content: '第二段' },
        ],
      }),
      // 工具循环里的续写消息：没有正文 ⇒ 不应把摘要清空
      msg('a2', 'assistant', '', {
        blocks: [{ id: 'b4', type: 'tool_call', content: '' }],
      }),
    ]);
    expect(rounds[0].assistantMsg).toBe('第一段 第二段');
  });

  it('无 user 的消息（如 system / 孤儿工具结果）不产生轮次', () => {
    const { rounds, totalRounds } = buildSessionRoundSummaries([
      msg('s1', 'system', '系统提示'),
      msg('t1', 'tool', '工具结果'),
    ]);
    expect(rounds).toEqual([]);
    expect(totalRounds).toBe(0);
  });

  it('maxRounds 只保留最近 N 轮，但 roundIndex 仍是绝对轮号', () => {
    const messages: RoundSummarySourceMessage[] = [];
    for (let i = 1; i <= 5; i++) {
      messages.push(msg(`u${i}`, 'user', `问题 ${i}`));
      messages.push(msg(`a${i}`, 'assistant', `回答 ${i}`));
    }
    const { rounds, totalRounds } = buildSessionRoundSummaries(messages, {
      maxRounds: 2,
    });
    expect(totalRounds).toBe(5);
    expect(rounds.map((r) => r.roundIndex)).toEqual([4, 5]);
  });
});

describe('SessionMessagesRead.getSessionRoundSummaries（B2 供给口径）', () => {
  function makeSubject(messages: RoundSummarySourceMessage[]) {
    const read = new SessionMessagesRead({
      getChatManager: () => ({}) as unknown as ChatManager,
      getSessionManager: () => ({}) as unknown as SessionManager,
      getFilterDeletedRanges: () => (_sid, list) => list,
    });
    let calls = 0;
    (
      read as unknown as {
        getSessionMessages: () => Promise<{
          messages: RoundSummarySourceMessage[];
          hasMore: boolean;
        }>;
      }
    ).getSessionMessages = async () => {
      calls += 1;
      return { messages, hasMore: false };
    };
    return { read, calls: () => calls };
  }

  const messages: RoundSummarySourceMessage[] = [
    msg('u1', 'user', '问题一'),
    msg('a1', 'assistant', '回答一'),
    msg('u2', 'user', '问题二'),
    msg('a2', 'assistant', '回答二'),
  ];

  it('一次读取即覆盖整会话（不为每轮各读一次）', async () => {
    const { read, calls } = makeSubject(messages);
    const out = await read.getSessionRoundSummaries('session_b2_test');
    expect(calls()).toBe(1);
    expect(out.totalRounds).toBe(2);
    expect(out.hasMore).toBe(false);
    expect(out.rounds.map((r) => r.userMsgId)).toEqual(['u1', 'u2']);
  });

  it('limit 裁剪时 roundIndex 仍为绝对轮号，hasMore 为真', async () => {
    const { read } = makeSubject(messages);
    const out = await read.getSessionRoundSummaries('session_b2_test', {
      limit: 1,
    });
    expect(out.rounds).toHaveLength(1);
    expect(out.rounds[0].roundIndex).toBe(2);
    expect(out.hasMore).toBe(true);
  });

  it('limit 超上限时按上限收敛', async () => {
    const { read } = makeSubject(messages);
    const out = await read.getSessionRoundSummaries('session_b2_test', {
      limit: ROUND_SUMMARY_MAX_ROUNDS_PER_REQUEST + 10_000,
    });
    expect(out.totalRounds).toBe(2);
  });
});
