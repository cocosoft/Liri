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
 * 知识库检索性能基准（**真实语料**）
 *
 * 用法: `bun run src/knowledge/__tests__/benchmark-baseline.ts`
 * 输出: `dev_docs/evals/benchmark-baseline.json`
 *
 * 论文 A6（2026-10-06）：
 * - **删除** 原 `generateDocs()` **模拟语料**（`${topic}${w}${p}` 式假词，违 CS04）及其 `StaticDocsProvider`；
 * - 改用**真实文档语料** —— `resolveDocsDir()`（`app/docs/`）经**既有** `FileDocsProvider` 扫描（GR01 复用）；
 * - 查询词由语料**标题**派生（不再硬编码与语料无关的 5 个词）；
 * - 语料为空 ⇒ **明确抛错**（不编造、**不回落**模拟数据，CS03/CS04）；
 * - 输出路径改经 `resolveProjectRoot()`（原 `process.cwd()` 拼路径违 §1.13）。
 *
 * 说明：仍保留 50/100/500 档位，但**改为对真实语料按确定顺序切片**（内容零改动），
 * 用于观察"随真实语料规模变化"的性能；切片数 > 语料篇数时该档自动跳过。
 */
/* eslint-disable no-console */
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { resolveDocsDir, resolveProjectRoot } from '@modules/core/paths';
import { FileDocsProvider } from '@modules/docs';
import type { FileDocEntry } from '@modules/docs';
import { KnowledgeRouter } from '../KnowledgeRouter';

/** 对照口径最多取多少条标题作查询（确定性：排序后前 N，非随机抽样） */
const MAX_QUERIES = 50;

/** 由**真实语料**派生查询词（取标题，最多 `MAX_QUERIES` 条） */
function deriveQueries(docs: FileDocEntry[]): string[] {
  const titles = [
    ...new Set(docs.map((d) => d.title).filter((t) => t.trim() !== '')),
  ];
  titles.sort();
  return titles.slice(0, MAX_QUERIES);
}

/** 中位数 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * **真实语料切片** provider：仅按确定顺序截取既有条目，**内容零改动**（不生成任何数据）。
 * 与原 `StaticDocsProvider` 的区别：数据源是 `FileDocsProvider` 扫出的真实文档。
 */
class SliceDocsProvider {
  constructor(private readonly entries: FileDocEntry[]) {}

  async buildIndex(): Promise<FileDocEntry[]> {
    return this.entries;
  }

  async loadDoc(relativePath: string): Promise<FileDocEntry | null> {
    return this.entries.find((e) => e.relativePath === relativePath) ?? null;
  }

  async search(): Promise<FileDocEntry[]> {
    return this.entries;
  }

  async getDocsByCategory(): Promise<FileDocEntry[]> {
    return [];
  }

  getDocsRoots(): string[] {
    return [resolveDocsDir()];
  }

  async clearCache(): Promise<void> {}
}

/** 论文 A6·T2：检索模式对照（模式 × 质量/延迟 指标） */
interface RetrievalModeResult {
  mode: 'exact-title' | 'keyword' | 'hybrid' | 'vector' | 'graph';
  status: 'ok' | 'unavailable';
  /** `status === 'unavailable'` 时**必填**（D2=a：不静默跳过、不填 0 冒充"差"） */
  reason?: string;
  queries?: number;
  recallAt1?: number;
  recallAt5?: number;
  recallAt10?: number;
  mrr?: number;
  medianLatencyMs?: number;
  matchTypeMix?: Record<string, number>;
}

/** 结果路径是否命中目标文档（双向 `endsWith` 容错，与 `removeFromIndex` 同口径） */
function isHitDoc(resultPath: string, target: string): boolean {
  return (
    resultPath === target ||
    resultPath.endsWith(target) ||
    target.endsWith(resultPath)
  );
}

const ratio4 = (v: number): number => Math.round(v * 10000) / 10000;
const ms2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * **对照口径**（论文 A6·T2）：在**真实语料切片**上，用 **title→doc** 作 ground truth
 * （查询 = 文档标题，相关 = 该文档自身 —— 标签**精确无歧义**，非人工假设），
 * 逐模式测 `recall@1/5/10` · `MRR` · 延迟中位数 · `matchType` 分布。
 *
 * **冷缓存**：本函数自建 router 并只 `buildIndex()` 一次、每条查询只跑一次
 * （避免 `search()` 的查询缓存把延迟压成缓存命中值，造成失真）。
 *
 * `hybrid` / `vector` / `graph` 需注入向量腿/图谱 ⇒ 本基准**未注入**，**显式**标
 * `unavailable` 并给出 `reason`（D2=a / CS03：不写跑不到的适配器，也不拿 0 冒充）。
 */
