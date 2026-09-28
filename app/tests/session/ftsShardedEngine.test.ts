/**
 * FTS 分片引擎契约（分片重构 §8-4/§8-5/§8-6）
 *
 * 锁定：
 *  ① 会话内检索只读该会话的片（不同会话同词不串）；
 *  ② 全局检索 = 清单 ∪ 缓存 扇出 + 归并，排序键 `(score desc, docId asc)`；
 *  ③ `sessionIds` 作用域仅影响**片选择**，命中过滤仍由 `metadataFilter` 下推（N-66 语义）；
 *  ④ 片缺失/损坏 ⇒ 跳过该片，不阻塞其余结果、不抛错；
 *  ⑤ 新建片**未落盘也立即可检索**（M5 场景：发消息后立即搜索须命中）；
 *  ⑥ `rebuildSession()` 整片替换 / `remove()` 按会话删除；
 *  ⑦ 无 `metadata.sessionId` 的文档被拒收（分片模型下无归属）；
 *  ⑧ 扇出超时 ⇒ 返回已收集结果并告警，不无限等待；
 *  ⑨ `getStats()` 全部由清单汇总（零读片）。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  FTS5SearchEngine,
  type FTSDocument,
} from '../../src/session/FTS5SearchEngine';
import { FTSIndexStore } from '../../src/session/persistence/FTSIndexStore';

const dirs: string[] = [];

function tempIndexDir(): string {
  const parent = mkdtempSync(join(tmpdir(), 'fts-engine-'));
  dirs.push(parent);
  return join(parent, 'fts-index');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function doc(
  sessionId: string,
  id: string,
  content: string,
  title = ''
): FTSDocument {
  return {
    id,
    title,
    content,
    category: 'message',
    timestamp: 1,
    metadata: { sessionId, messageId: id },
  };
}

/** 建一个隔离的 store + engine（不用全局单例，避免用例间串扰） */
function makeEngine(indexDir = tempIndexDir()): {
  store: FTSIndexStore;
  engine: FTS5SearchEngine;
  indexDir: string;
} {
  const store = new FTSIndexStore(indexDir);
  return { store, engine: new FTS5SearchEngine(store), indexDir };
}

describe('§8-5：分片检索', () => {
  test('会话内检索只读该会话片：不同会话同词不串', async () => {
    const { engine } = makeEngine();
    await engine.index(doc('s-a', 'a1', '共同关键词 needle'));
    await engine.index(doc('s-b', 'b1', '共同关键词 needle'));

    const scoped = await engine.search('needle', { sessionIds: ['s-a'] });
    expect(scoped.map((r) => r.document.id)).toEqual(['a1']);

    const global = await engine.search('needle');
    expect(global.map((r) => r.document.id).sort()).toEqual(['a1', 'b1']);
  });

  test('新建片未落盘也可立即检索（M5：发消息后立即搜索须命中）', async () => {
    const { engine, store } = makeEngine();
    await engine.index(doc('s-new', 'n1', 'm5uniquetokenxyz'));

    expect(await store.knownShardIds()).toEqual(['s-new']); // 清单尚无记录，靠缓存可见
    const results = await engine.search('m5uniquetokenxyz');
    expect(results.map((r) => r.document.id)).toEqual(['n1']);
  });

  test('全局归并排序：score desc，平局按 docId asc（排序稳定性）', async () => {
    const { engine } = makeEngine();
    // 标题命中 = +3，正文命中 = +1
    await engine.index(doc('s-a', 'a-title', 'zzz', 'needle'));
    await engine.index(doc('s-b', 'b-body', 'needle'));
    await engine.index(doc('s-c', 'c-body', 'needle')); // 与 b-body 同分

    const results = await engine.search('needle');
    expect(results.map((r) => r.document.id)).toEqual([
      'a-title',
      'b-body',
      'c-body',
    ]);
  });

  test('作用域 + 谓词下推：片选择与命中过滤各司其职（N-66 语义不变）', async () => {
    const { engine } = makeEngine();
    await engine.index(doc('s-a', 'a1', 'needle'));
    await engine.index(doc('s-b', 'b1', 'needle'));

    const results = await engine.search('needle', {
      sessionIds: ['s-a', 's-b'],
      metadataFilter: (d) => d.metadata?.sessionId === 's-b',
    });
    expect(results.map((r) => r.document.id)).toEqual(['b1']);
  });

  test('片损坏 ⇒ 跳过该片，其余结果照常返回（不抛）', async () => {
    const indexDir = tempIndexDir();
    const seed = makeEngine(indexDir);
    await seed.engine.index(doc('s-bad', 'x1', 'needle'));
    await seed.engine.index(doc('s-good', 'g1', 'needle'));
    await seed.store.flushPendingShards();

    writeFileSync(seed.store.shardPath('s-bad'), 'broken', 'utf-8');
    const { engine } = makeEngine(indexDir);

    const results = await engine.search('needle');
    expect(results.map((r) => r.document.id)).toEqual(['g1']);
  });

  test('扇出超时 ⇒ 返回已收集结果且不抛错', async () => {
    const { engine } = makeEngine();
    await engine.index(doc('s-a', 'a1', 'needle'));
    await engine.index(doc('s-b', 'b1', 'needle'));

    const results = await engine.search('needle', { fanout: { timeoutMs: 0 } });
    expect(Array.isArray(results)).toBe(true);
  });
});

