// MIT License
// Copyright (c) 2026 190615273@qq.com

// issue #8 · Cut B（2026-10-29）：预算挂起后续跑的**分流决策**单测。
//
// 该段属崩溃恢复路径（`code-deletion.md` CD07「会话恢复」），行为难以在端到端覆盖，
// 故在抽离到 `manager/budgetResume.ts` 之前先用假依赖锁定三条决策：
//   ① `taor` 链：无可用检查点 ⇒ 如实返回 false（不发执行入口、不落标记）；
//   ② `taor` 链：有检查点 ⇒ 先 resume 游标 → 注入 steering → 登记意图 → 触发既有入口；
//   ③ `stream` 链：重放有实质进展 ⇒ 不再重发；无实质进展 ⇒ 走既有入口重发一轮。

import { describe, it, expect } from 'bun:test';
import {
  isSubstantiveResumeChunk,
  resumeSuspendedSession,
  type BudgetResumeDeps,
} from '../../src/chat/manager/budgetResume.js';
import type { SessionCheckpointService } from '../../src/chat/services/SessionCheckpointService.js';
import type { ChatStreamChunk } from '../../src/runtime/api/CoreAPI.js';

/** 构造最小流式 chunk（只关心 `type` / `statusType` 两个判据字段） */
function chunk(shape: {
  type: ChatStreamChunk['type'];
  statusType?: string;
}): ChatStreamChunk {
  return { content: '', sessionId: 'sess-chunk', ...shape } as ChatStreamChunk;
}

interface SavedCheckpoint {
  label?: string;
  metadata?: unknown;
}

/** 只覆盖 `markResumed` 所需面的假检查点服务（记录落点，不触盘） */
function fakeCheckpointService(saved: SavedCheckpoint[]) {
  return {
    saveCheckpointWithData: async (
      _sessionId: string,
      _messages: unknown,
      metadata: unknown,
      _status: unknown,
      label?: string
    ) => {
      saved.push({ label, metadata });
      return `cp-${saved.length}`;
    },
  } as unknown as SessionCheckpointService;
}

describe('budgetResume：分流决策', () => {
  it('taor：无可用检查点 ⇒ false，且不触发执行入口、不登记意图、不落标记', async () => {
    const calls: string[] = [];
    const saved: SavedCheckpoint[] = [];
    const deps = {
      getOrCreateTAORLoop: () => ({
        getCheckpointsForSession: async () => null,
        resumeFromCheckpoint: async () => false,
        injectSteering: () => calls.push('steer'),
      }),
      sendViaOrchestrator: async () => {
        calls.push('send');
        return {};
      },
      getLatestCheckpoint: async () => null,
      resumeStream: async function* () {
        calls.push('resumeStream');
      },
      readSessionEvents: async () => [],
      markResumeIntent: () => calls.push('intent'),
      checkpointService: fakeCheckpointService(saved),
    } satisfies BudgetResumeDeps;

    expect(await resumeSuspendedSession(deps, 'sess-1', 'taor')).toBe(false);
    expect(calls).toEqual([]);
    expect(saved).toHaveLength(0);
  });

  it('taor：有检查点 ⇒ resume 游标 → 注入 steering → 登记意图 → 触发既有入口', async () => {
    const order: string[] = [];
    const saved: SavedCheckpoint[] = [];
    const deps = {
      getOrCreateTAORLoop: () => ({
        getCheckpointsForSession: async () => [
          {
            id: 'cp-7',
            pendingToolCalls: [{ toolCallId: 't1', toolName: 'file_read' }],
          },
        ],
        resumeFromCheckpoint: async (id?: string) => {
          order.push(`resume:${id ?? ''}`);
          return true;
        },
        injectSteering: (_msg: string, source: string) =>
          order.push(`steer:${source}`),
      }),
      sendViaOrchestrator: async (
        _content: string,
        options: { sessionId: string }
      ) => {
        order.push(`send:${options.sessionId}`);
        return {};
      },
      getLatestCheckpoint: async () => null,
      resumeStream: async function* () {
        order.push('resumeStream');
      },
      readSessionEvents: async () => [],
      markResumeIntent: (sessionId: string) =>
        order.push(`intent:${sessionId}`),
      checkpointService: fakeCheckpointService(saved),
    } satisfies BudgetResumeDeps;

    expect(await resumeSuspendedSession(deps, 'sess-2', 'taor')).toBe(true);
    expect(order).toEqual([
      'resume:cp-7',
      'steer:durable-resume',
      'intent:sess-2',
      'send:sess-2',
    ]);
  });

  it('stream：重放产生实质进展 ⇒ true，且不再经执行入口重发', async () => {
    const saved: SavedCheckpoint[] = [];
    let sent = 0;
    const deps = {
      getOrCreateTAORLoop: () => {
        throw new Error('stream 链不应创建 TAORLoop');
      },
      sendViaOrchestrator: async () => {
        sent++;
        return {};
      },
      getLatestCheckpoint: async () => null,
      resumeStream: async function* () {
        yield '继续输出';
      },
      readSessionEvents: async () => [],
      markResumeIntent: () => undefined,
      checkpointService: fakeCheckpointService(saved),
    } satisfies BudgetResumeDeps;

    expect(await resumeSuspendedSession(deps, 'sess-3', 'stream')).toBe(true);
    expect(sent).toBe(0);
    expect(saved.map((s) => s.label)).toEqual(['budget_resumed']);
  });

  it('stream：重放无实质进展（task_all_done）⇒ 经既有入口重发一轮并落「已恢复」标记', async () => {
    const saved: SavedCheckpoint[] = [];
    const sentTo: string[] = [];
    const deps = {
      getOrCreateTAORLoop: () => {
        throw new Error('stream 链不应创建 TAORLoop');
      },
      sendViaOrchestrator: async (
        _content: string,
        options: { sessionId: string }
      ) => {
        sentTo.push(options.sessionId);
        return {};
      },
      getLatestCheckpoint: async () => null,
      resumeStream: async function* () {
        yield chunk({ type: 'status', statusType: 'task_all_done' });
      },
      readSessionEvents: async () => [],
      markResumeIntent: () => undefined,
      checkpointService: fakeCheckpointService(saved),
    } satisfies BudgetResumeDeps;

    expect(await resumeSuspendedSession(deps, 'sess-4', 'stream')).toBe(true);
    expect(sentTo).toEqual(['sess-4']);
    expect(saved.map((s) => s.label)).toEqual(['budget_resumed']);
  });
});

describe('isSubstantiveResumeChunk', () => {
  it('空文本 / error / task_all_done 为非实质；其余为实质进展', () => {
    expect(isSubstantiveResumeChunk('')).toBe(false);
    expect(isSubstantiveResumeChunk('  文本')).toBe(true);
    expect(isSubstantiveResumeChunk(chunk({ type: 'error' }))).toBe(false);
    expect(
      isSubstantiveResumeChunk(
        chunk({ type: 'status', statusType: 'task_all_done' })
      )
    ).toBe(false);
    expect(
      isSubstantiveResumeChunk(chunk({ type: 'status', statusType: 'resume' }))
    ).toBe(true);
  });
});
