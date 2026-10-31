// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 记忆索引**并发原子写**回归（2026-10-31 真机日志取证）。
 *
 * 缺陷：`MemoryRetrieverImpl.saveIndex()` 用**固定**临时名 `memory-index.json.tmp`
 * 做「写 tmp → rename」原子替换。并发保存时后来者在 `rename` 阶段发现 tmp 已被
 * 先到者改名 ⇒ `ENOENT: rename '…/memory-index.json.tmp' -> '…/memory-index.json'`。
 * 实证（本机 `app.log`）：`memory:retriever | [save_index] ENOENT …` 同一秒内 3 条。
 *
 * 修复：临时名按**每次写入**唯一（pid + 自增序号）⇒ rename 的目标只可能被自己消费。
 *
 * 断言口径（不 mock）：`handleError` 的统计快照 `getErrorStats()` 是错误记录的唯一
 * 事实源，并发保存后不得出现 `action === 'save_index'` 的新增记录，且落盘索引可解码。
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
import { MemoryRetrieverImpl } from '../../src/memory/retrievers/MemoryRetriever';
import { decodePayload } from '../../src/utils/MemoryFileEnvelope';

const dirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mem-retriever-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('MemoryRetrieverImpl.saveIndex：并发保存不产生 ENOENT', () => {
  it('并发 8 次保存 ⇒ 零 save_index 错误记录 + 索引可解码 + 无残留 .tmp', async () => {
    const dir = makeDir();
    const retriever = new MemoryRetrieverImpl(dir);

    await Promise.all(Array.from({ length: 8 }, () => retriever.saveIndex()));

    const saveIndexErrors = getErrorStats().recent.filter(
      (entry) => entry.action === 'save_index'
    );
    expect(saveIndexErrors).toHaveLength(0);

    const indexPath = join(dir, 'memory-index.json');
    expect(existsSync(indexPath)).toBe(true);
    const decoded = decodePayload(readFileSync(indexPath, 'utf8'));
    expect(decoded.status).not.toBe('corrupt');

    const leftovers = readdirSync(dir).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toHaveLength(0);
  });
});