async function benchRetrievalModes(
  docs: FileDocEntry[],
  queries: string[]
): Promise<RetrievalModeResult[]> {
  const router = new KnowledgeRouter(new SliceDocsProvider(docs));
  await router.buildIndex();

  // 标题可能重复 ⇒ 映射到"该标题对应的一组 relativePath"，命中任一即算命中
  const targetsByTitle = new Map<string, Set<string>>();
  for (const d of docs) {
    const set = targetsByTitle.get(d.title) ?? new Set<string>();
    set.add(d.relativePath);
    targetsByTitle.set(d.title, set);
  }
  const hit = (docPath: string, targets: Set<string>): boolean =>
    [...targets].some((p) => isHitDoc(docPath, p));

  const results: RetrievalModeResult[] = [];
  const n = queries.length;

  // ① exact-title（findByTitle：命中即第 1 位，故 recall@1=@5=@10）
  {
    const lat: number[] = [];
    let hit1 = 0;
    for (const q of queries) {
      const t = performance.now();
      const found = router.findByTitle(q);
      lat.push(performance.now() - t);
      if (found && hit(found.docPath, targetsByTitle.get(q) ?? new Set())) {
        hit1++;
      }
    }
    const r = n === 0 ? 0 : hit1 / n;
    results.push({
      mode: 'exact-title',
      status: 'ok',
      queries: n,
      recallAt1: ratio4(r),
      recallAt5: ratio4(r),
      recallAt10: ratio4(r),
      mrr: ratio4(r),
      medianLatencyMs: ms2(median(lat)),
    });
  }

  // ② keyword（无向量腿 ⇒ 纯关键词；`search()` 内置兜底）
  {
    const lat: number[] = [];
    let at1 = 0;
    let at5 = 0;
    let at10 = 0;
    let rrSum = 0;
    const mix: Record<string, number> = {};
    for (const q of queries) {
      const t = performance.now();
      const routes = await router.search(q, { maxResults: 10 });
      lat.push(performance.now() - t);

      const targets = targetsByTitle.get(q) ?? new Set();
      let rank = 0;
      routes.forEach((r, i) => {
        mix[r.matchType] = (mix[r.matchType] ?? 0) + 1;
        if (rank === 0 && hit(r.docPath, targets)) rank = i + 1;
      });
      if (rank > 0) {
        rrSum += 1 / rank;
        if (rank <= 1) at1++;
        if (rank <= 5) at5++;
        at10++;
      }
    }
    const d = n === 0 ? 1 : n;
    results.push({
      mode: 'keyword',
      status: 'ok',
      queries: n,
      recallAt1: ratio4(at1 / d),
      recallAt5: ratio4(at5 / d),
      recallAt10: ratio4(at10 / d),
      mrr: ratio4(rrSum / d),
      medianLatencyMs: ms2(median(lat)),
      matchTypeMix: mix,
    });
  }

  // ③④⑤ 需注入向量腿/图谱 ⇒ 显式不可用（本环境无 embedding 额度）
  results.push({
    mode: 'hybrid',
    status: 'unavailable',
    reason:
      '本基准未注入向量腿（RRF 融合需 embedding 模型与额度）；口径已就位，注入后即可测',
  });
  results.push({
    mode: 'vector',
    status: 'unavailable',
    reason: '未注入 IVectorStore（需 embedding 模型与额度）',
  });
  results.push({
    mode: 'graph',
    status: 'unavailable',
    reason: '未注入知识图谱实例（GraphRAG 实体/社区分层摘要另议）',
  });

  return results;
}

