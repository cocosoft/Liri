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
} from 'node:fs';
import { join } from 'node:path';
import { resolvePyappHome } from '@openliri/infra/environment';
import { resolveTaskWorkspace } from '@modules/agent';
import {
  captureWorkspaceSnapshot,
  prepareReplan,
} from '../../src/tasks/lro/replanGuard';
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
      expect(summary).toEqual({ total: 3, previouslyCompleted: 2 });
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
      expect(summary).toEqual({ total: 1, previouslyCompleted: 0 });
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
      expect(summary).toEqual({ total: 1, previouslyCompleted: 1 });
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
