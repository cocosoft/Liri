// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 方案 C（2026-11-09）：replan 前「成本可见 + 现场可回溯」的回归锁。
 *
 * 背景（真机 `pdca_mw81e4z5`）：escalate→replan 会重建整份计划（全部 pending）⇒ 已完成步骤
 * 被重跑、产物被重写，且此前完全静默。本文件锁两件事：回执文案（含"将重跑 N 步 / M 步已完成"）
 * 与产物清单快照（真实工作区 → JSON 落盘）。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  existsSync,
  utimesSync,
} from 'node:fs';
import { join } from 'node:path';
import { resolvePyappHome } from '@openliri/infra/environment';
import { resolveTaskWorkspace } from '@modules/agent';
import {
  captureWorkspaceSnapshot,
  prepareReplan,
  selectReusableSteps,
  applyReusableSteps,
} from '../../src/tasks/lro/replanGuard';
import type { Plan } from '../../src/tasks/TaskOrchestrator';
import { setPdcaReceiptSink } from '../../src/tasks/lro/terminalReceipt';

const TASK_ID = `pdca_replanguard_${Date.now()}`;
const workspace = resolveTaskWorkspace(TASK_ID);

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
  // 清掉本用例写入的快照文件（目录可能还有别的任务，只删本任务前缀）
  const dir = join(resolvePyappHome(), 'data', 'replan-snapshots');
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(TASK_ID)) rmSync(join(dir, name), { force: true });
    }
  }
});

describe('prepareReplan — 成本回执（不改执行语义）', () => {
  const capture = () => ({
    taskId: TASK_ID,
    capturedAt: new Date().toISOString(),
    workspace,
    entries: 3,
    truncated: false,
    files: [],
  });

  it('有已完成步骤 ⇒ 文案点明"将重跑 N 步（其中 M 步此前已完成）" + 快照条目数', () => {
    const texts: string[] = [];
    setPdcaReceiptSink((p) => texts.push(p.text));
    try {
      const summary = prepareReplan({
        taskId: TASK_ID,
        sessionId: 'sess-replan',
        previousSteps: [
          { status: 'completed', description: 'A' },
          { status: 'completed', description: 'B' },
          { status: 'failed', description: 'C' },
        ],
        capture,
      });
      expect(summary).toEqual({
        total: 3,
        previouslyCompleted: 2,
        reusable: [],
      });
      expect(texts).toHaveLength(1);
      expect(texts[0]).toContain('将重跑 3 步');
      expect(texts[0]).toContain('其中 2 步此前已完成');
      expect(texts[0]).toContain('3 个文件');
    } finally {
      setPdcaReceiptSink(undefined);
    }
  });

  it('无已完成步骤（首轮即 escalate）⇒ 不提"此前已完成"', () => {
    const texts: string[] = [];
    setPdcaReceiptSink((p) => texts.push(p.text));
    try {
      const summary = prepareReplan({
        taskId: TASK_ID,
        sessionId: 'sess-replan',
        previousSteps: [{ status: 'failed', description: 'A' }],
        capture,
      });
      expect(summary).toEqual({
        total: 1,
        previouslyCompleted: 0,
        reusable: [],
      });
      expect(texts[0]).toContain('将重跑 1 步');
      expect(texts[0]).not.toContain('此前已完成');
    } finally {
      setPdcaReceiptSink(undefined);
    }
  });

  it('快照失败 ⇒ 不抛错、回执不提快照、统计仍返回', () => {
    const texts: string[] = [];
    setPdcaReceiptSink((p) => texts.push(p.text));
    try {
      const summary = prepareReplan({
        taskId: TASK_ID,
        sessionId: 'sess-replan',
        previousSteps: [{ status: 'completed', description: 'A' }],
        capture: () => {
          throw new Error('disk full');
        },
      });
      expect(summary).toEqual({
        total: 1,
        previouslyCompleted: 1,
        reusable: [],
      });
      expect(texts[0]).not.toContain('快照');
    } finally {
      setPdcaReceiptSink(undefined);
    }
  });

  it('无 sessionId ⇒ 不发回执（回执依赖会话），统计照常返回', () => {
    const texts: string[] = [];
    setPdcaReceiptSink((p) => texts.push(p.text));
    try {
      const summary = prepareReplan({
        taskId: TASK_ID,
        sessionId: null,
        previousSteps: [{ status: 'completed', description: 'A' }],
        capture,
      });
      expect(summary.total).toBe(1);
      expect(texts).toHaveLength(0);
    } finally {
      setPdcaReceiptSink(undefined);
    }
  });
});

