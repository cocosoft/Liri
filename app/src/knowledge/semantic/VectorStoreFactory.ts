// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * VectorStoreFactory — 向量存储工厂
 *
 * 根据环境变量 VECTOR_STORE 或配置选择实现：
 *   VECTOR_STORE=jsonl      → JsonlVectorStore（默认，开发模式）
 *   VECTOR_STORE=sqlite_vec → SqliteVecStore（阶段一）
 *
 * 调用方不直接依赖具体实现，通过 IVectorStore 接口操作。
 */

import { configManager } from '@modules/config';
import type { IVectorStore } from './IVectorStore';
import { JsonlVectorStore } from './JsonlVectorStore';
import type { IndexIdentity } from './store';

/** 支持的向量存储类型 */
export type VectorStoreType = 'jsonl' | 'sqlite_vec';

/**
 * 创建向量存储实例
 *
 * @param type 存储类型，默认读取 VECTOR_STORE 环境变量，fallback 'jsonl'
 * @param indexDir 索引目录
 * @param identity 索引身份（provider + model）
 */
export function createVectorStore(
  indexDir: string,
  identity: IndexIdentity,
  type?: VectorStoreType
): IVectorStore {
  const resolvedType =
    type ??
    (configManager.env('VECTOR_STORE') as VectorStoreType | undefined) ??
    'jsonl';

  switch (resolvedType) {
    case 'sqlite_vec': {
      // 动态导入，避免未安装 sqlite-vec 时启动失败

      const { SqliteVecStore } = require('./SqliteVecStore');
      return new SqliteVecStore(indexDir, identity);
    }
    case 'jsonl':
    default:
      return new JsonlVectorStore(indexDir, identity);
  }
}
