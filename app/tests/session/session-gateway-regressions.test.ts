// MIT License
// Copyright (c) 2026 190615273@qq.com
// 会话系统升级优化方案（dev_docs/20260916）已确认修复项回归测试
// 覆盖：
//   H3（initialize 失败后 initialized 仍 false，可重试）
//   H9（forkSession 复制失败回滚子会话，无孤儿残留）
//   H2（close() 调用 storage.close() 落盘 pending 写队列）
//   M1（listLiteSessions 使用 storage.getStorageInfo().basePath）
//   M5（sendMessage 直连 indexMessageToFTS，FTS 可搜索命中）
//   M6（SessionManager 无 lock 字段）

import { describe, expect, it, afterEach, beforeEach, spyOn } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { SessionGateway } from '../../src/session/SessionGateway';
import { SessionManager } from '../../src/session/SessionManager';
import { EventLogStorage } from '../../src/session/storage/EventLogStorage';
import { FileSystemUnifiedStorage } from '../../src/session/storage/FileSystemUnifiedStorage';
import { MemoryUnifiedStorage } from '../../src/session/storage/MemoryUnifiedStorage';
import { StorageType } from '../../src/session/storage/UnifiedStorage';
import {
  getSessionParent,
  isAncestorSession,
  resetSessionLineage,
} from '../../src/session/lineage/sessionLineage';
import {
  getFTS5SearchEngine,
  resetFTS5SearchEngine,
} from '../../src/session/FTS5SearchEngine';
import { MessageType, MessageRole } from '../../src/session/types/Message';
import type { UnifiedMessage } from '../../src/session/types/Message';
import type { LiriEvent } from '../../src/chat/types/events';

/** forkSession 测试目录布局：<dataDir>/sessions/testhash/<sessionId>/ */
const WORKTREE_HASH = 'testhash';

/** 已创建的网关（afterEach 统一 close，清理 FTS 持久化定时器） */
const gateways: SessionGateway[] = [];

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'gw-reg-'));
  // 隔离 FTS 索引路径（resolveDataDir() 实时读 env）与 transcript 目录
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

function makeMemGateway(): SessionGateway {
  const gw = new SessionGateway({
    storageConfig: { type: StorageType.MEMORY },
  });
  gateways.push(gw);
  return gw;
}

function makeEvent(seq: number, sessionId: string): LiriEvent {
  return {
    type: 'user/message',
    schemaVersion: 1,
    seq,
    time: 1700000000000 + seq * 1000,
    sessionId,
    data: { content: 'hi', messageId: `m${seq}` },
  };
}

describe('H3: initialize 失败后可重试', () => {
  it('storage.initialize 首次抛错 → initialize() rejects，initialized 仍 false，再次调用成功', async () => {
    const gateway = makeMemGateway();
    const storage = gateway.getStorage() as MemoryUnifiedStorage;
    const initSpy = spyOn(storage, 'initialize');
    initSpy.mockImplementationOnce(async () => {
      throw new Error('simulated init failure');
    });

    await expect(gateway.initialize()).rejects.toThrow(
      'simulated init failure'
    );
    expect(initSpy).toHaveBeenCalledTimes(1);
    // H3 核心：若 initialized 在首个 await 前置 true，重试会被 return 短路
    expect((gateway as unknown as { initialized: boolean }).initialized).toBe(
      false
    );

    await gateway.initialize();
    expect(initSpy).toHaveBeenCalledTimes(2);
    expect((gateway as unknown as { initialized: boolean }).initialized).toBe(
      true
    );
  });
});

