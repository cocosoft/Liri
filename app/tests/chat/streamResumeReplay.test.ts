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

function makeResumeWithDeps(opts: {
  messages: Msg[];
  completedToolCallIds: string[];
  awaiting?: (id: string) => boolean | Promise<boolean>;
}): { resume: ChatStreamResume; controllers: Map<string, AbortController> } {
  const controllers = new Map<string, AbortController>();
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
    sessionAbortControllers: controllers,
    isAwaitingUserApproval: async (call: { id: string }) =>
      opts.awaiting ? await opts.awaiting(call.id) : false,
  } as never;
  return { resume: new ChatStreamResume(deps), controllers };
}

function makeResume(opts: {
  messages: Msg[];
  completedToolCallIds: string[];
  awaiting?: (id: string) => boolean | Promise<boolean>;
}): ChatStreamResume {
  return makeResumeWithDeps(opts).resume;
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

/**
 * 2026-11-25 真机 `session_mww15fnr1f4e56775e` 回归：
 *  ① TAOR 落盘的声明是内部形状 `{id,name,arguments}`，续跑侧曾直接读 `tc.function.arguments`
 *     ⇒ `TypeError: undefined is not an object` ⇒ 审批后自动续跑失败；
 *  ② 失败路径未回收 abortController ⇒ `isSessionStreaming()` 恒 true ⇒ 后续审批等满 120s 被丢弃。
 */
describe('ChatStreamResume：声明形状兼容与 abortController 回收（2026-11-25）', () => {
  const internalShapeMessage = (id: string): Msg => ({
    role: 'assistant',
    content: '',
    // TAOR 内部形状：无 type / 无 function 包裹，arguments 是对象
    metadata: {
      tool_calls: [{ id, name: 'bash', arguments: { command: 'echo hi' } }],
    },
  });

  it('内部形状的待审批调用：不再抛 TypeError，如实进入等待审批分支', async () => {
    const status = await firstStatus({
      messages: [internalShapeMessage('c1')],
      completedToolCallIds: [],
      awaiting: () => true,
    });

    expect(String(status?.content)).toContain('仍在等待审批');
    expect(String(status?.content)).toContain('1 个工具未落定');
  });

  it('续跑抛错 ⇒ abortController 已回收（不再永久 streaming）', async () => {
    const { resume, controllers } = makeResumeWithDeps({
      messages: [internalShapeMessage('c1')],
      completedToolCallIds: [],
      // 让错误发生在 controller 注册之后（剩余调用重建阶段）
      awaiting: () => {
        throw new Error('boom');
      },
    });

    await expect(
      collect(
        resume.resume('sess-resume-seam', 'ck-1') as AsyncGenerator<
          unknown,
          unknown,
          unknown
        >
      )
    ).rejects.toThrow('boom');
    expect(controllers.size).toBe(0);
  });

  it('正常完成（无剩余调用）同样回收 abortController', async () => {
    const { resume, controllers } = makeResumeWithDeps({
      messages: [
        {
          role: 'assistant',
          content: 'done',
          tool_calls: [makeToolCall('c1')],
        },
      ],
      completedToolCallIds: ['c1'],
    });

    await collect(
      resume.resume('sess-resume-seam', 'ck-1') as AsyncGenerator<
        unknown,
        unknown,
        unknown
      >
    );
    expect(controllers.size).toBe(0);
  });
});
