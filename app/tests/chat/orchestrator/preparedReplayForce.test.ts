/**
 * T1-13 / `✅-4` R-A：重放**强制套用**落盘快照（2026-10-13）
 *
 * 覆盖：
 * ① `selectToolsForTurn` 的**强制集语义** —— 短路任务/profile 裁剪，只留名字命中者；
 *    点名但**已不在**注册表的工具**不复活**（不臆造）；
 * ② 强制集**优先于**会话 profile（即使 profile 声明 `media`，仍只留快照集）；
 * ③ 端到端（`selectAndObserveToolDefinitions`）：`options.forcedVisibleTools` ⇒ 最终工具面 = 强制集，
 *    且**新落盘的 PREPARED 快照记录的是强制后**的可见集（重放幂等：越重放越稳）；
 * ④ 未提供 ⇒ 逐字等价现状（零行为变更；开关 `PREPARED_SNAPSHOT_REPLAY` 默认开，本测试直接注入强制集、不依赖开关取值）。
 */
import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { selectToolsForTurn } from '../../../src/chat/orchestrator/streamMessageToolSelection.js';
import { selectAndObserveToolDefinitions } from '../../../src/chat/orchestrator/streamMessageToolSelectionFlow.js';
import type { ChatOrchestratorHost } from '../../../src/chat/orchestrator/ChatOrchestrator.js';
import {
  getExecutionManager,
  setExecutionEventSink,
  resolveReplayVisibleTools,
} from '../../../src/execution/index.js';
import type { LiriEvent } from '../../../src/session/types/events.js';
import { ChatManagerImpl } from '../../../src/chat/ChatManager.js';

type ToolLike = { function?: { name?: string } };

function makeTools(): ToolLike[] {
  return [
    { function: { name: 'file_read' } },
    { function: { name: 'image_analysis' } },
    { function: { name: 'lsp' } },
    { function: { name: 'todo_write' } },
  ];
}

function visibleNames(result: { tools: unknown[] }): string[] {
  return (result.tools as ToolLike[]).map((t) => t.function?.name ?? '').sort();
}

beforeEach(() => {
  getExecutionManager().reset();
});

afterAll(() => {
  setExecutionEventSink(null);
  getExecutionManager().reset();
});

describe('T1-13 R-A 重放强制套用落盘快照', () => {
  it('① 强制集短路裁剪；点名但已消失的工具不复活', () => {
    const r = selectToolsForTurn({
      tools: makeTools() as never,
      explicitTaskType: undefined,
      lastUserText: '',
      hasImages: false,
      // `ghost_tool` 不在注册表 ⇒ 不复活；`image_analysis` 未点名 ⇒ 被排除
      forcedVisibleTools: ['file_read', 'ghost_tool'],
    });
    expect(visibleNames(r)).toEqual(['file_read']);
    expect(r.removedNames).toContain('image_analysis');
    expect(r.trimmed).toBe(true);
  });

  it('② 强制集优先于会话 profile', () => {
    const r = selectToolsForTurn({
      tools: makeTools() as never,
      explicitTaskType: undefined,
      lastUserText: '',
      hasImages: false,
      profile: ['media'], // 若生效会带出 image_analysis
      forcedVisibleTools: ['lsp', 'todo_write'],
    });
    expect(visibleNames(r)).toEqual(['lsp', 'todo_write']);
  });

  it('④ 未提供强制集 ⇒ 等价现状（default 集：file_read + todo_write）', () => {
    const r = selectToolsForTurn({
      tools: makeTools() as never,
      explicitTaskType: undefined,
      lastUserText: '',
      hasImages: false,
    });
    expect(visibleNames(r)).toEqual(['file_read', 'todo_write']);
  });

  it('③ 端到端：最终工具面 = 强制集，且新落盘快照记录强制后的可见集', () => {
    const captured: { type: string; data: Record<string, unknown> }[] = [];
    setExecutionEventSink(async (_sid, event: LiriEvent) => {
      captured.push({
        type: event.type,
        data: event.data as Record<string, unknown>,
      });
      return { ok: true, tailSeq: captured.length };
    });
    const lease = getExecutionManager().acquire('s-replay');
    captured.length = 0;

    const toolDefinitions = makeTools() as never;
    const host = {
      getClientForModel: () => ({}),
      toolRoundCount: 0,
    } as unknown as ChatOrchestratorHost;

    selectAndObserveToolDefinitions({
      toolDefinitions,
      session: { id: 's-replay' },
      options: {
        executionId: lease.executionId,
        // 刻意取**不等于** default 集（`lsp` 属 code 类，default 不含）⇒ 可鉴别强制是否生效
        forcedVisibleTools: ['lsp', 'todo_write'],
      },
      host,
      apiMessages: [],
    } as never);

    // 最终工具面 = 强制集
    expect(visibleNames({ tools: toolDefinitions })).toEqual([
      'lsp',
      'todo_write',
    ]);
    // 落盘快照 = 强制后的可见集
    const prepared = captured.filter((e) => e.type === 'execution/prepared');
    expect(prepared.length).toBe(1);
    expect(prepared[0]!.data.visibleTools).toEqual(['lsp', 'todo_write']);
  });

  it('resolveReplayVisibleTools：有快照 ⇒ 取其可见集；无 ⇒ null（不臆造）', () => {
    expect(resolveReplayVisibleTools([])).toBeNull();
    const events = [
      {
        type: 'execution/prepared',
        seq: 1,
        time: 0,
        sessionId: 's',
        data: { executionId: 'e1', generation: 1, visibleTools: ['a', 'b'] },
      },
    ] as unknown as LiriEvent[];
    expect(resolveReplayVisibleTools(events)).toEqual(['a', 'b']);
  });
});