describe('§8-6：分片写入/重建', () => {
  test('rebuildSession 整片替换：旧文档被清除，新文档生效', async () => {
    const { engine } = makeEngine();
    await engine.index(doc('s1', 'old', '旧内容 legacyonly'));
    expect((await engine.search('legacyonly')).length).toBe(1);

    await engine.rebuildSession('s1', [doc('s1', 'new', '新内容 freshonly')]);
    expect((await engine.search('legacyonly')).length).toBe(0);
    expect(
      (await engine.search('freshonly')).map((r) => r.document.id)
    ).toEqual(['new']);
  });

  test('remove 按会话删除：只影响该会话片', async () => {
    const { engine } = makeEngine();
    await engine.index(doc('s-a', 'same-id', 'needle 甲'));
    await engine.index(doc('s-b', 'same-id', 'needle 乙'));

    await engine.remove('s-a', 'same-id');
    const results = await engine.search('needle');
    expect(results.map((r) => r.document.id)).toEqual(['same-id']);
    expect(results[0].document.content).toBe('needle 乙');
  });

  test('无 metadata.sessionId 的文档被拒收（不抛、不产生片）', async () => {
    const { engine, store } = makeEngine();
    await engine.index({
      id: 'orphan',
      title: '',
      content: 'needle 无归属',
      category: 'message',
      timestamp: 1,
    });

    expect(await store.knownShardIds()).toEqual([]);
    expect(await engine.search('needle')).toEqual([]);
  });

  test('getStats 由清单汇总：与落盘后的清单条目一致（零读片）', async () => {
    const { engine, store } = makeEngine();
    await engine.index(doc('s-a', 'a1', 'alpha beta'));
    await engine.index(doc('s-a', 'a2', 'beta'));
    await engine.index(doc('s-b', 'b1', 'gamma'));

    await engine.flush();

    const manifest = await store.readManifest();
    const expectedDocs = Object.values(manifest.shards).reduce(
      (sum, e) => sum + e.docCount,
      0
    );
    const expectedTerms = Object.values(manifest.shards).reduce(
      (sum, e) => sum + e.termCount,
      0
    );
    const expectedLength = Object.values(manifest.shards).reduce(
      (sum, e) => sum + e.contentLength,
      0
    );

    const stats = await engine.getStats();
    expect(stats.documentCount).toBe(expectedDocs);
    expect(stats.documentCount).toBe(3);
    expect(stats.termCount).toBe(expectedTerms);
    expect(stats.avgDocLength).toBe(Math.round(expectedLength / expectedDocs));
  });
});
