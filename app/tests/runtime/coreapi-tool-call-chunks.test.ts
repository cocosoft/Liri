// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// chatStream.onToolCall 两阶段的 chunk 产物特征化（P3-2，2026-11-16）
//
// 原实现是 `chatStream` 内 `onToolCall` 闭包里的两段内联分支（start / end，约 280 行），
// 后外移为 `toolCallStreamChunks.ts`（避免 CoreAPIImpl.ts 越过 R04-001 的 2000 行上限）。
// 判错只表现为「工具卡片缺参数 / 状态文案错 / diff 不产出 / 结果不注入」（不报错）
// ⇒ 用最小上下文直接驱动两阶段，逐条钉住 pendingEvents 与缓存副作用。
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STATUS_TYPE } from '@shared/types';
import { TOOL_NAME_CONSTANTS } from '@openliri/infra/constants';
import {
  emitToolCallEnd,
  emitToolCallStart,
  type ToolCallStreamContext,
} from '../../src/runtime/api/toolCallStreamChunks.js';

type ChunkLike = {
  type?: string;
  content?: string;
  statusType?: string;
  toolCall?: {
    id?: string;
    name?: string;
    arguments?: Record<string, unknown>;
    status?: string;
    result?: unknown;
  };
  _meta?: unknown;
};

type TrackerCall = { payload?: unknown };

/** 测试可观测的上下文（pendingEvents / pendingFileDiffs / 缓存均可直接断言） */
type Ctx = ToolCallStreamContext & {
  pendingEvents: ChunkLike[];
  pendingFileDiffs: Array<Record<string, unknown>>;
  fileOldContentCache: Map<string, string>;
};

/** 两阶段所需的最小上下文（宿主能力全部给假实现） */
function makeCtx(overrides: Record<string, unknown> = {}): {
  ctx: Ctx;
  artifacts: TrackerCall[];
} {
  const artifacts: TrackerCall[] = [];
  const ctx = {
    sessionId: 's1',
    pendingEvents: [] as ChunkLike[],
    pendingFileDiffs: [] as Array<Record<string, unknown>>,
    toolResultCache: new Map<string, unknown>(),
    fileOldContentCache: new Map<string, string>(),
    sessionTitling: {
      getExecutionPhaseTracker: () => ({
        getCurrentPhase: () => 'implementing',
        enter: () => {},
        addArtifact: (artifact: unknown) =>
          artifacts.push({ payload: artifact }),
      }),
    },
    chatManager: {
      getSessions: () => [],
      persistSessionMetadata: async () => {},
    },
    computeUnifiedDiff: () => ({
      diff: '-a\n+b',
      additions: 1,
      deletions: 1,
    }),
    ...overrides,
  } as unknown as Ctx;
  return { ctx, artifacts };
}

describe('emitToolCallStart', () => {
  it('普通工具 ⇒ 状态块 + 运行中工具卡片（携带完整参数）', () => {
    const { ctx } = makeCtx();
    emitToolCallStart('file_read', 'tc-1', { args: { path: '/a' } }, ctx);

    expect(ctx.pendingEvents).toHaveLength(2);
    expect(ctx.pendingEvents[0]).toMatchObject({
      type: 'status',
      content: '🔧 Running tool: file_read',
      statusType: STATUS_TYPE.TOOL_RUNNING,
    });
    expect(ctx.pendingEvents[1]).toMatchObject({
      type: 'tool_call',
      toolCall: {
        id: 'tc-1',
        name: 'file_read',
        arguments: { path: '/a' },
        status: 'running',
      },
    });
  });

  it('生图工具 ⇒ 追加图像生成进度状态', () => {
    const { ctx } = makeCtx();
    emitToolCallStart(
      TOOL_NAME_CONSTANTS.image_generate,
      'tc-2',
      { args: {} },
      ctx
    );
    const statuses = ctx.pendingEvents
      .filter((c) => c.type === 'status')
      .map((c) => c.content);
    expect(statuses).toEqual([
      `🔧 Running tool: ${TOOL_NAME_CONSTANTS.image_generate}`,
      '🎨 AI is generating an image...',
    ]);
  });

  it('图像分析工具 ⇒ 追加分析进度状态；未知工具 ⇒ 不追加', () => {
    const { ctx } = makeCtx();
    emitToolCallStart(
      TOOL_NAME_CONSTANTS.image_analysis,
      'tc-3',
      { args: {} },
      ctx
    );
    expect(ctx.pendingEvents.filter((c) => c.type === 'status')).toHaveLength(
      2
    );

    const plain = makeCtx();
    emitToolCallStart('grep', 'tc-4', undefined, plain.ctx);
    expect(
      plain.ctx.pendingEvents.filter((c) => c.type === 'status')
    ).toHaveLength(1);
    expect(plain.ctx.pendingEvents[1].toolCall?.arguments).toEqual({});
  });

  it('文件写入工具 ⇒ 缓存旧内容（供 end 计算 diff）', () => {
    const { ctx } = makeCtx();
    const dir = mkdtempSync(join(tmpdir(), 'coreapi-start-'));
    const file = join(dir, 'a.txt');
    writeFileSync(file, 'old', 'utf-8');
    emitToolCallStart('file_write', 'tc-5', { args: { file_path: file } }, ctx);
    expect(ctx.fileOldContentCache.get(file)).toBe('old');
  });

  it('文件不存在 ⇒ 不写入缓存（读取失败不阻断）', () => {
    const { ctx } = makeCtx();
    emitToolCallStart(
      'file_write',
      'tc-6',
      { args: { file_path: join(tmpdir(), 'definitely-missing-xyz.txt') } },
      ctx
    );
    expect(ctx.fileOldContentCache.size).toBe(0);
  });
});

