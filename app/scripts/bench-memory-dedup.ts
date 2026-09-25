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
 * 基准：记忆库去重耗时分解（**只读**，不写任何业务数据）
 *
 * 用途（`.trae/specs/memory-dedup-blocking-rootfix.md` §6 任务 1）：
 * 量化 `MemoryManager.createMemory` 中只读步骤的耗时，作为修复前基线。
 *
 * **设计**：
 * - 只测只读步骤：`getAllMemories`（全量载入）+ `findDuplicates`（O(n²) 去重）；
 * - 去重按**子集规模阶梯**（50/100/200/400/全量）计时 ⇒ 既可外推 O(n²) 规模效应，
 *   又能在长尾前先拿到可用数据；
 * - **增量输出**：每步立即 `process.stdout.write`（避免管道缓冲导致"看不到进度"）。
 *
 * 运行：`bun scripts/bench-memory-dedup.ts`
 */
import { MemoryManagerImpl } from '../src/memory/index.js';
import { MemoryConsolidator } from '../src/memory/consolidation/MemoryConsolidator.js';

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

const LADDER = [50, 100, 200, 400];

async function main(): Promise<void> {
  out('[step] construct MemoryManagerImpl ...');
  const tStart = performance.now();
  const mm = new MemoryManagerImpl();
  out(`[step] constructed in ${Math.round(performance.now() - tStart)}ms`);

  out('[step] getAllMemories ...');
  const t0 = performance.now();
  const all = await mm.getAllMemories();
  const loadMs = performance.now() - t0;

  const totalChars = all.reduce((s, m) => s + (m.content?.length ?? 0), 0);
  const maxChars = all.reduce((s, m) => Math.max(s, m.content?.length ?? 0), 0);
  out(
    `[getAllMemories] count=${all.length} totalChars=${totalChars} avgChars=${
      all.length ? Math.round(totalChars / all.length) : 0
    } maxChars=${maxChars} ms=${Math.round(loadMs)}`
  );

  if (all.length < 2) {
    out('[skip] 记忆数 < 2');
    return;
  }

  const input = all.map((m) => ({
    id: m.id,
    content: m.content ?? '',
    createdAt: m.createdAt.getTime(),
  }));

  const consolidator = new MemoryConsolidator();
  const sizes = [
    ...LADDER.filter((n) => n < input.length),
    input.length,
  ];

  out('[findDuplicates] 子集阶梯计时（Jaccard，默认配置）');
  for (const n of sizes) {
    const subset = input.slice(0, n);
    const pairs = (n * (n - 1)) / 2;
    const t1 = performance.now();
    const r = consolidator.findDuplicates(subset);
    const ms = performance.now() - t1;
    out(
      `[findDuplicates] n=${n} pairs=${pairs} ms=${Math.round(ms)} usPerPair=${
        pairs ? Math.round((ms * 1000) / pairs) : 0
      } groups=${r.duplicates.length} removed=${r.totalRemoved}`
    );
  }

  out('[done] findDuplicates 阶梯结束');

  // ── 步骤 3：写入路径的"非去重"成本（saveMemory + saveIndex + saveRelationGraph）──
  // 用 skipConsolidation:true 隔离出去重，量出**修复后写入路径**的真实成本。
  // 注意：此步会**写入一条临时记忆**（随后删除），不再严格"只读" —— 已在此显式说明。
  out('[step] createMemory(skipConsolidation=true) 计时（写入路径非去重成本）...');
  const t2 = performance.now();
  let createdId: string | null = null;
  try {
    const created = await mm.createMemory(
      {
        content: `[bench] 临时基准条目 ${Date.now()}`,
        metadata: {
          name: 'bench-temp',
          description: 'bench-memory-dedup 临时条目（随后删除）',
          type: 'conversation',
          tags: ['bench-temp'],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      } as never
    );
    createdId = created?.id ?? null;
    out(
      `[createMemory] skipConsolidation=true ms=${Math.round(
        performance.now() - t2
      )} createdId=${createdId ?? '(none)'}`
    );
  } catch (e) {
    out(`[createMemory] FAILED: ${String(e)}`);
  }

  if (createdId) {
    const t3 = performance.now();
    try {
      await mm.deleteMemory(createdId);
      out(
        `[cleanup] deleteMemory(${createdId}) ms=${Math.round(
          performance.now() - t3
        )}`
      );
    } catch (e) {
      out(`[cleanup] FAILED（请手工删除 bench-temp 条目）: ${String(e)}`);
    }
  }

  out('[done] 基准结束');
}

void main();
