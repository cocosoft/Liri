// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B7（2026-11-09，设计稿 §5-4）：demand 会话的歧义问询预算 —— 最多 1 次。
 *
 * 覆盖：
 *  - 记账后该会话的问询预算用尽（非 demand 会话恒不记账）；
 *  - 预算用尽 ⇒ 第二次提问走既有「自动答复」通道（不挂起、不伪造 open 输入）；
 *  - 预算未用 / 恢复态 / 非交互工具 ⇒ 零行为变更（照常等用户）。
 */

import { describe, expect, it } from 'bun:test';
import {
  autoAnswerUnattended,
  formatDemandAutoAnswerNotice,
  noteDemandAsk,
  resetDemandAskBudget,
  setDemandAskPersistHook,
  setDemandAutoAnswerNoticeHook,
} from '../../src/chat/interactionAutoApprove';
import { SessionMetadata } from '../../src/session/models/SessionMetadata';

const INTERACTIVE_TOOL = { requiresUserInteraction: () => true };
/** 每会话一份独立元数据（`noteDemandAsk` 会置位 `demandAskUsed`，共用对象会串扰） */
const demandMeta = (): Record<string, unknown> => ({ autonomy: 'demand' });
const INTERACTIVE = { autonomy: 'interactive' };

describe('B7：demand 会话问询预算记账', () => {
  it('记账后该会话的后续提问转代答', () => {
    const session = { id: 'sess-b7-budget', metadata: demandMeta() };
    const first = {
      id: 'tc-b7-first',
      name: 'ask_user_question',
      input: { questionType: 'choice', options: [{ label: '方案 A' }] },
    };
    // 首次提问：预算尚在 ⇒ 不代答（照常挂起等用户）
    expect(autoAnswerUnattended(INTERACTIVE_TOOL, first, session)).toBe(false);
    noteDemandAsk(session);
    // 第二次提问：预算已用尽 ⇒ 代答
    const second = {
      id: 'tc-b7-second',
      name: 'ask_user_question',
      input: { questionType: 'choice', options: [{ label: '方案 A' }] },
    };
    expect(autoAnswerUnattended(INTERACTIVE_TOOL, second, session)).toBe(true);
    expect((second.input as Record<string, unknown>)._userAnswers).toEqual([
      '方案 A',
    ]);
  });

  it('非 demand 会话记账无效（零行为变更）', () => {
    const session = { id: 'sess-b7-interactive', metadata: INTERACTIVE };
    noteDemandAsk(session);
    const call = {
      id: 'tc-b7-interactive',
      name: 'ask_user_question',
      input: { questionType: 'choice', options: [{ label: '方案 A' }] },
    };
    expect(autoAnswerUnattended(INTERACTIVE_TOOL, call, session)).toBe(false);
  });

  it('会话之间互不影响', () => {
    noteDemandAsk({ id: 'sess-b7-a', metadata: demandMeta() });
    const other = { id: 'sess-b7-b', metadata: demandMeta() };
    expect(
      autoAnswerUnattended(
        INTERACTIVE_TOOL,
        {
          id: 'tc-b7-b',
          name: 'ask_user_question',
          input: { questionType: 'choice', options: [{ label: '方案 B' }] },
        },
        other
      )
    ).toBe(false);
  });
});

describe('B7：预算用尽后的第二次提问', () => {
  it('open ⇒ 只注入显式占位（不伪造用户具体输入）', () => {
    const session = { id: 'sess-b7-open', metadata: demandMeta() };
    noteDemandAsk(session);
    const call = {
      id: 'tc-b7-open',
      name: 'ask_user_question',
      input: { questionType: 'open' },
    };
    expect(autoAnswerUnattended(INTERACTIVE_TOOL, call, session)).toBe(true);
    expect((call.input as Record<string, unknown>)._userAnswers).toEqual([
      '（无人值守自动通过：未提供具体输入，请按你的最佳判断继续）',
    ]);
  });

  it('恢复态（同一问询重放）不代答', () => {
    const session = { id: 'sess-b7-recovery', metadata: demandMeta() };
    noteDemandAsk(session);
    const call = {
      id: 'tc-b7-recovery',
      name: 'ask_user_question',
      input: { questionType: 'choice', options: [{ label: '方案 A' }] },
    };
    expect(autoAnswerUnattended(INTERACTIVE_TOOL, call, session, true)).toBe(
      false
    );
    expect('_userAnswers' in (call.input as Record<string, unknown>)).toBe(
      false
    );
  });

  it('非交互工具 ⇒ 永不代答', () => {
    const session = { id: 'sess-b7-plain', metadata: demandMeta() };
    noteDemandAsk(session);
    expect(
      autoAnswerUnattended(
        { requiresUserInteraction: () => false },
        { id: 'tc-b7-plain', name: 'bash', input: { command: 'ls' } },
        session
      )
    ).toBe(false);
  });
});

