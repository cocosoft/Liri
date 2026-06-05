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
 * 语义向量存储 (SemanticStore)
 *
 * JSONL 追加写入（Ctrl+C 安全）+ 线性余弦相似度扫描。
 * 适用于 ≤10k 分块，更大规模应迁移到向量数据库。
 *
 * 借鉴: DeepSeek-Reasonix src/index/semantic/store.ts
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CodeChunk } from './chunker';
import type { EmbedOptions } from './embedding';

/** 索引条目 */
export interface IndexEntry extends CodeChunk {
  /** 嵌入向量 */
  embedding: Float32Array;
  /** 文件修改时间（毫秒） */
  mtimeMs: number;
}

/** 搜索结果 */
export interface SearchHit {
  entry: IndexEntry;
  /** 余弦相似度分数 (0-1) */
  score: number;
}

/** 索引元数据 */
export interface IndexMeta {
  provider: string;
  model: string;
  version: number;
  dim: number;
  updatedAt: string;
}

/** 索引身份 */
export interface IndexIdentity {
  provider: string;
  model: string;
}

export const STORE_VERSION = 1;
const META_FILE = 'index.meta.json';
const DATA_FILE = 'index.jsonl';

// ─── 元数据读写 ──────────────────────────────────────────────────────────────

export async function readIndexMeta(indexDir: string): Promise<IndexMeta | null> {
  try {
    const raw = await fs.readFile(path.join(indexDir, META_FILE), 'utf8');
    const parsed = JSON.parse(raw) as Partial<IndexMeta>;
    if (!parsed.version || !parsed.dim || !parsed.provider || !parsed.model) return null;
    return {
      provider: parsed.provider,
      model: parsed.model,
      version: parsed.version,
      dim: parsed.dim,
      updatedAt: parsed.updatedAt ?? '',
    };
  } catch {
    return null;
  }
}

async function writeIndexMeta(indexDir: string, meta: IndexMeta): Promise<void> {
  await fs.mkdir(indexDir, { recursive: true });
  await fs.writeFile(path.join(indexDir, META_FILE), JSON.stringify(meta, null, 2), 'utf8');
}

export async function wipeStoreFiles(indexDir: string): Promise<void> {
  await fs.rm(path.join(indexDir, DATA_FILE), { force: true });
  await fs.rm(path.join(indexDir, META_FILE), { force: true });
}

// ─── SemanticStore 类 ────────────────────────────────────────────────────────

export class SemanticStore {
  private entries: IndexEntry[] = [];
  private dim = 0;

  constructor(
    public readonly indexDir: string,
    public readonly identity: IndexIdentity,
  ) {}

  get empty(): boolean {
    return this.entries.length === 0;
  }

  get size(): number {
    return this.entries.length;
  }

  get all(): readonly IndexEntry[] {
    return this.entries;
  }

  /**
   * 添加条目
   */
  async add(entries: readonly IndexEntry[]): Promise<void> {
    if (entries.length === 0) return;
    if (this.dim === 0 && entries[0]) {
      this.dim = entries[0].embedding.length;
    }

    const lines: string[] = [];
    for (const entry of entries) {
      this.entries.push(entry);
      lines.push(serializeEntry(entry));
    }

    await fs.mkdir(this.indexDir, { recursive: true });
    await fs.appendFile(path.join(this.indexDir, DATA_FILE), lines.join('\n') + '\n', 'utf8');

    await writeIndexMeta(this.indexDir, {
      provider: this.identity.provider,
      model: this.identity.model,
      version: STORE_VERSION,
      dim: this.dim,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * 余弦相似度搜索
   *
   * @param queryEmbedding 查询向量
   * @param topK 返回前 K 个结果
   * @param minScore 最低相似度阈值
   */
  search(queryEmbedding: Float32Array, topK: number = 10, minScore: number = 0.3): SearchHit[] {
    if (this.entries.length === 0 || queryEmbedding.length !== this.dim) return [];

    const hits: SearchHit[] = [];
    for (const entry of this.entries) {
      if (entry.embedding.length !== this.dim) continue;
      const score = cosineSimilarity(queryEmbedding, entry.embedding);
      if (score >= minScore) {
        hits.push({ entry, score });
      }
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, topK);
  }

  /**
   * 从 JSONL 文件加载索引
   */
  async load(): Promise<void> {
    try {
      const dataPath = path.join(this.indexDir, DATA_FILE);
      const raw = await fs.readFile(dataPath, 'utf8');
      this.entries = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = deserializeEntry(line);
          this.entries.push(entry);
          if (this.dim === 0) this.dim = entry.embedding.length;
        } catch {
          // 跳过损坏的行
        }
      }
    } catch {
      this.entries = [];
    }
  }

  /**
   * 清空内存中的索引
   */
  clear(): void {
    this.entries = [];
    this.dim = 0;
  }
}

// ─── 序列化 ──────────────────────────────────────────────────────────────────

function serializeEntry(entry: IndexEntry): string {
  return JSON.stringify({
    path: entry.path,
    startLine: entry.startLine,
    endLine: entry.endLine,
    text: entry.text,
    embedding: Array.from(entry.embedding),
    mtimeMs: entry.mtimeMs,
  });
}

function deserializeEntry(line: string): IndexEntry {
  const obj = JSON.parse(line);
  return {
    path: obj.path as string,
    startLine: obj.startLine as number,
    endLine: obj.endLine as number,
    text: obj.text as string,
    embedding: new Float32Array(obj.embedding as number[]),
    mtimeMs: obj.mtimeMs as number,
  };
}

// ─── 余弦相似度 ──────────────────────────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}