/**
 * `enforceSnapshotQuota` 单元守卫（2026-09-29 新增，spec `snapshot-storage-governance.md`）。
 *
 * 背景：该函数此前**零测试覆盖**；且"未超限 ⇒ 零输出" ⇒ 快照占用**不可观测**。
 * 本守卫锁两件事：
 *   ① **巡检可见性**：未超限时仍返回 `{0,0}` 且**不删任何快照**（新增的 INFO 巡检不改变语义）；
 *   ② **淘汰语义不回归**：超限 ⇒ **最旧优先**删到配额的 80%；**全场仅 1 条 ⇒ 不删**（边界保护）。
 *
 * ⚠️ **测试隔离（安全前提，已实测）**：`getSnapshotsRoot()` 在**调用时**读 `LIRI_DATA_DIR`
 * （非模块级冻结 —— 实测 `LIRI_DATA_DIR=C:/tmp-probe-snap` ⇒ `root=C:\tmp-probe-snap\snapshots`）。
 * 用例内把它指向临时目录，并在 `beforeEach` **硬断言**根目录落在临时目录下，
 * **避免误删真实 `~/.pyapp/data/snapshots`（实测 527 条 / 5 GB）**。
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ensureSnapshotDirs,
  getManifestPath,
  getSnapshotsRoot,
  saveManifest,
} from '../../src/security/rollback/SnapshotStorage';
import { enforceSnapshotQuota } from '../../src/security/rollback/CleanupManager';
import type { RoundSnapshot } from '../../src/security/rollback/types';

let tmpRoot = '';
const prevDataDir = process.env.LIRI_DATA_DIR;

function makeSnapshot(
  sessionId: string,
  roundId: number,
  createdAt: string,
  totalSize: number
): RoundSnapshot {
  return {
    roundId,
    sessionId,
    userMessageSummary: `round ${roundId}`,
    createdAt,
    changedFiles: [],
    totalSize,
    schemaVersion: 1,
    storeAfterVersion: false,
    scanStatus: 'complete',
    status: 'active',
  };
}

async function seed(snap: RoundSnapshot): Promise<void> {
  await ensureSnapshotDirs(snap.sessionId, snap.roundId);
  await saveManifest(snap);
}

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'liri-snap-quota-'));
  process.env.LIRI_DATA_DIR = tmpRoot;
});

beforeEach(() => {
  const root = getSnapshotsRoot();
  // 安全闸：根目录必须落在临时目录内，否则隔离失效 ⇒ 立即失败（防误删真实数据）
  if (!root.startsWith(tmpRoot)) {
    throw new Error(`测试隔离失效：快照根未指向临时目录（${root}）`);
  }
  rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  if (prevDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = prevDataDir;
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('enforceSnapshotQuota：巡检可见性与淘汰语义', () => {
  it('A1 未超限 ⇒ 不删、返回 {0,0}（巡检日志不改变语义）', async () => {
    await seed(makeSnapshot('s1', 1, '2026-01-01T00:00:00.000Z', 100));
    await seed(makeSnapshot('s1', 2, '2026-01-02T00:00:00.000Z', 100));

    const result = await enforceSnapshotQuota(10_000);

    expect(result).toEqual({ cleaned: 0, freedBytes: 0 });
    expect(existsSync(getManifestPath('s1', 1))).toBe(true);
    expect(existsSync(getManifestPath('s1', 2))).toBe(true);
  });

  it('A2 超限 ⇒ 删最旧（最早的先走），最新仍在', async () => {
    await seed(makeSnapshot('s1', 1, '2026-01-01T00:00:00.000Z', 100));
    await seed(makeSnapshot('s1', 2, '2026-01-02T00:00:00.000Z', 100));

    // 总 200 > 配额 150 ⇒ 目标 120 ⇒ 删 1 条（最旧）即达标
    const result = await enforceSnapshotQuota(150);

    expect(result.cleaned).toBe(1);
    expect(result.freedBytes).toBe(100);
    expect(existsSync(getManifestPath('s1', 1))).toBe(false);
    expect(existsSync(getManifestPath('s1', 2))).toBe(true);
  });

  it('A3 边界保护：全场仅 1 条且超限 ⇒ 不删', async () => {
    await seed(makeSnapshot('s1', 1, '2026-01-01T00:00:00.000Z', 100));

    const result = await enforceSnapshotQuota(10);

    expect(result).toEqual({ cleaned: 0, freedBytes: 0 });
    expect(existsSync(getManifestPath('s1', 1))).toBe(true);
  });
});
