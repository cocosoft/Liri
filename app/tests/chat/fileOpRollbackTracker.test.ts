// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `trackFileOpBeforeExecute` 的特征化测试（2026-11-17，T3 复杂度清理 stage 5）。
 *
 * 背景：`ToolExecutionService._executeInternal` 的「回滚：文件操作前追踪」整段搬出为
 * `chat/services/rollbackTracker.ts`（fire-and-forget，失败不阻断执行）。
 *
 * 钉住的行为：
 *  ① 非 file_write / file_edit ⇒ 完全不触碰依赖（不查运行步骤、不读会话）；
 *  ② 写/改类工具 ⇒ 会话回滚集成收到 `{path, type:'modified', toolName}`（含计划归属）；
 *  ③ 无运行步骤 ⇒ op 不带 `planId` / `stepId`；
 *  ④ 无 `file_path` ⇒ 不追踪；
 *  ⑤ 子 Agent 会话 ⇒ 同一 op 继承到父会话的回滚集成；
 *  ⑥ 追踪抛错 ⇒ 不影响调用方（不抛、不产生未处理拒绝）。
 */
import { describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { trackFileOpBeforeExecute } from '../../src/chat/services/rollbackTracker';
import type { RollbackTrackerDeps } from '../../src/chat/services/rollbackTracker';

interface Op {
  path: string;
  type: string;
  toolName?: string;
  planId?: string;
  stepId?: string;
}

function integration(ops: Op[], fail = false) {
  return {
    onToolBeforeExecute: async (op: Op) => {
      ops.push(op);
      if (fail) throw new Error('boom');
    },
  };
}

function makeDeps(partial: {
  integrations?: Map<string, unknown>;
  session?: unknown;
  runningStep?: { planId: string; stepId: string } | null;
  calls?: string[];
  /** 2026-11-28：相对路径基准目录（与工具 `options.cwd` 同源） */
  baseDir?: string;
}): RollbackTrackerDeps {
  const calls = partial.calls ?? [];
  return {
    rollbackIntegrations: (partial.integrations ?? new Map()) as never,
    getSession: (async (sessionId: string) => {
      calls.push(`getSession:${sessionId}`);
      return partial.session;
    }) as never,
    getRunningStep: ((sessionId: string) => {
      calls.push(`getRunningStep:${sessionId}`);
      return partial.runningStep ?? null;
    }) as never,
    ...(partial.baseDir ? { getToolBaseDir: () => partial.baseDir } : {}),
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('trackFileOpBeforeExecute：文件操作前回滚追踪（特征化）', () => {
  it('① 非写/改类工具 ⇒ 不触碰依赖', async () => {
    const calls: string[] = [];
    trackFileOpBeforeExecute({
      toolCall: { id: 'c1', name: 'bash', sessionId: 's1' },
      args: { file_path: '/ws/a.ts' },
      deps: makeDeps({ calls }),
    });

    await flush();
    expect(calls).toEqual([]);
  });

  it('② file_write ⇒ 会话回滚集成收到 op（含计划归属）', async () => {
    const ops: Op[] = [];
    const integrations = new Map([['s2', integration(ops)]]);

    trackFileOpBeforeExecute({
      toolCall: { id: 'c2', name: 'file_write', sessionId: 's2' },
      args: { file_path: '/ws/a.ts' },
      deps: makeDeps({
        integrations,
        runningStep: { planId: 'p1', stepId: 'st1' },
      }),
    });

    await flush();
    expect(ops).toEqual([
      {
        path: '/ws/a.ts',
        type: 'modified',
        toolName: 'file_write',
        planId: 'p1',
        stepId: 'st1',
      },
    ]);
  });

  it('③ file_edit 无运行步骤 ⇒ op 不带计划字段', async () => {
    const ops: Op[] = [];
    const integrations = new Map([['s3', integration(ops)]]);

    trackFileOpBeforeExecute({
      toolCall: { id: 'c3', name: 'file_edit', sessionId: 's3' },
      args: { file_path: '/ws/b.ts' },
      deps: makeDeps({ integrations, runningStep: null }),
    });

    await flush();
    expect(ops[0]).toEqual({
      path: '/ws/b.ts',
      type: 'modified',
      toolName: 'file_edit',
    });
  });

  it('④ 无 file_path ⇒ 不追踪（也不读集成）', async () => {
    const ops: Op[] = [];
    const integrations = new Map([['s4', integration(ops)]]);
    const calls: string[] = [];

    trackFileOpBeforeExecute({
      toolCall: { id: 'c4', name: 'file_write', sessionId: 's4' },
      args: {},
      deps: makeDeps({ integrations, calls }),
    });

    await flush();
    expect(ops).toEqual([]);
  });

  it('⑤ 子 Agent 会话 ⇒ op 继承到父会话回滚集成', async () => {
    const childOps: Op[] = [];
    const parentOps: Op[] = [];
    const integrations = new Map<string, unknown>([
      ['s5', integration(childOps)],
      ['p5', integration(parentOps)],
    ]);

    trackFileOpBeforeExecute({
      toolCall: { id: 'c5', name: 'file_write', sessionId: 's5' },
      args: { file_path: '/ws/c.ts' },
      deps: makeDeps({
        integrations,
        session: { metadata: { parentSessionId: 'p5' } },
      }),
    });

    await flush();
    expect(childOps).toHaveLength(1);
    expect(parentOps).toHaveLength(1);
    expect(parentOps[0]).toMatchObject({
      path: '/ws/c.ts',
      toolName: 'file_write',
    });
  });

  it('⑥ 追踪抛错 ⇒ 不抛、不产生未处理拒绝', async () => {
    const ops: Op[] = [];
    const integrations = new Map([['s6', integration(ops, true)]]);

    expect(() =>
      trackFileOpBeforeExecute({
        toolCall: { id: 'c6', name: 'file_write', sessionId: 's6' },
        args: { file_path: '/ws/d.ts' },
        deps: makeDeps({ integrations }),
      })
    ).not.toThrow();

    await flush();
    await flush();
    expect(ops).toHaveLength(1);
  });

  it('⑦ 相对路径 ⇒ 按工具 cwd 解析为绝对路径（否则 pre-image 落错位置）', async () => {
    const ops: Op[] = [];
    const integrations = new Map([['s7', integration(ops)]]);

    await trackFileOpBeforeExecute({
      toolCall: { id: 'c7', name: 'file_write', sessionId: 's7' },
      args: { file_path: 'output/report.md' },
      deps: makeDeps({
        integrations,
        baseDir: join(tmpdir(), 'ws-abs'),
      }),
    });

    expect(ops).toHaveLength(1);
    expect(ops[0]!.path).toBe(join(tmpdir(), 'ws-abs', 'output', 'report.md'));
  });

  it('⑧ 绝对路径 ⇒ 即使有基准目录也原样保留', async () => {
    const ops: Op[] = [];
    const integrations = new Map([['s8', integration(ops)]]);

    await trackFileOpBeforeExecute({
      toolCall: { id: 'c8', name: 'file_edit', sessionId: 's8' },
      args: { file_path: '/ws/keep.ts' },
      deps: makeDeps({ integrations, baseDir: '/other' }),
    });

    expect(ops[0]!.path).toBe('/ws/keep.ts');
  });
});
