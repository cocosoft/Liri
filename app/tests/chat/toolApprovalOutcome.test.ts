// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `resolveToolApprovalOutcome` 的特征化测试（2026-11-17，T3 复杂度清理 stage 7）。
 *
 * 钉住的行为：
 *  ① 非审批结果 ⇒ `null`（调用方继续常规处理）；
 *  ② 已批准过同一指纹 ⇒ 只复跑一次，返回其 data/error；
 *  ③ 未命中且审批卡提交成功 ⇒ `awaiting_approval`（`pendingApproval` + `inboxId`）；
 *  ④ 提交失败 ⇒ 如实回传工具自身 error / output（不伪造成"等待审批"）。
 */
import { describe, expect, it } from 'bun:test';

import {
  resolveToolApprovalOutcome,
  type ToolApprovalOutcomeDeps,
} from '../../src/chat/services/toolApprovalOutcome';

function makeDeps(
  overrides: Partial<ToolApprovalOutcomeDeps> = {}
): ToolApprovalOutcomeDeps {
  return {
    isCommandApproved: async () => false,
    submitToolApproval: async () => null,
    resolveRegisteredTool: () => undefined,
    awaitingApprovalStatus: 'awaiting_approval',
    ...overrides,
  };
}

const toolCall = { id: 'tc-1', name: 'bash', sessionId: 's1' };
const args = { cmd: 'ls' };

describe('resolveToolApprovalOutcome：审批结果整形（特征化）', () => {
  it('① 非审批结果 ⇒ null', async () => {
    const outcome = await resolveToolApprovalOutcome({
      toolCall,
      args,
      toolResult: { data: { ok: true } },
      executeAgain: async () => ({}),
      deps: makeDeps(),
    });

    expect(outcome).toBeNull();
  });

  it('② 已批准命中 ⇒ 复跑一次并返回其结果', async () => {
    let runs = 0;
    const outcome = await resolveToolApprovalOutcome({
      toolCall,
      args,
      toolResult: { requireApproval: true, approvalReason: 'risky' },
      executeAgain: async () => {
        runs++;
        return { data: { done: true } };
      },
      deps: makeDeps({ isCommandApproved: async () => true }),
    });

    expect(runs).toBe(1);
    expect(outcome).toMatchObject({
      toolCallId: 'tc-1',
      result: { done: true },
      error: undefined,
    });
  });

  it('③ 审批卡提交成功 ⇒ awaiting_approval + inboxId', async () => {
    const outcome = await resolveToolApprovalOutcome({
      toolCall,
      args,
      toolResult: {
        status: 'requires_approval',
        approvalReason: 'high risk',
      },
      executeAgain: async () => ({}),
      deps: makeDeps({ submitToolApproval: async () => 'inbox-7' }),
    });

    expect(outcome).toMatchObject({
      result: {
        status: 'awaiting_approval',
        pendingApproval: true,
        inboxId: 'inbox-7',
      },
    });
  });

  it('④ 审批卡提交失败 ⇒ 回传工具自身 error', async () => {
    const outcome = await resolveToolApprovalOutcome({
      toolCall,
      args,
      toolResult: { requireApproval: true, error: 'denied by tool' },
      executeAgain: async () => ({}),
      deps: makeDeps({ submitToolApproval: async () => null }),
    });

    expect(outcome).toMatchObject({ error: 'denied by tool' });
  });
});
