/**
 * CompileProgressTracker 阶段状态机单测（方案 B v7 验收）
 *
 * 覆盖方案文档中 G17 / G19 / G20 / G22 / G23 / G24 的判据：
 * - 终态无 pending/running 残留（G17/G19/G20 共同判据）
 * - skipPhase 支持 pending → skipped（G9/G19）
 * - abort 路径 settle + 独立断言（G22）
 * - 新会话复位 sessionTerminated 与 status（G23/G29）
 * - sessionId / seq 全局单调不归零（G24）
 * - triggered 是独立终态，不被 finish 折叠（G16）
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { setUserDataDirOverride, resolveDataSubDir } from '@modules/core/paths';
import {
  beginCompileSession,
  setSessionTotal,
  enterPhase,
  updatePhaseDetail,
  completePhase,
  skipPhase,
  markTriggered,
  finishCompileSession,
  abortCompileProgress,
  settleUnfinishedStages,
  getCompileProgress,
} from '../CompileProgressTracker';
import type { CompilePhase, PhaseSnapshot } from '../CompileProgressTracker';

function snap(phase: CompilePhase): PhaseSnapshot {
  const p = getCompileProgress().phases.find((x) => x.phase === phase);
  if (!p) throw new Error(`缺少阶段快照: ${phase}`);
  return p;
}

function unsettled(): PhaseSnapshot[] {
  return getCompileProgress().phases.filter(
    (p) => p.status === 'pending' || p.status === 'running'
  );
}

// 沙箱：tracker 会把 lastSession 落盘到 <dataDir>/knowledge/，测试必须重定向到临时目录，
// 否则会污染真实用户数据目录（路径为懒解析，故此处 set 之后即生效）
let tempRoot = '';
beforeAll(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'kb-cpt-'));
  setUserDataDirOverride(tempRoot);
});
afterAll(async () => {
  setUserDataDirOverride(null);
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('CompileProgressTracker 阶段状态机', () => {
  it('正常流：全阶段 settle，且 indexing 保持 triggered（G16）', () => {
    beginCompileSession();
    enterPhase('scanning');
    setSessionTotal(2);
    completePhase();
    enterPhase('cleaning');
    completePhase();
    enterPhase('compiling', { current: 0, total: 2 });
    updatePhaseDetail(2, 2);
    completePhase();
    skipPhase('linting', 'gated');
    skipPhase('graph_extract', 'empty');
    skipPhase('record_extract', 'gated');
    skipPhase('rule_extract', 'gated');
    skipPhase('chunk_refresh', 'gated');
    enterPhase('indexing');
    markTriggered('indexing');
    finishCompileSession({ compiled: 2, skipped: 0, errors: 0 });

    const s = getCompileProgress();
    expect(s.status).toBe('done');
    expect(unsettled().length).toBe(0);
    expect(snap('compiling').detail).toEqual({ current: 2, total: 2 });
    expect(snap('indexing').status).toBe('triggered');
    expect(snap('graph_extract').skipReason).toBe('empty');
    expect(s.result).toEqual({ compiled: 2, skipped: 0, errors: 0 });
  });

  it('skipPhase 支持 pending → skipped（G9/G19）', () => {
    beginCompileSession();
    // graph_extract 仍为 pending（未 enter）即跳过 —— A5a/A5b/A5c 三条路径都依赖这条迁移
    skipPhase('graph_extract', 'gated');
    expect(snap('graph_extract').status).toBe('skipped');
    expect(snap('graph_extract').skipReason).toBe('gated');
  });

  it('abort：settle 残留阶段并记录 lastError（G22）', () => {
    beginCompileSession();
    enterPhase('scanning');
    completePhase();
    enterPhase('cleaning');
    abortCompileProgress('boom');

    const s = getCompileProgress();
    expect(s.status).toBe('done');
    expect(s.lastError).toBe('boom');
    expect(unsettled().length).toBe(0);
    expect(snap('cleaning').status).toBe('skipped');
    expect(snap('cleaning').skipReason).toBe('aborted');
  });

  it('abort 幂等：随后 finish 不覆盖 lastError（C7）', () => {
    beginCompileSession();
    abortCompileProgress('first');
    finishCompileSession({ compiled: 9, skipped: 9, errors: 9 });

    const s = getCompileProgress();
    expect(s.lastError).toBe('first');
    expect(s.result).toBeNull();
  });

  it('新会话复位 status 与 sessionTerminated，可正常收尾（G23/G29）', () => {
    beginCompileSession();
    const idAfterAbort0 = getCompileProgress().sessionId;
    abortCompileProgress('boom');
    expect(getCompileProgress().status).toBe('done');

    beginCompileSession();
    const s = getCompileProgress();
    expect(s.status).toBe('compiling'); // G29：必须显式复位
    expect(s.sessionId).toBeGreaterThan(idAfterAbort0);
    expect(s.lastError).toBeNull();

    // G23：sessionTerminated 已复位 → finish 生效
    finishCompileSession({ compiled: 1, skipped: 0, errors: 0 });
    expect(getCompileProgress().status).toBe('done');
  });

  it('sessionId / seq 全局单调不归零（G24）', () => {
    beginCompileSession();
    enterPhase('scanning');
    completePhase();
    const before = getCompileProgress();

    beginCompileSession();
    const after = getCompileProgress();
    expect(after.sessionId).toBeGreaterThan(before.sessionId);
    expect(after.seq).toBeGreaterThanOrEqual(before.seq);
    expect(after.phase).toBeNull();
    expect(after.phases.every((p) => p.status === 'pending')).toBe(true);
  });

  it('settleUnfinishedStages 兜底 pending 与 running', () => {
    beginCompileSession();
    enterPhase('compiling');
    settleUnfinishedStages('aborted');

    expect(unsettled().length).toBe(0);
    expect(snap('compiling').status).toBe('skipped');
    expect(snap('scanning').status).toBe('skipped');
    expect(snap('scanning').skipReason).toBe('aborted');
  });

  it('finish 在未启动时 no-op（不当成新会话收尾）', () => {
    // 先把上一会话走到 done（若已是 idle 则此步安全无副作用）
    beginCompileSession();
    finishCompileSession({ compiled: 0, skipped: 0, errors: 0 });
    const first = getCompileProgress();
    // 再次 finish：status 已是 done → 不应改变 result
    finishCompileSession({ compiled: 7, skipped: 7, errors: 7 });
    expect(getCompileProgress().result).toEqual(first.result);
  });

  it('finish 落 lastSession 摘要：60s 复位后空闲态仍可复盘', () => {
    beginCompileSession();
    for (const p of [
      'scanning',
      'cleaning',
      'compiling',
      'linting',
      'graph_extract',
      'record_extract',
      'rule_extract',
      'chunk_refresh',
      'indexing',
    ] as const) {
      skipPhase(p, 'gated');
    }
    finishCompileSession({ compiled: 3, skipped: 4, errors: 1 });

    const s = getCompileProgress();
    expect(s.lastSession).not.toBeNull();
    expect(s.lastSession?.outcome).toBe('done');
    expect(s.lastSession?.result).toEqual({
      compiled: 3,
      skipped: 4,
      errors: 1,
    });
    // 终态快照完整保留 9 阶段，供空闲态复现 stepper
    expect(s.lastSession?.phases.length).toBe(9);
    expect(s.lastSession?.sessionId).toBe(s.sessionId);
  });

  it('abort 落 lastSession 摘要：outcome=aborted 且带失败原因', () => {
    beginCompileSession();
    enterPhase('scanning');
    abortCompileProgress('boom');
    const s = getCompileProgress();
    expect(s.lastSession?.outcome).toBe('aborted');
    expect(s.lastSession?.lastError).toBe('boom');
  });

  it('updatePhaseDetail：非 compiling 阶段不污染顶层 current/total（契约）', () => {
    beginCompileSession();
    setSessionTotal(10);
    enterPhase('compiling', { current: 0, total: 10 });
    updatePhaseDetail(3, 10);
    completePhase();
    skipPhase('linting', 'gated');

    // 模拟 graph_extract 的页级进度（4 页）：只能写进阶段 detail
    enterPhase('graph_extract', { current: 0, total: 4 });
    updatePhaseDetail(4, 4);

    const s = getCompileProgress();
    expect(s.total).toBe(10); // 顶层保持文件级
    expect(s.current).toBe(3);
    expect(snap('graph_extract').detail).toEqual({
      current: 4,
      total: 4,
    });
  });

  it('落盘：finish 后摘要写入 compile-last-session.json（跨重启复盘）', async () => {
    beginCompileSession();
    for (const p of [
      'scanning',
      'cleaning',
      'compiling',
      'linting',
      'graph_extract',
      'record_extract',
      'rule_extract',
      'chunk_refresh',
      'indexing',
    ] as const) {
      skipPhase(p, 'gated');
    }
    finishCompileSession({ compiled: 5, skipped: 6, errors: 0 });

    const file = join(
      resolveDataSubDir('knowledge'),
      'compile-last-session.json'
    );
    expect(existsSync(file)).toBe(true);
    const saved = JSON.parse(await readFile(file, 'utf-8')) as {
      outcome: string;
      result: { compiled: number; skipped: number } | null;
    };
    expect(saved.outcome).toBe('done');
    expect(saved.result?.compiled).toBe(5);
    expect(saved.result?.skipped).toBe(6);
  });
});
