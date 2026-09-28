/**
 * FTS 索引存储层契约（分片重构 §8-2 清单 / §8-3 片读写 / §8-6 片级删除与损坏登记）
 *
 * §8-2 清单：
 *  ① 原子替换写入（tmp + rename，不留残渣；目录不存在时自动创建）；
 *  ② 损坏兜底：首启 / 读取失败 / JSON 损坏 / 顶层结构非法 / 版本不符 ⇒
 *     **一律回落为空清单且不抛错**（清单为派生物，由下游重建片；抛错会中断调用链，
 *     历史事故：索引读取异常中断 `ensureSessionsLoaded` 致历史会话不显示）；
 *  ③ 条目级容错：损坏分片条目丢弃，合法条目保留；④ 进程内缓存（不当读盘）。
 *
 * §8-3 片读写：
 *  ① 片自包含（`sessionId` + documents + invertedIndex），可被新实例读回；
 *  ② 损坏/结构非法/`sessionId` 不匹配 ⇒ 按缺失处理（null，交给下游重建），不抛；
 *  ③ 原生不可变字节 ⇒ **LRU 只淘汰干净片**，脏片（未落盘工作集）绝不淘汰；
 *  ④ 无脏片 ⇒ 零写盘（不建目录、不写清单）；失败保留脏标记等下轮。
 *
 * §8-6：清单有记录但不可读 ⇒ 登记待重建（`takeCorruptShardIds`，由有 storage 的一方消费）；
 *       `removeShard` 三处一并移除（内存 / 磁盘 / 清单）。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  FTSIndexStore,
  createEmptyManifest,
  FTS_INDEX_MANIFEST_FILE,
  FTS_INDEX_MANIFEST_VERSION,
  FTS_SHARD_TMP_PREFIX,
  type FTSShardData,
} from '../../src/session/persistence/FTSIndexStore';
import type { FTSDocument } from '../../src/session/FTS5SearchEngine';

const dirs: string[] = [];

function tempIndexDir(): string {
  const parent = mkdtempSync(join(tmpdir(), 'fts-manifest-'));
  dirs.push(parent);
  return join(parent, 'fts-index');
}

/** 直接落一份原始清单文本（用于构造损坏/非法内容；自行建目录） */
function writeRawManifest(indexDir: string, content: string): void {
  mkdirSync(indexDir, { recursive: true });
  writeFileSync(join(indexDir, FTS_INDEX_MANIFEST_FILE), content, 'utf-8');
}

