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
 * MemorySchemaRegistry — 记忆 schema 版本迁移注册表
 *
 * 负责将旧版本 MemoryMetadata 迁移到当前版本。
 * 新增字段时在此注册迁移函数，读取时自动执行迁移链。
 */

import type { MemoryMetadata } from './MemoryMetadata';
import { CURRENT_SCHEMA_VERSION } from './MemoryMetadata';

/**
 * 各版本已知字段清单（用于迁移引用检查）
 */
const schemaRegistry = {
  versions: {
    1: [
      'name',
      'description',
      'type',
      'createdAt',
      'updatedAt',
      'tags',
      'priority',
      'expiresAt',
      'author',
      'source',
      'importance',
      'isPinned',
      'accessLevel',
      'encrypted',
      'sessionId',
    ],
    2: [
      'dreamProcessedAt',
      'dreamSource',
      'dreamRefined',
      'schemaVersion',
      'deprecatedBy',
      'deprecatedAt',
      'supersedes',
    ],
  },
};

/**
 * 迁移函数映射表
 * key: "1→2", value: (old) => new
 */
const migrations: Record<string, (meta: MemoryMetadata) => MemoryMetadata> = {
  '1→2': (old: MemoryMetadata): MemoryMetadata => ({
    ...old,
    schemaVersion: 2,
    dreamProcessedAt: null,
    dreamRefined: false,
  }),
};

/**
 * 将 MemoryMetadata 迁移到当前 schema 版本
 * @param meta 原始元数据（可能为旧版本）
 * @returns 当前版本的元数据
 */
export function migrateMetadata(meta: MemoryMetadata): MemoryMetadata {
  let current = { ...meta };

  // 补默认值（读取旧文件时可能缺失）
  if (current.schemaVersion === undefined || current.schemaVersion < 1) {
    current.schemaVersion = 1;
  }

  while ((current.schemaVersion ?? 1) < CURRENT_SCHEMA_VERSION) {
    const key = `${current.schemaVersion}→${current.schemaVersion! + 1}`;
    const migrator = migrations[key];
    if (!migrator) break;
    current = migrator(current);
  }

  return current;
}

/**
 * 判断是否需要迁移
 * @param meta 元数据
 * @returns 是否需要迁移
 */
export function needsMigration(meta: MemoryMetadata): boolean {
  return (meta.schemaVersion ?? 1) < CURRENT_SCHEMA_VERSION;
}
