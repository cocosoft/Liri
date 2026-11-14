/**
 * G4 接线回归锁（2026-11-14）：`/rewind`（别名 `/undo`）目标选择 + 编排。
 *
 * 背景：方案 G4 原判「主工作区无执行前备份/undo」不成立 —— `security/rollback` 的
 * 轮快照 + 文件级联回滚早已接线；真正缺口是命令调用**不存在的**
 * `chatManager.rewindSession`（入口是死的）。本文件锁住新实现的三条口径：
 *   ① 步数语义 = 倒数第 N 个**用户消息**作为截断起点；
 *   ② 只允许回退到用户消息（与服务端 `truncateMessages` 约束同口径）；
 *   ③ 执行只调既有 `truncateMessages`（不重造快照/回滚逻辑），失败如实返回。
 */
import { describe, expect, it } from 'bun:test';
import {
  runRewind,
  selectRewindTargetByMessage,
  selectRewindTargetBySteps,
  type RewindMessageLike,
  type RewindTruncateResult,
} from '@modules/commands/builtin/rewind/rewindCore';

const messages: RewindMessageLike[] = [
  { id: 'u1', role: 'user' },
  { id: 'a1', role: 'assistant' },
  { id: 'u2', role: 'user' },
  { id: 'a2', role: 'assistant' },
];

describe('G4：回退目标选择（步数）', () => {
  it('steps=1 ⇒ 最近一个用户消息；steps=2 ⇒ 倒数第二个', () => {
    expect(selectRewindTargetBySteps(messages, 1)).toEqual({
      ok: true,
      messageId: 'u2',
    });
    expect(selectRewindTargetBySteps(messages, 2)).toEqual({
      ok: true,
      messageId: 'u1',
    });
  });

  it('超出可回退轮次 ⇒ 明确报错（不静默回退到最早）', () => {
    expect(selectRewindTargetBySteps(messages, 3)).toEqual({
      ok: false,
      error: '最多可回退 2 步（请求 3 步）',
    });
  });

  it('非法步数 / 无用户消息 ⇒ 报错', () => {
    expect(selectRewindTargetBySteps(messages, 0).ok).toBe(false);
    expect(selectRewindTargetBySteps(messages, -1).ok).toBe(false);
    expect(selectRewindTargetBySteps(messages, 1.5).ok).toBe(false);
    expect(selectRewindTargetBySteps([], 1)).toEqual({
      ok: false,
      error: '当前会话没有可回退的用户消息',
    });
  });
});

describe('G4：回退目标选择（消息 id）', () => {
  it('用户消息 ⇒ 命中；首尾空白忽略', () => {
    expect(selectRewindTargetByMessage(messages, ' u1 ')).toEqual({
      ok: true,
      messageId: 'u1',
    });
  });

  it('助手消息 / 不存在 / 空 id ⇒ 报错', () => {
    expect(selectRewindTargetByMessage(messages, 'a1')).toEqual({
      ok: false,
      error: '只能回退到用户消息',
    });
    expect(selectRewindTargetByMessage(messages, 'nope')).toEqual({
      ok: false,
      error: '未找到消息 nope',
    });
    expect(selectRewindTargetByMessage(messages, '  ')).toEqual({
      ok: false,
      error: '消息 ID 不能为空',
    });
  });
});

describe('G4：执行编排（只调既有 truncateMessages）', () => {
  it('按步数 ⇒ 传入目标用户消息 id，并汇总文件回滚轮次', async () => {
    const calls: Array<[string, string]> = [];
    const truncate = async (
      sessionId: string,
      messageId: string
    ): Promise<RewindTruncateResult> => {
      calls.push([sessionId, messageId]);
      return {
        success: true,
        deletedMessageIds: ['u2', 'a2'],
        undoResults: [
          { roundId: 3, success: true },
          { roundId: 2, success: false, error: 'user modified' },
        ],
      };
    };

    const outcome = await runRewind({
      sessionId: 's1',
      messages,
      steps: 1,
      truncate,
    });

    expect(calls).toEqual([['s1', 'u2']]);
    expect(outcome.ok).toBe(true);
    expect(outcome.messageId).toBe('u2');
    expect(outcome.deletedMessageIds).toEqual(['u2', 'a2']);
    // 只统计**成功**的文件回滚轮次
    expect(outcome.undoneRounds).toBe(1);
  });

  it('按消息 id ⇒ 同一执行路径；缺省 steps=1', async () => {
    const seen: string[] = [];
    const truncate = async (_sid: string, messageId: string) => {
      seen.push(messageId);
      return { success: true, deletedMessageIds: [messageId] };
    };

    const byId = await runRewind({
      sessionId: 's1',
      messages,
      messageId: 'u1',
      truncate,
    });
    expect(byId.ok).toBe(true);
    expect(seen).toEqual(['u1']);

    const byDefault = await runRewind({ sessionId: 's1', messages, truncate });
    expect(byDefault.messageId).toBe('u2');
  });

  it('截断抛错 ⇒ 如实返回（不假装成功）', async () => {
    const outcome = await runRewind({
      sessionId: 's1',
      messages,
      steps: 1,
      truncate: async () => {
        throw new Error('Cannot rollback while streaming');
      },
    });
    expect(outcome).toEqual({
      ok: false,
      error: 'Cannot rollback while streaming',
    });
  });

  it('无会话 / 目标非法 ⇒ 不调用 truncate', async () => {
    let called = 0;
    const truncate = async () => {
      called += 1;
      return { success: true };
    };

    expect(await runRewind({ sessionId: '', messages, truncate })).toEqual({
      ok: false,
      error: '当前没有活动会话',
    });
    expect(
      await runRewind({ sessionId: 's1', messages: [], steps: 1, truncate })
    ).toEqual({ ok: false, error: '当前会话没有可回退的用户消息' });
    expect(called).toBe(0);
  });
});