/** 构造片内存视图（documents/invertedIndex 语义与引擎一致） */
function shard(docs: Array<[string, string]>): FTSShardData {
  const documents = new Map<string, FTSDocument>();
  const invertedIndex = new Map<string, Set<string>>();
  for (const [id, content] of docs) {
    documents.set(id, {
      id,
      title: id,
      content,
      category: 'test',
      timestamp: 1,
    });
    for (const token of new Set(content.split(/\s+/).filter(Boolean))) {
      const ids = invertedIndex.get(token) ?? new Set<string>();
      ids.add(id);
      invertedIndex.set(token, ids);
    }
  }
  return { documents, invertedIndex };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('§8-2：FTS 索引清单读写', () => {
  test('写入后可读回（含分片条目；目录不存在时自动创建）', async () => {
    const indexDir = tempIndexDir();
    const store = new FTSIndexStore(indexDir);
    const manifest = createEmptyManifest();
    manifest.totalLength = 1234;
    manifest.shards['sess-1'] = {
      docCount: 42,
      contentLength: 4096,
      termCount: 120,
      bytes: 51234,
    };

    expect(existsSync(indexDir)).toBe(false);
    await store.writeManifest(manifest);
    expect(existsSync(store.manifestPath)).toBe(true);

    expect(await store.readManifest()).toEqual(manifest);
  });

  test('原子替换：写入后不残留临时文件', async () => {
    const indexDir = tempIndexDir();
    const store = new FTSIndexStore(indexDir);
    await store.writeManifest(createEmptyManifest());
    await store.writeManifest(createEmptyManifest());

    const leftovers = readdirSync(indexDir).filter((n) => n.includes('tmp'));
    expect(leftovers).toEqual([]);
  });

  test('首启（清单不存在）⇒ 空清单且不抛错', async () => {
    const store = new FTSIndexStore(tempIndexDir());
    expect(await store.readManifest()).toEqual(createEmptyManifest());
  });

  test('进程内缓存：首次读盘后不再重复读取（片加载不重复付出 I/O）', async () => {
    const indexDir = tempIndexDir();
    const manifest = createEmptyManifest();
    manifest.shards['sess-1'] = {
      docCount: 1,
      contentLength: 3,
      termCount: 1,
      bytes: 10,
    };
    writeRawManifest(indexDir, JSON.stringify(manifest));

    const store = new FTSIndexStore(indexDir);
    expect((await store.readManifest()).shards['sess-1']).toEqual({
      docCount: 1,
      contentLength: 3,
      termCount: 1,
      bytes: 10,
    });

    // 外部删除后仍返回缓存内容 ⇒ 证明第二次调用未读盘
    rmSync(store.manifestPath);
    expect(await store.readManifest()).toEqual(manifest);
  });

  test('JSON 损坏 ⇒ 空清单且不抛错（交给下游重建）', async () => {
    const indexDir = tempIndexDir();
    writeRawManifest(indexDir, '{"version":1,"shards":{');

    const store = new FTSIndexStore(indexDir);
    expect(await store.readManifest()).toEqual(createEmptyManifest());
  });

  test('顶层结构非法（数组 / null / 字符串）⇒ 空清单且不抛错', async () => {
    for (const bad of ['[]', 'null', '"str"']) {
      const indexDir = tempIndexDir();
      writeRawManifest(indexDir, bad);
      expect(await new FTSIndexStore(indexDir).readManifest()).toEqual(
        createEmptyManifest()
      );
    }
  });

  test('版本不匹配 ⇒ 空清单（§7 不做迁移，索引为派生物）', async () => {
    const indexDir = tempIndexDir();
    writeRawManifest(
      indexDir,
      JSON.stringify({
        version: FTS_INDEX_MANIFEST_VERSION + 1,
        totalLength: 999,
        shards: {
          'sess-1': { docCount: 1, contentLength: 1, termCount: 1, bytes: 1 },
        },
      })
    );

    expect(await new FTSIndexStore(indexDir).readManifest()).toEqual(
      createEmptyManifest()
    );
  });

  test('损坏条目丢弃、合法条目保留（totalLength 保留）', async () => {
    const indexDir = tempIndexDir();
    const good = { docCount: 2, contentLength: 200, termCount: 7, bytes: 200 };
    writeRawManifest(
      indexDir,
      JSON.stringify({
        version: FTS_INDEX_MANIFEST_VERSION,
        totalLength: 777,
        shards: {
          'sess-good': good,
          'sess-missing-field': { docCount: 1, bytes: 1 },
          'sess-not-number': { docCount: '1', contentLength: 1, bytes: 1 },
          'sess-null': null,
          'sess-array': [],
          'sess-nan': { docCount: NaN, contentLength: 1, bytes: 1 },
        },
      })
    );

    const read = await new FTSIndexStore(indexDir).readManifest();
    expect(read.shards).toEqual({ 'sess-good': good });
    expect(read.totalLength).toBe(777);
  });

  test('shards 结构非法 / 缺失 ⇒ 空分片表且不抛错', async () => {
    const bad = tempIndexDir();
    writeRawManifest(
      bad,
      JSON.stringify({ version: FTS_INDEX_MANIFEST_VERSION, shards: [] })
    );
    expect((await new FTSIndexStore(bad).readManifest()).shards).toEqual({});

    const missing = tempIndexDir();
    writeRawManifest(
      missing,
      JSON.stringify({ version: FTS_INDEX_MANIFEST_VERSION })
    );
    expect((await new FTSIndexStore(missing).readManifest()).shards).toEqual(
      {}
    );
  });

  test('清单为可读文本（2 空格缩进，便于运维核对）', async () => {
    const indexDir = tempIndexDir();
    const store = new FTSIndexStore(indexDir);
    const manifest = createEmptyManifest();
    manifest.shards['sess-1'] = {
      docCount: 1,
      contentLength: 10,
      termCount: 1,
      bytes: 10,
    };
    await store.writeManifest(manifest);

    const raw = readFileSync(join(indexDir, FTS_INDEX_MANIFEST_FILE), 'utf-8');
    expect(raw).toContain('\n  ');
    expect(raw).toBe(JSON.stringify(manifest, null, 2));
  });
});

describe('§8-3：FTS 分片读写 / LRU / 片级 dirty', () => {
  test('落盘后可被新实例读回（片自包含；清单条目与 totalLength 同步）', async () => {
    const indexDir = tempIndexDir();
    const store = new FTSIndexStore(indexDir);
    await store.putShard(
      's1',
      shard([
        ['d1', 'alpha beta'],
        ['d2', 'beta'],
      ])
    );

    expect(await store.flushPendingShards()).toBeGreaterThan(0);
    expect(existsSync(store.shardPath('s1'))).toBe(true);

    const manifest = await store.readManifest();
    expect(manifest.shards['s1'].docCount).toBe(2);
    expect(manifest.shards['s1'].contentLength).toBe(
      'alpha beta'.length + 'beta'.length
    );
    expect(manifest.shards['s1'].termCount).toBe(2); // 词表 {alpha, beta}
    expect(manifest.shards['s1'].bytes).toBeGreaterThan(0);
    expect(manifest.totalLength).toBe(manifest.shards['s1'].contentLength);

    const reopened = new FTSIndexStore(indexDir);
    const data = await reopened.loadShard('s1');
    expect(data?.documents.size).toBe(2);
    expect(data?.documents.get('d1')?.content).toBe('alpha beta');
    expect([...(data?.invertedIndex.get('beta') ?? [])].sort()).toEqual([
      'd1',
      'd2',
    ]);
  });

  test('清单未记录该会话 ⇒ loadShard 返回 null（不抛，由下游重建）', async () => {
    const store = new FTSIndexStore(tempIndexDir());
    expect(await store.loadShard('unknown')).toBeNull();
  });

  test('片不可用（JSON 损坏 / 结构非法 / sessionId 不匹配）⇒ null 且不抛', async () => {
    const indexDir = tempIndexDir();
    const seed = new FTSIndexStore(indexDir);
    await seed.putShard('s1', shard([['d1', '内容']]));
    await seed.flushPendingShards();
    const shardFile = seed.shardPath('s1');

    const cases = [
      '{"sessionId":"s1","documents":[', // JSON 截断
      JSON.stringify({
        sessionId: 's1',
        documents: [[1, {}]],
        invertedIndex: [],
      }), // 条目形状非法
      JSON.stringify({ sessionId: 'other', documents: [], invertedIndex: [] }), // sessionId 错位
    ];

    for (const bad of cases) {
      writeFileSync(shardFile, bad, 'utf-8');
      expect(await new FTSIndexStore(indexDir).loadShard('s1')).toBeNull();
    }
  });

  test('无脏片 ⇒ 零写盘（不建目录、不写清单）', async () => {
    const store = new FTSIndexStore(tempIndexDir());
    expect(await store.flushPendingShards()).toBe(0);
    expect(existsSync(store.shardsDirPath)).toBe(false);
    expect(existsSync(store.manifestPath)).toBe(false);
  });

  test('只重写脏片：干净片文件不被重写', async () => {
    const indexDir = tempIndexDir();
    const store = new FTSIndexStore(indexDir);
    await store.putShard('a', shard([['d', 'aaa']]));
    await store.putShard('b', shard([['d', 'bbb']]));
    await store.flushPendingShards();

    const aPath = store.shardPath('a');
    const aMtime = statSync(aPath).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));

    store.markShardDirty('b');
    expect(await store.flushPendingShards()).toBeGreaterThan(0);

    expect(statSync(aPath).mtimeMs).toBe(aMtime);
    expect(statSync(store.shardPath('b')).mtimeMs).toBeGreaterThan(aMtime);
  });

  test('缓存命中不读盘；显式卸载后改为从盘回读', async () => {
    const indexDir = tempIndexDir();
    const store = new FTSIndexStore(indexDir);
    await store.putShard('s1', shard([['d1', '缓存命中']]));
    await store.flushPendingShards();

    rmSync(store.shardPath('s1')); // 盘上副本消失
    const hit = await store.loadShard('s1');
    expect(hit?.documents.get('d1')?.content).toBe('缓存命中'); // 命中缓存 ⇒ 未读盘

    await store.unloadShard('s1');
    expect(await store.loadShard('s1')).toBeNull(); // 卸载后必须读盘 ⇒ 文件已删 ⇒ 缺失
  });

  test('片级 dirty 标记：写入后转干净，再变更后重新变脏', async () => {
    const store = new FTSIndexStore(tempIndexDir());
    await store.putShard('s1', shard([['d1', 'x']]));
    expect(store.isShardDirty('s1')).toBe(true);

    expect(await store.flushPendingShards()).toBeGreaterThan(0);
    expect(store.isShardDirty('s1')).toBe(false);

    store.markShardDirty('s1');
    expect(store.isShardDirty('s1')).toBe(true);
  });

  test('代际保护：写入期间的变更不被「已落盘」抹掉', async () => {
    const store = new FTSIndexStore(tempIndexDir());
    await store.putShard('s1', shard([['d1', 'x']]));

    const flushing = store.flushPendingShards();
    store.markShardDirty('s1'); // 写入期间发生新变更
    expect(await flushing).toBeGreaterThan(0);
    expect(store.isShardDirty('s1')).toBe(true);

    expect(await store.flushPendingShards()).toBeGreaterThan(0);
    expect(store.isShardDirty('s1')).toBe(false);
  });

  test('LRU：命中即提升，淘汰最久未用的干净片（淘汰不丢数据）', async () => {
    const indexDir = tempIndexDir();
    const seed = new FTSIndexStore(indexDir);
    for (const id of ['a', 'b', 'c']) {
      await seed.putShard(id, shard([[`doc-${id}`, id]]));
    }
    await seed.flushPendingShards();

    const store = new FTSIndexStore(indexDir, { maxCachedShards: 2 });
    await store.loadShard('a');
    await store.loadShard('b');
    await store.loadShard('a'); // 提升 a ⇒ b 成为最久未用
    await store.loadShard('c');

    expect(store.cachedShardCount).toBe(2);
    // b 被淘汰但未删除：仍可回读
    expect((await store.loadShard('b'))?.documents.size).toBe(1);
  });

  test('脏片绝不淘汰（即使超出片数上限）', async () => {
    const store = new FTSIndexStore(tempIndexDir(), { maxCachedShards: 1 });
    await store.putShard('a', shard([['d', 'a']]));
    await store.putShard('b', shard([['d', 'b']]));

    expect(store.cachedShardCount).toBe(2); // 脏片保留 ⇒ 允许超出上限
    expect(store.isShardDirty('a')).toBe(true);
    expect(store.isShardDirty('b')).toBe(true);
  });

  test('原子替换：片目录内不残留临时文件', async () => {
    const store = new FTSIndexStore(tempIndexDir());
    await store.putShard('s1', shard([['d1', 'x']]));
    await store.flushPendingShards();

    expect(
      readdirSync(store.shardsDirPath).filter((n) =>
        n.startsWith(FTS_SHARD_TMP_PREFIX)
      )
    ).toEqual([]);
  });

  test('启动恢复：清理临时残留且保留真片；目录不存在 ⇒ 0', async () => {
    const store = new FTSIndexStore(tempIndexDir());
    await store.putShard('s1', shard([['d1', 'x']]));
    await store.flushPendingShards();

    writeFileSync(
      join(store.shardsDirPath, `${FTS_SHARD_TMP_PREFIX}dead`),
      'junk',
      'utf-8'
    );
    expect(await store.scanTmpResidue()).toBe(1);
    expect(existsSync(store.shardPath('s1'))).toBe(true);
    expect(
      readdirSync(store.shardsDirPath).some((n) =>
        n.startsWith(FTS_SHARD_TMP_PREFIX)
      )
    ).toBe(false);

    expect(await new FTSIndexStore(tempIndexDir()).scanTmpResidue()).toBe(0);
  });

  test('文件名净化：非法字符被替换，且净化后同名者不互相覆盖', async () => {
    const indexDir = tempIndexDir();
    const store = new FTSIndexStore(indexDir);

    const colon = store.shardFileName('qq:1');
    const slash = store.shardFileName('qq/1');
    expect(colon).not.toContain(':');
    expect(slash).not.toContain('/');
    expect(colon).not.toBe(slash);

    // 端到端：含非法字符的会话 id 亦可读写（片内 sessionId 校验不误判）
    await store.putShard('qq:1', shard([['d1', '渠道会话']]));
    await store.flushPendingShards();
    expect(
      (await new FTSIndexStore(indexDir).loadShard('qq:1'))?.documents.get('d1')
        ?.content
    ).toBe('渠道会话');
  });

  test('§8-6 损坏片登记：清单有记录但不可读 ⇒ 登记待重建，取走即清空', async () => {
    const indexDir = tempIndexDir();
    const seed = new FTSIndexStore(indexDir);
    await seed.putShard('s1', shard([['d1', 'x']]));
    await seed.flushPendingShards();

    writeFileSync(seed.shardPath('s1'), 'not-json', 'utf-8');
    const store = new FTSIndexStore(indexDir);
    expect(await store.loadShard('s1')).toBeNull();
    expect(store.takeCorruptShardIds()).toEqual(['s1']);
    expect(store.takeCorruptShardIds()).toEqual([]); // 取走即清空
  });

  test('§8-6 removeShard：内存 / 磁盘 / 清单三处一并移除', async () => {
    const store = new FTSIndexStore(tempIndexDir());
    await store.putShard('s1', shard([['d1', 'x']]));
    await store.flushPendingShards();

    await store.removeShard('s1');
    expect(existsSync(store.shardPath('s1'))).toBe(false);
    expect((await store.readManifest()).shards['s1']).toBeUndefined();
    expect(store.isShardDirty('s1')).toBe(false);
    expect(store.cachedShardCount).toBe(0);

    // 缺失片重复删除幂等
    await store.removeShard('s1');
  });
});