/**
 * W3 **接线级**回归（2026-10-21，默认改为开后）。
 *
 * 与 `featureFlagContract` 的默认值断言分工：那里只证"开关状态"，这里证"开关开时接线存在"——
 * 若 `_resolveReplayForcedTools` 被摘掉、或结果没传进 `sendMessage`，本条即变红。
 */
describe('W3 接线：开关开 ⇒ 续跑注入落盘快照工具面', () => {
  type ResumeInternals = {
    getLatestCheckpoint: (sid: string) => Promise<unknown>;
    resumeStream: (sid: string, s: string) => AsyncGenerator<unknown>;
    _markBudgetResumed: (sid: string) => Promise<void>;
    readSessionEvents: (sid: string, opts: unknown) => Promise<unknown[]>;
    _resumeSuspendedStream: (sid: string) => Promise<boolean>;
    chatOrchestrator: {
      sendMessage: (content: string, options: unknown) => Promise<unknown>;
    };
  };

  function preparedEvent(visibleTools: string[]): unknown {
    return {
      type: 'execution/prepared',
      seq: 1,
      time: 0,
      sessionId: 's-w3',
      data: { executionId: 'e1', generation: 1, visibleTools },
    };
  }

  async function runResume(events: unknown[]): Promise<{
    resumed: boolean;
    options: { forcedVisibleTools?: string[] } | undefined;
  }> {
    const cm = new ChatManagerImpl() as unknown as ResumeInternals;
    cm.getLatestCheckpoint = async () => undefined;
    // 空生成器 ⇒ 无实质进展 ⇒ 走「重发一轮」分支
    cm.resumeStream = async function* () {};
    cm._markBudgetResumed = async () => {};
    cm.readSessionEvents = async () => events;

    let captured: { forcedVisibleTools?: string[] } | undefined;
    cm.chatOrchestrator.sendMessage = async (_content, options) => {
      captured = options as { forcedVisibleTools?: string[] };
      return {};
    };

    const resumed = await cm._resumeSuspendedStream('s-w3');
    return { resumed, options: captured };
  }

  afterAll(() => {
    delete process.env['FEATURE_PREPARED_SNAPSHOT_REPLAY'];
  });

  it('默认（开关开）⇒ sendMessage 携带快照 visibleTools', async () => {
    delete process.env['FEATURE_PREPARED_SNAPSHOT_REPLAY'];
    const { resumed, options } = await runResume([
      preparedEvent(['lsp', 'todo_write']),
    ]);
    expect(resumed).toBe(true);
    expect(options?.forcedVisibleTools).toEqual(['lsp', 'todo_write']);
  });

  it('开关显式关闭 ⇒ 不注入（逃生开关有效）', async () => {
    process.env['FEATURE_PREPARED_SNAPSHOT_REPLAY'] = 'false';
    const { options } = await runResume([preparedEvent(['lsp'])]);
    expect(options?.forcedVisibleTools).toBeUndefined();
  });

  it('无快照 ⇒ 不注入（不臆造）', async () => {
    delete process.env['FEATURE_PREPARED_SNAPSHOT_REPLAY'];
    const { options } = await runResume([]);
    expect(options?.forcedVisibleTools).toBeUndefined();
  });
});