async function runBaseline(
  docs: FileDocEntry[]
): Promise<Record<string, unknown>> {
  const docCount = docs.length;
  const queries = deriveQueries(docs);

  console.log(
    `\n=== 真实语料 ${docCount} 篇（派生查询词 ${queries.length} 条）===`
  );
  if (queries.length === 0) {
    throw new Error('语料无可用标题 ⇒ 无法派生查询词（拒绝回落模拟数据）');
  }

  const provider = new SliceDocsProvider(docs);
  const router = new KnowledgeRouter(provider);

  // 1. buildIndex
  console.log('  buildIndex...');
  const buildTimes: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    await router.buildIndex();
    buildTimes.push(performance.now() - t);
  }

  // 2. 关键词搜索（每查询 3 轮取中位数）
  console.log('  keywordSearch...');
  const keywordTimes: number[] = [];
  for (const query of queries) {
    for (let i = 0; i < 3; i++) {
      const t = performance.now();
      await router.search(query, { maxResults: 10 });
      keywordTimes.push(performance.now() - t);
    }
  }

  // 3. findByTitle（精确查找）
  console.log('  findByTitle...');
  const findTimes: number[] = [];
  const sampleTitles = docs.slice(0, 10).map((d) => d.title);
  for (const title of sampleTitles) {
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      router.findByTitle(title);
      findTimes.push(performance.now() - t);
    }
  }

  // 3.5 检索模式对照（论文 A6·T2）—— 必须**早于** removeFromIndex（后者会从索引移除 10 篇）
  console.log(
    '  retrievalModes（exact-title / keyword / hybrid / vector / graph）...'
  );
  const retrievalModes = await benchRetrievalModes(docs, queries);

  // 4. removeFromIndex（删除性能）
  console.log('  removeFromIndex...');
  const removeTimes: number[] = [];
  const samplePaths = docs.slice(0, 10).map((d) => d.relativePath);
  for (const path of samplePaths) {
    const t = performance.now();
    router.removeFromIndex(path);
    removeTimes.push(performance.now() - t);
  }

  return {
    docCount,
    queries,
    retrievalModes,
    buildIndexMs: {
      median: Math.round(median(buildTimes) * 100) / 100,
      min: Math.round(Math.min(...buildTimes) * 100) / 100,
      max: Math.round(Math.max(...buildTimes) * 100) / 100,
    },
    keywordSearchMs: {
      median: Math.round(median(keywordTimes) * 100) / 100,
      avg:
        Math.round(
          (keywordTimes.reduce((a, b) => a + b, 0) / keywordTimes.length) * 100
        ) / 100,
    },
    findByTitleMs: {
      median: Math.round(median(findTimes) * 100) / 100,
      max: Math.round(Math.max(...findTimes) * 100) / 100,
    },
    removeFromIndexMs: {
      median: Math.round(median(removeTimes) * 100) / 100,
      avg:
        Math.round(
          (removeTimes.reduce((a, b) => a + b, 0) / removeTimes.length) * 100
        ) / 100,
    },
  };
}

async function main() {
  console.log('知识库检索性能基准（真实语料）');
  console.log('='.repeat(50));

  const corpus = await new FileDocsProvider(resolveDocsDir()).buildIndex();
  if (corpus.length === 0) {
    throw new Error(
      `真实语料为空：${resolveDocsDir()} 下未扫到文档 ⇒ 拒绝生成基准（不编造数据）`
    );
  }
  console.log(`语料来源: ${resolveDocsDir()} ｜ 实际篇数: ${corpus.length}`);

  // 50/100/500 档位按真实篇数过滤；并补"全量"档（去重、升序）
  const sizes = [
    ...new Set(
      [...[50, 100, 500].filter((s) => s < corpus.length), corpus.length].sort(
        (a, b) => a - b
      )
    ),
  ];
  if (sizes.length < 3) {
    console.log(
      `（语料仅 ${corpus.length} 篇 ⇒ 档位收敛为 [${sizes.join(', ')}]；不足的档位跳过，不用模拟数据凑数）`
    );
  }

  const results: Record<string, unknown>[] = [];
  for (const size of sizes) {
    const result = await runBaseline(corpus.slice(0, size));
    results.push(result);
    console.log(`  结果: ${JSON.stringify(result, null, 2)}`);
  }

  const report = {
    timestamp: new Date().toISOString(),
    version: 'v3.0-real-corpus',
    /** 论文 A6：语料为真实文档（**非模拟**），来源与规模随报告留档 */
    corpus: { root: resolveDocsDir(), totalDocs: corpus.length },
    results,
  };

  console.log('\n' + '='.repeat(50));
  console.log('基准测试报告:');
  console.log(JSON.stringify(report, null, 2));

  // 写入文件（路径经 resolveProjectRoot，不再用 process.cwd()）
  try {
    const reportDir = join(resolveProjectRoot(), 'dev_docs', 'evals');
    const reportPath = join(reportDir, 'benchmark-baseline.json');
    await mkdir(reportDir, { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\n报告已保存至: ${reportPath}`);
  } catch (err) {
    console.log(`\n报告保存失败: ${err}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
