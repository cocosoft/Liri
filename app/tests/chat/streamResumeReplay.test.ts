// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P3-2（复杂度清理）：`ChatStreamResume.resume` **剩余调用重建**的特征化锁（外移前先测）。
 *
 * 现状：`chatModeToolFilterStream.test.ts` 只覆盖工具集裁剪，续跑"剩余调用重建 + 是否重放"
 * 没有回归锁。这里用最小 deps 假件（自动检查点走 `rebuildTrailingTurnFromEvents` 通路，
 * 不进入 ReActToolLoop）锁定两条决定性分支：
 *   ① 剩余调用**全部已完成** ⇒ 不重放，yield `task_all_done` 且文案为「任务已全部完成」；
 *   ② 剩余调用**仍在等审批** ⇒ 不重放，文案如实说明「仍在等待审批（N 个工具未落定）」
 *      （不得说"任务已全部完成"）。
 */
import { describe, expect, it } from 'bun:test';
import { ChatStreamResume } from '../../src/chat/manager/streamResume';
import { DataSessionStatus } from '@modules/session/types/session';

type Chunk = { statusType?: string; content?: string };
type Msg = Record<string, unknown>;

function makeToolCall(id: string): Record<string, unknown> {
  return {
    id,
    type: 'function',
    function: { name: 'bash', arguments: '{"command":"echo hi"}' },
  };
}

function makeSession(messages: Msg[]): unknown {
  return {
    id: 'sess-resume-seam',
    messages,
    metadata: {},
    state: DataSessionStatus.ACTIVE,
  };
}

function makeResume(opts: {
  messages: Msg[];
  completedToolCallIds: string[];
  awaiting?: (id: string) => boolean;
}): ChatStreamResume {
  const deps = {
    sessionMutexes: new Map(),
    resumeSessionState: async () => {},
    // 无自动检查点 ⇒ restore 返回 null ⇒ 走 rebuild 通路（本用例只关心其后的重建逻辑）
    checkpointService: { listCheckpoints: async () => [] },
    rebuildTrailingTurnFromEvents: async () => ({
      checkpoint: { messages: opts.messages },
      stepIndex: 0,
      completedToolCallIds: opts.completedToolCallIds,
      generatorState: { toolTurnCount: 0, llmCallCount: 0 },
    }),
    getOrLoadSession: async () => makeSession(opts.messages),
    sessionAbortControllers: new Map(),
    isAwaitingUserApproval: async (call: { id: string }) =>
      opts.awaiting ? opts.awaiting(call.id) : false,
  } as never;
  return new ChatStreamResume(deps);
}

async function collect(
  gen: AsyncGenerator<unknown, unknown, unknown>
): Promise<Chunk[]> {
  const out: Chunk[] = [];
  for await (const chunk of gen) out.push(chunk as Chunk);
  return out;
}

async function firstStatus(
  opts: Parameters<typeof makeResume>[0]
): Promise<Chunk | undefined> {
  const chunks = await collect(
    makeResume(opts).resume('sess-resume-seam', 'ck-1') as AsyncGenerator<
      unknown,
      unknown,
      unknown
    >
  );
  return chunks.find((c) => c.statusType === 'task_all_done');
}

describe('ChatStreamResume.resume 剩余调用重建（P3-2 外移前特征化）', () => {
  it('剩余调用全部已完成 ⇒ 不重放，文案为「任务已全部完成」', async () => {
    const status = await firstStatus({
      messages: [
        {
          role: 'assistant',
          content: 'done',
          tool_calls: [makeToolCall('c1')],
        },
      ],
      completedToolCallIds: ['c1'],
    });

    expect(status?.content).toBe('任务已全部完成');
  });

  it('剩余调用仍在等审批 ⇒ 不重放，如实说明仍在等审批', async () => {
    const status = await firstStatus({
      messages: [
        {
          role: 'assistant',
          content: 'waiting',
          tool_calls: [makeToolCall('c1')],
        },
      ],
      completedToolCallIds: [],
      awaiting: () => true,
    });

    expect(String(status?.content)).toContain('仍在等待审批');
    expect(String(status?.content)).toContain('1 个工具未落定');
    expect(String(status?.content)).not.toContain('任务已全部完成');
  });
});