describe('H9: forkSession 复制失败回滚子会话', () => {
  // 本 describe 多处 `spyOn(EventLogStorage.prototype, 'copyPrefixTo')`；
  // bun 的 spy 不会自动恢复 ⇒ 显式还原原型方法，避免 mock 泄漏到后续用例
  const realCopyPrefixTo = EventLogStorage.prototype.copyPrefixTo;
  afterEach(() => {
    EventLogStorage.prototype.copyPrefixTo = realCopyPrefixTo;
  });

  it('copyPrefixTo 失败 → 子会话被 deleteSession 回滚，无孤儿残留', async () => {
    const gateway = makeFsGateway();
    await gateway.initialize();

    const sourceId = 's-h9-source';
    const childId = 's-h9-child';
    await gateway.createSession({ id: sourceId, title: 'H9 source' });

    // 写源事件日志（seq=1），使 tailSeq=1 满足 boundary 校验
    const evDir = join(dataDir, 'sessions', WORKTREE_HASH, sourceId);
    mkdirSync(evDir, { recursive: true });
    writeFileSync(
      join(evDir, 'events.jsonl'),
      JSON.stringify(makeEvent(1, sourceId)) + '\n',
      'utf-8'
    );

    // 模拟前缀复制失败
    const copySpy = spyOn(EventLogStorage.prototype, 'copyPrefixTo');
    copySpy.mockImplementation(async () => ({
      ok: false,
      copied: 0,
      reason: 'target-not-empty',
    }));

    const result = await gateway.forkSession(sourceId, { childId });

    expect(result.success).toBe(false);
    expect(result.error).toContain('copy prefix failed');
    expect(copySpy).toHaveBeenCalledTimes(1);
    // H9 核心：复制失败后子会话已被删除（getSession 返回 null）
    expect(await gateway.getSession(childId)).toBeNull();
  });

  /**
   * M-2（2026-09-22）：血缘登记**后置到复制成功之后**。
   *
   * 修复前 `registerSessionLineage` 在 `copyPrefixTo` **之前**调用，而失败分支只
   * `deleteSession`（软删会话）**不撤销血缘**（全仓亦无 `unregisterSessionLineage`）
   * ⇒ 留下"子会话已删、血缘仍在"的**悬挂边**：控制面 Tier1 祖先判定会把它当成
   * 合法祖先链的一环（对一个已不存在的会话授予同族控制权）。
   */
  it('复制失败 ⇒ **不建立血缘**（无悬挂边）', async () => {
    const gateway = makeFsGateway();
    await gateway.initialize();
    resetSessionLineage();

    const sourceId = 's-m2-source';
    const childId = 's-m2-child';
    await gateway.createSession({ id: sourceId, title: 'M2 source' });

    const evDir = join(dataDir, 'sessions', WORKTREE_HASH, sourceId);
    mkdirSync(evDir, { recursive: true });
    writeFileSync(
      join(evDir, 'events.jsonl'),
      JSON.stringify(makeEvent(1, sourceId)) + '\n',
      'utf-8'
    );

    const copySpy = spyOn(EventLogStorage.prototype, 'copyPrefixTo');
    copySpy.mockImplementation(async () => ({
      ok: false,
      copied: 0,
      reason: 'test-forced-failure',
    }));

    const result = await gateway.forkSession(sourceId, { childId });
    expect(result.success).toBe(false);

    // 修复前：此处为 sourceId（悬挂边）
    expect(getSessionParent(childId)).toBeNull();
    // 且不得据此把"已删子会话"接到祖先链上
    expect(isAncestorSession(sourceId, childId)).toBe(false);
  });

  it('复制成功 ⇒ 建立血缘（成功路径不受影响）', async () => {
    const gateway = makeFsGateway();
    await gateway.initialize();
    resetSessionLineage();

    const sourceId = 's-m2-ok-source';
    const childId = 's-m2-ok-child';
    await gateway.createSession({ id: sourceId, title: 'M2 ok source' });

    const evDir = join(dataDir, 'sessions', WORKTREE_HASH, sourceId);
    mkdirSync(evDir, { recursive: true });
    writeFileSync(
      join(evDir, 'events.jsonl'),
      JSON.stringify(makeEvent(1, sourceId)) + '\n',
      'utf-8'
    );

    const result = await gateway.forkSession(sourceId, { childId });
    expect(result.success).toBe(true);
    expect(getSessionParent(childId)).toBe(sourceId);
    expect(isAncestorSession(sourceId, childId)).toBe(true);
  });
});

describe('H2: close 落盘 storage', () => {
  it('close() 调用 storage.close()（flush pending 写队列）', async () => {
    const gateway = makeFsGateway();
    const storage = gateway.getStorage() as FileSystemUnifiedStorage;
    const closeSpy = spyOn(storage, 'close');

    await gateway.close();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('M1: listLiteSessions 使用 storage basePath', () => {
  it('返回 storageConfig.basePath 指向目录中的会话（不再硬编码 resolveSessionsDir）', async () => {
    const gateway = makeFsGateway();
    await gateway.initialize();
    await gateway.createSession({ id: 's-m1', title: 'M1 title' });

    // 手写一个未注册的会话目录，验证扫描根是 storage basePath 而非默认 sessions 目录
    const strayDir = join(dataDir, 'sessions', WORKTREE_HASH, 'stray');
    mkdirSync(strayDir, { recursive: true });
    writeFileSync(
      join(strayDir, 'session.json'),
      JSON.stringify({
        id: 'stray',
        title: 'StrayTitle',
        status: 'active',
        updatedAt: 1700000000000,
      }),
      'utf-8'
    );

    const list = await gateway.listLiteSessions();
    const ids = list.map((s) => s.id);
    expect(ids).toContain('s-m1');
    expect(ids).toContain('stray');
  });
});

describe('M5: sendMessage 直连 FTS 索引', () => {
  it('sendMessage 后 FTS 搜索命中 msg_<id> 文档（不依赖 eventBus 装配时序）', async () => {
    const gateway = makeFsGateway();
    await gateway.initialize();
    await gateway.createSession({ id: 's-m5' });

    const msg: UnifiedMessage = {
      id: 'm5-msg-1',
      sessionId: 's-m5',
      type: MessageType.USER,
      role: MessageRole.USER,
      content: 'm5uniquetokenxyz',
      timestamp: Date.now(),
    };
    await gateway.sendMessage('s-m5', msg);

    const results = getFTS5SearchEngine().search('m5uniquetokenxyz');
    expect(results.some((r) => r.document.id === 'msg_m5-msg-1')).toBe(true);
  });
});

describe('M6: SessionManager 无 lock 字段', () => {
  it('构造后实例不含 lock 属性（已删除从未 acquire 的字段）', () => {
    const manager = new SessionManager({
      storageRootDir: join(dataDir, 'sessions'),
      enableMigration: false,
      enablePruner: false,
      enableLock: false,
    });
    const rec = manager as unknown as Record<string, unknown>;
    expect(rec['lock']).toBeUndefined();
    expect('lock' in manager).toBe(false);
  });
});
