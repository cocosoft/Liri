// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `MemoryManager.saveRelationGraph` 并发保存回归（2026-10-31 真机日志取证）。
 *
 * 缺陷：旧实现用**固定**临时名 `memory-relation-graph.json.tmp` 做「写→rename」，
 * 并发保存时后到者 rename 的 tmp 已被先到者消费 ⇒
 * `ENOENT: rename '…memory-relation-graph.json.tmp' -> '…memory-relation-graph.json'`
 * （本机 `app.log` 实证：`memory:manager | [save_relation_graph] ENOENT …`）。
 *
 * 断言口径（不 mock）：`handleError` 统计快照里不得出现 `action === 'save_relation_graph'`
 * 的新增记录；关系图文件可解码且无残留 `.tmp`。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getErrorStats } from '../../src/error/handleError';
import { MemoryManagerImpl } from '../../src/memory/MemoryManager';
import { decodePayload } from '../../src/utils/MemoryFileEnvelope';

const dirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mem-relation-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('MemoryManager.saveRelationGraph：并发保存不产生 ENOENT', () => {
  it('并发 6 次保存 ⇒ 零 save_relation_graph 错误记录 + 关系图可解码 + 无残留 .tmp', async () => {
    const dir = makeDir();
    const manager = new MemoryManagerImpl(dir);

    await Promise.all(
      Array.from({ length: 6 }, () => manager.saveRelationGraph())
    );

    const failures = getErrorStats().recent.filter(
      (entry) => entry.action === 'save_relation_graph'
    );
    expect(failures).toHaveLength(0);

    const graphPath = join(dir, 'memory-relation-graph.json');
    expect(existsSync(graphPath)).toBe(true);
    const decoded = decodePayload(readFileSync(graphPath, 'utf8'));
    expect(decoded.status).not.toBe('corrupt');

    const leftovers = readdirSync(dir).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toHaveLength(0);
  });
});
