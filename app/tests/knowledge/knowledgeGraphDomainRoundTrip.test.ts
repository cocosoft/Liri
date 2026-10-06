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

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { KnowledgeGraph } from '../../src/knowledge/graph/KnowledgeGraph';

/**
 * P2-12（2026-10-06）回归守卫：`rowToEdge` 统一保留 `domain: ''`。
 *
 * 原实现 `domain: row.domain || undefined` ⇒ 导出时字段**消失**、导入又还原 `''`
 * （round-trip 不保真）。现与 INSERT 侧 `edge.domain || ''`（KnowledgeGraph.ts:237）
 * 及唯一索引 `COALESCE(domain,'')` 口径一致。
 *
 * 判据（可证伪）：`queryEdges()` 返回的边若仍为 `undefined`，前两条用例立即红。
 */
describe('KnowledgeGraph domain round-trip（P2-12）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kg-p2-12-'));
  const dbPath = join(dir, 'app.db');

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('无 domain 的边：查询返回 domain === ""（不再回落 undefined）', async () => {
    const g = new KnowledgeGraph(dbPath);
    await g.init();
    await g.addEdge({ from: 'a:p2-12:1', to: 'b:p2-12:2', type: 'related' });

    const edges = await g.queryEdges({});
    const target = edges.find((e) => e.from === 'a:p2-12:1');

    expect(target).toBeDefined();
    expect(target!.domain).toBe('');

    await g.close();
  });

  it('显式 domain 原样保留（按域过滤不受影响）', async () => {
    const g = new KnowledgeGraph(dbPath);
    await g.init();
    await g.addEdge({
      from: 'a:p2-12:3',
      to: 'b:p2-12:4',
      type: 'related',
      domain: 'demo',
    });

    const edges = await g.queryEdges({ domain: 'demo' });

    expect(edges.map((e) => e.domain)).toEqual(['demo']);

    await g.close();
  });

  it('导出 JSONL 保真：无 domain 的边**带** "domain":""（原会丢字段）', async () => {
    const g = new KnowledgeGraph(dbPath);
    await g.init();

    const jsonl = await g.exportJsonl();
    const parsed = jsonl
      .split('\n')
      .map((line) => JSON.parse(line) as { from: string; domain?: string });
    const target = parsed.find((e) => e.from === 'a:p2-12:1');

    expect(target).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(target, 'domain')).toBe(true);
    expect(target!.domain).toBe('');

    await g.close();
  });
});
