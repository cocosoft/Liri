// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * IVectorStore — 向量存储抽象接口
 *
 * 替换 SemanticStore 的硬依赖，支持多种向量存储后端：
 *   - JsonlVectorStore（现有 JSONL，保留作为开发模式 fallback）
 *   - SqliteVecStore（sqlite-vec 扩展，阶段一）
 *   - PgVectorStore（Postgres pgvector，阶段二可选）
 */

import type { IndexMeta } from './store';

/** 向量条目 */
export interface VectorEntry {
  /** 唯一标识，如 path#L10-L20 */
  id: string;
  /** 源文件路径 */
  path: string;
  /** 起始行号 (1-based) */
  startLine: number;
  /** 结束行号 (1-based) */
  endLine: number;
  /** 分块文本 */
  text: string;
  /** 向量 */
  embedding: Float32Array;
  /** 文件修改时间(ms) */
  mtimeMs: number;
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
}

/** 搜索结果 */
export interface SearchHit {
  entry: VectorEntry;
  /** 余弦相似度 (0-1) */
  score: number;
}

/**
 * 向量存储抽象接口
 *
 * 所有实现必须支持：
 *   - 批量写入、相似度搜索、按路径删除、清空、计数、元数据管理
 *   - 按 ID 读取单条（用于上下文丰富）
 */
export interface IVectorStore {
  /** 批量写入/更新向量 */
  upsert(entries: VectorEntry[]): Promise<void>;

  /** 余弦相似度搜索，返回 topK 结果 */
  search(
    queryEmbedding: Float32Array,
    topK?: number,
    minScore?: number
  ): Promise<SearchHit[]>;

  /** 按文件路径删除所有关联分块 */
  deleteByPath(path: string): Promise<void>;

  /** 清空所有数据（不删除元数据） */
  clear(): Promise<void>;

  /** 分块总数 */
  count(): Promise<number>;

  /** 获取索引元数据 */
  getMeta(): Promise<IndexMeta | null>;

  /** 设置索引元数据 */
  setMeta(meta: IndexMeta): Promise<void>;

  /** 按 ID 获取单条向量（用于上下文丰富） */
  getById(id: string): Promise<VectorEntry | null>;
}