describe('captureWorkspaceSnapshot — 产物清单落盘', () => {
  it('递归收集文件元数据（相对路径 + 大小），并写 JSON 快照', () => {
    mkdirSync(join(workspace, 'sub'), { recursive: true });
    writeFileSync(join(workspace, 'a.txt'), 'hello', 'utf-8');
    writeFileSync(join(workspace, 'sub', 'b.txt'), 'bye', 'utf-8');

    const snapshot = captureWorkspaceSnapshot(TASK_ID);
    expect(snapshot.taskId).toBe(TASK_ID);
    expect(snapshot.entries).toBe(2);
    expect(snapshot.truncated).toBe(false);
    const paths = snapshot.files.map((f) => f.path).sort();
    expect(paths).toEqual(['a.txt', 'sub/b.txt']);
    expect(snapshot.files.every((f) => f.size > 0)).toBe(true);

    const dir = join(resolvePyappHome(), 'data', 'replan-snapshots');
    const written = readdirSync(dir).filter((n) => n.startsWith(TASK_ID));
    expect(written.length).toBeGreaterThan(0);
    const parsed = JSON.parse(readFileSync(join(dir, written[0]), 'utf-8')) as {
      entries: number;
    };
    expect(parsed.entries).toBe(2);
  });

  it('工作区不存在 ⇒ 空快照（不是错误）', () => {
    const snapshot = captureWorkspaceSnapshot(`pdca_missing_${Date.now()}`);
    expect(snapshot.entries).toBe(0);
    expect(snapshot.files).toEqual([]);
  });
});

describe('replan 增量复用（P0-2，2026-11-09）', () => {
  const ws = resolveTaskWorkspace(TASK_ID);

  function resetWorkspace(): void {
    rmSync(ws, { recursive: true, force: true });
    mkdirSync(ws, { recursive: true });
  }

  it('completed + 产物与快照一致 ⇒ 可复用；失败/零产物/缺陷步骤不复用', () => {
    resetWorkspace();
    writeFileSync(join(ws, 'a.txt'), 'A', 'utf-8');
    const snapshot = captureWorkspaceSnapshot(TASK_ID);

    const reusable = selectReusableSteps({
      previousSteps: [
        { status: 'completed', description: '写 a', artifacts: ['a.txt'] },
        { status: 'failed', description: '写 b', artifacts: ['a.txt'] },
        { status: 'completed', description: '零产物步骤' },
        {
          status: 'completed',
          description: '受缺陷影响',
          artifacts: ['a.txt'],
        },
      ],
      snapshot,
      defects: [{ stepDescription: '受缺陷影响' }],
    });
    expect(reusable.map((r) => r.description)).toEqual(['写 a']);
  });

  it('产物在 replan 前被改写 ⇒ 不复用（宁可重跑）', () => {
    resetWorkspace();
    writeFileSync(join(ws, 'a.txt'), 'A', 'utf-8');
    const snapshot = captureWorkspaceSnapshot(TASK_ID);
    // 大小变化即可触发"未变"判据失败（mtime 精度在不同盘上未必稳定）
    writeFileSync(join(ws, 'a.txt'), 'BB', 'utf-8');

    const reusable = selectReusableSteps({
      previousSteps: [
        { status: 'completed', description: '写 a', artifacts: ['a.txt'] },
      ],
      snapshot,
    });
    expect(reusable).toEqual([]);
  });

  it('applyReusableSteps：同描述 pending 步骤置 completed 并回填产物；描述改写不匹配', () => {
    const plan = {
      id: 'plan_test',
      description: '复用测试',
      status: 'running',
      createdAt: new Date().toISOString(),
      sessionId: 's',
      steps: [
        {
          id: 's1',
          description: '写  a',
          status: 'pending',
          taskId: 't1',
          retryCount: 0,
          maxRetries: 3,
        },
        {
          id: 's2',
          description: '改写后的步骤',
          status: 'pending',
          taskId: 't2',
          retryCount: 0,
          maxRetries: 3,
        },
      ],
    } as unknown as Plan;

    const applied = applyReusableSteps(plan, [
      { description: '写 a', result: 'done', artifacts: ['a.txt'] },
    ]);
    expect(applied).toBe(1);
    expect(plan.steps[0].status).toBe('completed');
    expect(plan.steps[0].result).toBe('done');
    expect(plan.steps[0].artifacts).toEqual(['a.txt']);
    expect(plan.steps[1].status).toBe('pending');
  });
});