describe('emitToolCallEnd', () => {
  it('成功且无缓存结果 ⇒ 完成状态 + 完成卡片（result 缺省）', () => {
    const { ctx } = makeCtx();
    emitToolCallEnd('grep', 'tc-1', { ok: true }, ctx);

    expect(ctx.pendingEvents[0]).toMatchObject({
      type: 'status',
      content: '✅ Tool grep completed',
      statusType: STATUS_TYPE.TOOL_COMPLETED,
    });
    expect(ctx.pendingEvents[1].toolCall).toMatchObject({
      id: 'tc-1',
      status: 'completed',
      result: undefined,
    });
  });

  it('失败 ⇒ 状态带失败原因（去掉「失败: 」前缀）+ failed 卡片', () => {
    const { ctx } = makeCtx();
    emitToolCallEnd(
      'grep',
      'tc-2',
      { ok: false, message: '失败: 权限不足' },
      ctx
    );
    expect(ctx.pendingEvents[0]).toMatchObject({
      content: '❌ Tool grep failed — 权限不足',
      statusType: STATUS_TYPE.TOOL_FAILED,
    });
    expect(ctx.pendingEvents[1].toolCall?.status).toBe('failed');
  });

  it('文件写入成功 ⇒ 提取路径、登记交付物、缓存命中时产出 diff 并清理缓存', () => {
    const { ctx, artifacts } = makeCtx();
    const dir = mkdtempSync(join(tmpdir(), 'coreapi-end-'));
    const file = join(dir, 'b.txt');
    writeFileSync(file, 'new', 'utf-8');
    ctx.fileOldContentCache.set(file, 'old');

    emitToolCallEnd(
      'file_write',
      'tc-3',
      { ok: true, result: `已写入 ${file}` },
      ctx
    );

    expect(ctx.pendingEvents[1].toolCall?.arguments).toEqual({
      file_path: file,
    });
    expect(artifacts).toHaveLength(1);
    expect(ctx.pendingFileDiffs).toEqual([
      { file, diff: '-a\n+b', additions: 1, deletions: 1 },
    ]);
    // 无论 diff 成败，缓存条目都必须清理
    expect(ctx.fileOldContentCache.has(file)).toBe(false);
  });

  it('tool:completed 缓存命中 ⇒ 结果注入完成卡片并出栈', () => {
    const { ctx } = makeCtx();
    ctx.toolResultCache.set('tc-4', { rows: 2 });
    emitToolCallEnd('grep', 'tc-4', { ok: true }, ctx);
    expect(ctx.pendingEvents[1].toolCall?.result).toEqual({
      success: true,
      data: { rows: 2 },
    });
    expect(ctx.toolResultCache.has('tc-4')).toBe(false);
  });

  it('create_project 命中缓存 ⇒ 注入导航建议元数据', () => {
    const { ctx } = makeCtx();
    ctx.toolResultCache.set('tc-5', JSON.stringify({ projectId: 'p-9' }));
    emitToolCallEnd(
      TOOL_NAME_CONSTANTS.create_project,
      'tc-5',
      { ok: true },
      ctx
    );
    expect(ctx.pendingEvents[1]._meta).toEqual({
      action: 'suggest_navigate',
      target: '/projects?open=p-9',
      label: '查看项目',
    });
  });

  it('create_project ⇒ 会话未绑定项目时写入 metadata 并持久化', () => {
    const persisted: unknown[] = [];
    const session = { id: 's1', metadata: {} as Record<string, unknown> };
    const { ctx } = makeCtx({
      chatManager: {
        getSessions: () => [session],
        persistSessionMetadata: async (s: unknown) => {
          persisted.push(s);
        },
      },
    });

    ctx.toolResultCache.set('tc-6', JSON.stringify({ projectId: 'p-10' }));
    emitToolCallEnd(
      TOOL_NAME_CONSTANTS.create_project,
      'tc-6',
      { ok: true },
      ctx
    );
    expect(session.metadata['projectId']).toBe('p-10');
    expect(persisted).toEqual([session]);
  });

  it('会话已绑定项目 ⇒ 不覆盖', () => {
    const persisted: unknown[] = [];
    const session = {
      id: 's1',
      metadata: { projectId: 'existing' } as Record<string, unknown>,
    };
    const { ctx } = makeCtx({
      chatManager: {
        getSessions: () => [session],
        persistSessionMetadata: async (s: unknown) => {
          persisted.push(s);
        },
      },
    });

    ctx.toolResultCache.set('tc-7', JSON.stringify({ projectId: 'p-new' }));
    emitToolCallEnd(
      TOOL_NAME_CONSTANTS.create_project,
      'tc-7',
      { ok: true },
      ctx
    );
    expect(session.metadata['projectId']).toBe('existing');
    expect(persisted).toEqual([]);
  });
});
