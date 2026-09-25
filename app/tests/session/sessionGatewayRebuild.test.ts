/**
 * P2-7（2026-09-25）：`SessionGateway` 恢复入口与派生状态重建入口。
 *
 * 覆盖 spec §7：
 * - `recoverAfterCrash()` **只真正执行一次**（懒初始化路径与显式编排路径共用同一执行）；
 * - `rebuildDerivedState()` 全量 / 单会话均可调用、幂等、统计正确、单会话失败不中断整体。
 */
import { describe, test, expect, afterEach, beforeEach, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SessionGateway } from '../../src/session/SessionGateway';
import { StorageType } from '../../src/session/storage/UnifiedStorage';
import { CrashRecoveryManager } from '../../src/session/recovery/CrashRecoveryManager';
import { resetFTS5SearchEngine } from '../../src/session/FTS5SearchEngine';

const WORKTREE_HASH = 'testhash';
const gateways: SessionGateway[] = [];
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'gw-recovery-'));
  process.env.LIRI_DATA_DIR = dataDir;
  resetFTS5SearchEngine();
});

afterEach(async () => {
  for (const gw of gateways.splice(0)) {
    try {
      await gw.close();
    } catch {
      // 关闭失败不影响断言
    }
  }
  delete process.env.LIRI_DATA_DIR;
  resetFTS5SearchEngine();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // 清理失败不影响断言
  }
});

function makeFsGateway(): SessionGateway {
  const gw = new SessionGateway({
    storageConfig: {
      type: StorageType.FILESYSTEM,
      basePath: join(dataDir, 'sessions', WORKTREE_HASH),
    },
  });
  gateways.push(gw);
  return gw;
}

describe('P2-7: 崩溃恢复只执行一次（懒路径与编排路径共用）', () => {
  const realRecover = CrashRecoveryManager.prototype.recoverAfterCrash;
  let calls = 0;

  beforeEach(() => {
    calls = 0;
    CrashRecoveryManager.prototype.recoverAfterCrash = async function (
      this: CrashRecoveryManager
    ) {
      calls++;
      return realRecover.call(this);
    };
  });

  afterEach(() => {
    CrashRecoveryManager.prototype.recoverAfterCrash = realRecover;
  });

  test('先 initialize() 再 recoverAfterCrash() ⇒ 底层只执行一次', async () => {
    const gw = makeFsGateway();
    await gw.initialize();
    expect(calls).toBe(1);

    const result = await gw.recoverAfterCrash();
    expect(calls).toBe(1); // 复用缓存，不重复扫描
    expect(result.totalChecked).toBe(0);
  });

  test('先 recoverAfterCrash() 再 initialize() ⇒ 底层仍只执行一次', async () => {
    const gw = makeFsGateway();
    await gw.recoverAfterCrash();
    expect(calls).toBe(1);

    await gw.initialize();
    expect(calls).toBe(1);
  });
});

describe('P2-7: rebuildDerivedState（派生状态重建入口）', () => {
  test('单会话重建：统计返回完整，且重复调用幂等（第二次不再修正 roundCount）', async () => {
    const gw = makeFsGateway();
    await gw.initialize();
    await gw.createSession({ id: 's-rb-1', title: 'rb-1' });

    const first = await gw.rebuildDerivedState({ sessionId: 's-rb-1' });
    expect(first.scopes).toBe(1);
    expect(first.failures).toEqual([]);
    expect(first.ftsDocs).toBe(0); // 无消息

    const second = await gw.rebuildDerivedState({ sessionId: 's-rb-1' });
    expect(second.roundCountFixed).toBe(0); // 已收敛 ⇒ 幂等
    expect(second.scopes).toBe(1);
  });

  test('全量重建：返回会话规模且无失败项', async () => {
    const gw = makeFsGateway();
    await gw.initialize();
    await gw.createSession({ id: 's-rb-a', title: 'a' });
    await gw.createSession({ id: 's-rb-b', title: 'b' });

    const stats = await gw.rebuildDerivedState();
    expect(stats.scopes).toBeGreaterThanOrEqual(2);
    expect(stats.failures).toEqual([]);
  });

  test('单会话读盘失败 ⇒ 记入 failures 且**不抛出**（整体不中断）', async () => {
    const gw = makeFsGateway();
    await gw.initialize();
    const storage = gw.getStorage();
    const spy = spyOn(storage, 'getMessages');
    spy.mockImplementationOnce(async () => {
      throw new Error('读盘失败');
    });

    const stats = await gw.rebuildDerivedState({ sessionId: 's-rb-x' });
    expect(stats.failures).toEqual([
      { sessionId: 's-rb-x', error: '读盘失败' },
    ]);
    expect(stats.scopes).toBe(1);
  });
});