describe('B12：代答的用户可见留痕', () => {
  const ask = (id: string) => ({
    id,
    name: 'ask_user_question',
    input: { questionType: 'choice', options: [{ label: '方案 A' }] },
  });

  it('提示文案只陈述已作的选择', () => {
    const text = formatDemandAutoAnswerNotice(['方案 A']);
    expect(text).toContain('方案 A');
    expect(text).toContain('自动作答');
  });

  it('预算用尽触发代答 ⇒ 通知一次（sessionId + 所选项）', () => {
    const noticed: Array<{ sessionId: string; answers: string[] }> = [];
    setDemandAutoAnswerNoticeHook((input) => noticed.push(input));
    const session = { id: 'sess-b12-notice', metadata: demandMeta() };
    noteDemandAsk(session);
    expect(autoAnswerUnattended(INTERACTIVE_TOOL, ask('tc-b12'), session)).toBe(
      true
    );
    expect(noticed).toEqual([
      { sessionId: 'sess-b12-notice', answers: ['方案 A'] },
    ]);
    setDemandAutoAnswerNoticeHook(() => {});
  });

  it('未代答（预算尚在 / 恢复态）⇒ 不通知', () => {
    const noticed: string[] = [];
    setDemandAutoAnswerNoticeHook(({ sessionId }) => noticed.push(sessionId));
    const session = { id: 'sess-b12-quiet', metadata: demandMeta() };
    // 预算尚在 ⇒ 照常挂起
    expect(
      autoAnswerUnattended(INTERACTIVE_TOOL, ask('tc-b12-1'), session)
    ).toBe(false);
    // 恢复态 ⇒ 即便预算已用尽也不代答
    noteDemandAsk(session);
    expect(
      autoAnswerUnattended(INTERACTIVE_TOOL, ask('tc-b12-2'), session, true)
    ).toBe(false);
    expect(noticed).toEqual([]);
    setDemandAutoAnswerNoticeHook(() => {});
  });
});

describe('B7：跨重启保持（metadata.demandAskUsed 落盘）', () => {
  it('重启后凭已落盘的元数据标记仍判为预算用尽', () => {
    // 模拟新进程：内存 Set 为空，只有存储里读回的元数据
    const session = {
      id: 'sess-b7-restarted',
      metadata: { autonomy: 'demand', demandAskUsed: true },
    };
    const call = {
      id: 'tc-b7-restarted',
      name: 'ask_user_question',
      input: { questionType: 'choice', options: [{ label: '方案 A' }] },
    };
    expect(autoAnswerUnattended(INTERACTIVE_TOOL, call, session)).toBe(true);
  });

  it('记账时置位元数据标记并调用落盘钩子', () => {
    const persisted: string[] = [];
    setDemandAskPersistHook((sessionId) => persisted.push(sessionId));
    const session = { id: 'sess-b7-persist', metadata: demandMeta() };
    noteDemandAsk(session);
    expect((session.metadata as Record<string, unknown>).demandAskUsed).toBe(
      true
    );
    expect(persisted).toEqual(['sess-b7-persist']);
    setDemandAskPersistHook(() => {});
  });

  it('元数据模型往返保留该标记（toJSON → fromJSON 不丢）', () => {
    const meta = SessionMetadata.fromJSON({
      title: 't',
      autonomy: 'demand',
      demandAskUsed: true,
    });
    const roundTrip = SessionMetadata.fromJSON(meta.toJSON() as never);
    expect(roundTrip.demandAskUsed).toBe(true);
  });

  it('自主度变更后重置 ⇒ 重新获得一次问询额度', () => {
    const session = { id: 'sess-b7-reset', metadata: demandMeta() };
    noteDemandAsk(session);
    const ask = (id: string) => ({
      id,
      name: 'ask_user_question',
      input: { questionType: 'choice', options: [{ label: '方案 A' }] },
    });
    // 预算已用尽 ⇒ 代答
    expect(autoAnswerUnattended(INTERACTIVE_TOOL, ask('tc-1'), session)).toBe(
      true
    );
    resetDemandAskBudget(session);
    // 重置后 ⇒ 回到「可问一次」的状态
    expect('demandAskUsed' in (session.metadata as object)).toBe(false);
    expect(autoAnswerUnattended(INTERACTIVE_TOOL, ask('tc-2'), session)).toBe(
      false
    );
  });
});
