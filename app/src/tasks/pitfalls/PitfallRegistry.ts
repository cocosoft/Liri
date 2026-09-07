/**
 * PitfallRegistry — 跨任务 pitfall 注册表（Teamwork P2b，2026-09-06）
 *
 * 语义无关、可检索的经验沉淀：步骤失败 / VerifierAgent REJECT 的批评被蒸馏为
 * pitfall 条目持久化，供同类任务启动时检索注入上下文（P1-2）。
 *
 * 存储：`~/.pyapp/data/pitfalls/registry.jsonl`（resolveDataSubDir，项目数据层，
 * 非 DB 结构性数据——遵循"knowledge 目录条目"选项，零迁移成本）。
 * 去重：同 description（归一：trim + 小写）不重复写入，occurrenceCount+1（验收 #5）。
 * 最小可用：不做复杂分类/embedding，检索 = 来源过滤 + 关键词粗筛（设计 G 同思路）。
 */

import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { resolveDataSubDir } from '@modules/core/paths';

/** pitfall 来源 */
export type PitfallSource = 'pdl' | 'verifier' | 'other';

/** pitfall 条目（JSONL 行） */
export interface PitfallEntry {
  id: string;
  /** 归一后的失败描述（去重键） */
  description: string;
  /** 原始错误/批评摘要 */
  error: string;
  source: PitfallSource;
  /** 任务/会话上下文签名（taskId/stepId 等粗粒度关联） */
  contextSig?: string;
  /** 归一前原始 description（展示用） */
  rawDescription: string;
  createdAt: number;
  /** 相同失败出现次数（去重累计，不重复写行） */
  occurrenceCount: number;
}

export interface PitfallRecordInput {
  description: string;
  error: string;
  source: PitfallSource;
  contextSig?: string;
}

/** 归一化去重键：trim + 连续空白折叠 + 小写 */
export function normalizePitfallKey(description: string): string {
  return description.trim().replace(/\s+/g, ' ').toLowerCase();
}

function defaultFilePath(): string {
  return join(resolveDataSubDir('pitfalls'), 'registry.jsonl');
}

export class PitfallRegistry {
  private filePath: string;
  private cache: PitfallEntry[] | null = null;

  constructor(filePath?: string) {
    this.filePath = filePath ?? defaultFilePath();
  }

  /** 读取全部条目（缓存 + 惰性加载；文件不存在 → []） */
  private load(): PitfallEntry[] {
    if (this.cache) return this.cache;
    if (!existsSync(this.filePath)) {
      this.cache = [];
      return this.cache;
    }
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      this.cache = raw
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as PitfallEntry)
        .filter((e) => e && typeof e.description === 'string');
      return this.cache;
    } catch {
      // 损坏文件不阻断（记录层容错）；下次写入重建
      this.cache = [];
      return this.cache;
    }
  }

  private persist(entries: PitfallEntry[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(
      this.filePath,
      entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
      'utf-8'
    );
  }

  /**
   * 写入一条 pitfall。同 description（归一）已存在 → occurrenceCount+1 更新时间，
   * 不追加新行（验收 #5：不重复写入同内容）。
   */
  record(input: PitfallRecordInput): PitfallEntry {
    const entries = this.load();
    const key = normalizePitfallKey(input.description);
    const existing = entries.find(
      (e) => normalizePitfallKey(e.description) === key
    );
    if (existing) {
      existing.occurrenceCount += 1;
      existing.createdAt = Date.now();
      existing.error = input.error;
      this.persist(entries);
      return existing;
    }
    const entry: PitfallEntry = {
      id: `pitfall-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description: key,
      rawDescription: input.description,
      error: input.error.slice(0, 800),
      source: input.source,
      contextSig: input.contextSig,
      createdAt: Date.now(),
      occurrenceCount: 1,
    };
    entries.push(entry);
    this.persist(entries);
    return entry;
  }

  /**
   * 检索最近 pitfall（最小可用：来源过滤 + 关键词粗筛，不做 embedding）。
   */
  queryRecent(options?: {
    source?: PitfallSource;
    keyword?: string;
    limit?: number;
  }): PitfallEntry[] {
    const { source, keyword, limit = 5 } = options ?? {};
    const entries = this.load();
    const kw = keyword ? keyword.trim().toLowerCase() : '';
    return entries
      .filter((e) => (source ? e.source === source : true))
      .filter((e) =>
        kw
          ? e.rawDescription.toLowerCase().includes(kw) ||
            e.error.toLowerCase().includes(kw)
          : true
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /** 当前条目数（测试/监控用） */
  count(): number {
    return this.load().length;
  }

  /** 清空（测试/手动复位用） */
  clear(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, '', 'utf-8');
    this.cache = [];
  }
}

/** 全局单例（接线点共享：PdcaLauncher recordPitfall / VerifierAgent 注入） */
export const pitfallRegistry = new PitfallRegistry();