describe('T1 复用匹配与产物一致性边界（2026-11-09）', () => {
  const ws = resolveTaskWorkspace(TASK_ID);

  function resetWorkspace(): void {
    rmSync(ws, { recursive: true, force: true });
    mkdirSync(ws, { recursive: true });
  }

  it('同大小且 mtime 被还原的改写 ⇒ 内容哈希仍能识别（不复用）', () => {
    resetWorkspace();
    const file = join(ws, 'a.txt');
    writeFileSync(file, 'AAAA', 'utf-8');
    const snapshot = captureWorkspaceSnapshot(TASK_ID);
    const entry = snapshot.files.find((f) => f.path === 'a.txt');
    // 锁住"哈希已进入快照"——否则本用例会退化成 size+mtime 判据而失去意义
    expect(entry?.sha256).toBeDefined();
    // 同大小改写 + 把 mtime 还原：size+mtime 判据会误判为"未变"
    writeFileSync(file, 'BBBB', 'utf-8');
    if (entry) {
      const mtime = new Date(entry.modifiedAt);
      utimesSync(file, mtime, mtime);
    }
    const reusable = selectReusableSteps({
      previousSteps: [
        { status: 'completed', description: '写 a', artifacts: ['a.txt'] },
      ],
      snapshot,
    });
    expect(reusable).toEqual([]);
  });

  it('描述重复的已完成步骤 ⇒ 全部不复用（避免错配）', () => {
    resetWorkspace();
    writeFileSync(join(ws, 'a.txt'), 'A', 'utf-8');
    const snapshot = captureWorkspaceSnapshot(TASK_ID);
    const reusable = selectReusableSteps({
      previousSteps: [
        { status: 'completed', description: '写 a', artifacts: ['a.txt'] },
        { status: 'completed', description: '写 a', artifacts: ['a.txt'] },
      ],
      snapshot,
    });
    expect(reusable).toEqual([]);
  });
});

describe('T2 计划层集成：prepareReplan → applyReusableSteps', () => {
  const ws = resolveTaskWorkspace(TASK_ID);

  function resetWorkspace(): void {
    rmSync(ws, { recursive: true, force: true });
    mkdirSync(ws, { recursive: true });
  }

  function makePlan(descriptions: string[]): Plan {
    return {
      id: 'plan_integration',
      description: '增量复用集成',
      status: 'running',
      createdAt: new Date().toISOString(),
      sessionId: 's',
      steps: descriptions.map((description, i) => ({
        id: `s${i + 1}`,
        description,
        status: 'pending',
        taskId: `t${i + 1}`,
        retryCount: 0,
        maxRetries: 3,
      })),
    } as unknown as Plan;
  }

  it('4 completed + 1 failed：逐字描述复用 4 步；改写描述复用 0 步', () => {
    resetWorkspace();
    for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) {
      writeFileSync(join(ws, name), name, 'utf-8');
    }
    const snapshot = captureWorkspaceSnapshot(TASK_ID);
    const previousSteps = [
      { status: 'completed', description: '步骤1 写 a', artifacts: ['a.txt'] },
      { status: 'completed', description: '步骤2 写 b', artifacts: ['b.txt'] },
      { status: 'completed', description: '步骤3 写 c', artifacts: ['c.txt'] },
      { status: 'completed', description: '步骤4 写 d', artifacts: ['d.txt'] },
      { status: 'failed', description: '步骤5 修复引用' },
    ];
    const summary = prepareReplan({
      taskId: TASK_ID,
      sessionId: null,
      previousSteps,
      capture: () => snapshot,
    });
    expect(summary.reusable).toHaveLength(4);

    const verbatim = makePlan([
      '步骤1 写 a',
      '步骤2 写 b',
      '步骤3 写 c',
      '步骤4 写 d',
      '步骤5 修复引用',
    ]);
    expect(applyReusableSteps(verbatim, summary.reusable)).toBe(4);

    const rephrased = makePlan([
      '创建 a.txt',
      '创建 b.txt',
      '创建 c.txt',
      '创建 d.txt',
      '修复引用',
    ]);
    expect(applyReusableSteps(rephrased, summary.reusable)).toBe(0);
    expect(rephrased.steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('传入 workspace ⇒ 快照根目录用会话工作区（不再取任务隔离目录）', () => {
    const calls: Array<string | undefined> = [];
    prepareReplan({
      taskId: TASK_ID,
      previousSteps: [],
      workspace: 'C:/work/session-project',
      capture: (taskId, workspaceArg) => {
        calls.push(workspaceArg);
        return {
          taskId,
          capturedAt: new Date().toISOString(),
          workspace: workspaceArg ?? '',
          entries: 0,
          truncated: false,
          files: [],
        };
      },
    });
    expect(calls).toEqual(['C:/work/session-project']);
  });
});
