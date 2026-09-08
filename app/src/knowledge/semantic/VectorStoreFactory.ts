// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * VectorStoreFactory — 向量存储工厂
 *
 * B5（2026-09-08）：删除 sqlite_vec 分支——依赖 sqlite-vec 未安装、全仓无任何
 * VECTOR_STORE 配置/环境变量入口、长期未启用。当前仅 JsonlVectorStore（语义索引
 * ≤10k 分块线性扫描够用）；数据量超 10k 需专业向量库时再评估引入（届时恢复
 * MigrationService 迁移接线）。调用方统一经 IVectorStore 接口操作。
 */

import type { IVectorStore } from './IVectorStore';
import type { IndexIdentity } from './store';
import { JsonlVectorStore } from './JsonlVectorStore';

/**
 * 创建向量存储实例（当前唯一实现 JsonlVectorStore）
 *
 * @param indexDir 索引目录
 * @param identity 索引身份（provider + model）
 */
export function createVectorStore(
  indexDir: string,
  identity: IndexIdentity
): IVectorStore {
  return new JsonlVectorStore(indexDir, identity);
}
