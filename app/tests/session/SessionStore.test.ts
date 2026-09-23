// MIT License
// Copyright (c) 2026 190615273@qq.com
// M2 回归测试（2026-09-17）：
//   - load* 返回深拷贝副本（toJSON+fromJSON），禁止调用方污染缓存引用
//   - invalidate(sessionId) 供网关直写路径统一失效缓存 key，避免陈旧读
//   - saveMessage 联动失效 sessionCache/metadataCache（消息写入派生更新会话时间戳）
//   - 网关写后 adapter 读一致（S3 验证门禁）

import { describe, expect, it } from 'bun:test';
// 必须先求值 SessionManager：SessionStore → @modules/error → ... → plugins/index.ts
// 顶层动态 import PluginManager → SessionManager → 构造内 new SessionStore()，
// 若 SessionStore 仍处于求值中（TDZ）会崩溃。先 import SessionManager 使其完整求值
// （含其 hoisted 的 SessionStore/SessionPruner import），后续引用即安全。
// TODO: CS05-ROOTFIX — 根因是 SessionManager.ts 顶层 `new SessionManager()` 副作用，
// 懒加载单例后本 workaround 可移除。
import '../../src/session/SessionManager';
import { SessionStore } from '../../src/session/SessionStore';
import { MemoryUnifiedStorage } from '../../src/session/storage/MemoryUnifiedStorage';
import { UnifiedStorageAdapter } from '../../src/session/storage/UnifiedStorageAdapter';
import { SessionGateway } from '../../src/session/SessionGateway';
import { StorageType } from '../../src/session/storage/UnifiedStorage';
import { Session } from '../../src/session/models/Session';
import { SessionMessage } from '../../src/session/models/SessionMessage';
import { SessionMetadata } from '../../src/session/models/SessionMetadata';
import { SessionState } from '../../src/session/models/SessionState';

function makeSession(id: string): Session {
  return new Session(
    id,
    new SessionMetadata(`title-${id}`, ['t1'], 'default'),
    new SessionState('active'),
    [],
    new Date(1700000000000),
    new Date(1700000000000)
  );
}

function makeMessage(id: string, content: string): SessionMessage {
  return new SessionMessage(
    id,
    'user' as never,
    content,
    new Date(1700000000000)
  );
}

function makeStore(): { store: SessionStore; storage: MemoryUnifiedStorage } {
  const storage = new MemoryUnifiedStorage({ type: StorageType.MEMORY });
  const store = new SessionStore({
    storage: new UnifiedStorageAdapter(storage),
  });
  return { store, storage };
}

describe('M2: load* 返回深拷贝副本——调用方污染不达缓存', () => {
  it('loadSession 修改返回值后再次加载仍是原始值', async () => {
    const { store } = makeStore();
    await store.saveSession(makeSession('s1'));

    const a = await store.loadSession('s1');
    expect(a).not.toBeNull();
    a!.metadata.title = 'polluted';

    const b = await store.loadSession('s1');
    expect(b!.metadata.title).toBe('title-s1');
  });

  it('loadMessages 修改返回值后再次加载仍是原始内容', async () => {
    const { store } = makeStore();
    await store.saveMessage('s1', makeMessage('m1', 'hello'));

    const a = await store.loadMessages('s1');
    a[0].content = 'polluted';

    const b = await store.loadMessages('s1');
    expect(b[0].content).toBe('hello');
  });

  it('loadMetadata 修改返回值后再次加载仍是原始值', async () => {
    const { store } = makeStore();
    await store.saveMetadata(
      's1',
      new SessionMetadata('orig', ['t'], 'default')
    );

    const a = await store.loadMetadata('s1');
    a!.title = 'polluted';

    const b = await store.loadMetadata('s1');
    expect(b!.title).toBe('orig');
  });
});

describe('M2: invalidate 失效缓存 key——底层直写后读得新值', () => {
  it('invalidate 前读缓存旧值，invalidate 后读底层新值', async () => {
    const { store, storage } = makeStore();
    await store.saveSession(makeSession('s1'));
    await store.loadSession('s1'); // 命中缓存

    // 模拟网关直写 storage（绕过 SessionStore 写方法）
    const unified = await storage.getSession('s1');
    unified!.metadata!.title = 'direct-write';
    await storage.updateSession(unified!);

    // 未失效：仍读缓存旧值
    const stale = await store.loadSession('s1');
    expect(stale!.metadata.title).toBe('title-s1');

    store.invalidate('s1');
    const fresh = await store.loadSession('s1');
    expect(fresh!.metadata.title).toBe('direct-write');
  });
});

describe('M2: saveMessage 联动失效 sessionCache/metadataCache', () => {
  it('底层会话时间戳被消息写入派生更新后，saveMessage 使 loadSession 读得新值', async () => {
    const { store, storage } = makeStore();
    await store.saveSession(makeSession('s1'));
    await store.loadSession('s1'); // 命中缓存

    // 模拟底层写消息派生更新会话 updatedAt（saveMessage 前缓存仍为旧值）
    const unified = await storage.getSession('s1');
    unified!.updatedAt = 1999999999999;
    await storage.updateSession(unified!);
    await store.saveMessage('s1', makeMessage('m1', 'hi'));

    const fresh = await store.loadSession('s1');
    expect(fresh!.updatedAt.getTime()).toBe(1999999999999);
  });
});

describe('M2: 网关写路径失效 SessionStore 缓存——写后 adapter 读一致（S3 门禁）', () => {
  it('updateSession 后经 SessionStore 读到新值（非缓存旧值）', async () => {
    const gw = new SessionGateway({
      storageConfig: { type: StorageType.MEMORY },
    });
    const store = new SessionStore({
      storage: new UnifiedStorageAdapter(gw.getStorage()),
    });
    gw.setSessionStore(store);
    try {
      const session = await gw.createSession({
        title: 'old',
        metadata: { title: 'old' },
      });

      // 首次加载命中缓存
      const cached = await store.loadSession(session.id);
      expect(cached!.metadata.title).toBe('old');

      // 网关直写 storage（内部调用 store.invalidate）
      await gw.updateSession({
        ...session,
        metadata: { ...session.metadata, title: 'new' },
      });

      const fresh = await store.loadSession(session.id);
      expect(fresh!.metadata.title).toBe('new');
    } finally {
      await gw.close();
    }
  });
});
