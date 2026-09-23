/**
 * FTS 索引异步落盘（R7，2026-09-21）
 *
 * 背景（真机实证，`~/.pyapp/data/logs/app.log` + 文件观测）：`saveToDisk` 原先
 * **全量物化 + 单次 `JSON.stringify` + `fs.writeFileSync`、全在主线程同步**执行，
 * 由 `setInterval(60_000)` 驱动；`fts-index.json` 实测 **260.8MB**（mtime 严格 60s 一跳）。
 * 后果：`Event Loop 滞后 37520ms / 28335ms / 39217ms`，同秒前端 `Failed to fetch` /
 * `请求超时 (30000ms)`。
 *
 * 本文件锁定修复后的四条契约：
 *  ① 落盘**异步**且**分片让出**（不阻塞事件循环）；
 *  ② 临时文件 + 原子替换（不留半截索引、不留 .tmp 残渣）；
 *  ③ 重入保护（上一次未写完则本次跳过）；
 *  ④ 代际保护（写入期间的变更不会被 `isDirty=false` 抹掉）。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { readFileSync, existsSync, readdirSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FTS5SearchEngine } from '../../src/session/FTS5SearchEngine';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fts-save-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function doc(
  id: string,
  content: string
): {
  id: string;
  title: string;
  content: string;
  category: string;
  timestamp: number;
} {
  return { id, title: id, content, category: 'test', timestamp: Date.now() };
}

describe('R7：FTS 索引异步落盘', () => {
  test('落盘后可被重新加载（格式与旧实现逐字节等价）', async () => {
    const dir = tempDir();
    const file = join(dir, 'fts-index.json');

    const engine = new FTS5SearchEngine();
    engine.index(doc('d1', '事件循环阻塞排查'));
    engine.index(doc('d2', '压缩配对完整性'));
    expect(await engine.saveToDisk(file)).toBe(true);

    // 结构仍是 { documents: [[id, doc]…], invertedIndex: [[term, [ids]…]…] }
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as {
      documents: Array<[string, unknown]>;
      invertedIndex: Array<[string, string[]]>;
    };
    expect(raw.documents.map(([id]) => id).sort()).toEqual(['d1', 'd2']);
    expect(Array.isArray(raw.invertedIndex[0][1])).toBe(true);

    const reloaded = new FTS5SearchEngine();
    reloaded.loadFromDisk(file);
    expect(reloaded.getStats().documentCount).toBe(2);
    expect(reloaded.search('压缩').length).toBe(1);
  });

  test('无变更时跳过写盘（返回 false）', async () => {
    const dir = tempDir();
    const file = join(dir, 'fts-index.json');
    const engine = new FTS5SearchEngine();
    engine.index(doc('d1', '内容'));

    expect(await engine.saveToDisk(file)).toBe(true);
    expect(await engine.saveToDisk(file)).toBe(false);
  });

  test('重入保护：上一次未写完 ⇒ 本次 tick 跳过（返回 false）', async () => {
    const dir = tempDir();
    const file = join(dir, 'fts-index.json');
    const engine = new FTS5SearchEngine();
    engine.index(doc('d1', '内容'));

    const first = engine.saveToDisk(file);
    const second = engine.saveToDisk(file); // 同一 tick 内的第二个调用
    expect(await first).toBe(true);
    expect(await second).toBe(false);
  });

  test('代际保护：写入期间的新变更不会被清 dirty（下一轮仍会写）', async () => {
    const dir = tempDir();
    const file = join(dir, 'fts-index.json');
    const engine = new FTS5SearchEngine();
    engine.index(doc('d1', '内容'));

    const saving = engine.saveToDisk(file); // 启动（同步段结束后挂起在首个 await）
    engine.index(doc('d2', '写入期间新增')); // 代际 +1
    expect(await saving).toBe(true);

    // 变更未被抹掉 ⇒ 再调一次仍应真的写盘
    expect(await engine.saveToDisk(file)).toBe(true);

    const reloaded = new FTS5SearchEngine();
    reloaded.loadFromDisk(file);
    expect(reloaded.getStats().documentCount).toBe(2);
  });

  test('原子替换：不残留 .tmp 文件', async () => {
    const dir = tempDir();
    const file = join(dir, 'fts-index.json');
    const engine = new FTS5SearchEngine();
    engine.index(doc('d1', '内容'));
    await engine.saveToDisk(file);

    const leftovers = readdirSync(dir).filter((n) => n.includes('.tmp-'));
    expect(leftovers).toEqual([]);
    expect(existsSync(file)).toBe(true);
  });
});
