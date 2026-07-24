// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 知识文件 Schema 版本兼容 — KnowledgeSchemaMigration
 *
 * 检测 frontmatter 中的 schema_version 字段，不匹配时触发迁移。
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'knowledge:schemaMigration',
  level: LogLevel.INFO,
});

const CURRENT_SCHEMA_VERSION = 1;

/** Frontmatter 结构（最小定义） */
interface KnowledgeFrontmatter {
  id?: string;
  title?: string;
  kind?: string;
  schema_version?: number;
  [key: string]: unknown;
}

function parseFrontmatter(content: string): {
  frontmatter: KnowledgeFrontmatter | null;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: null, body: content };

  try {
    const fm: KnowledgeFrontmatter = {};
    const lines = match[1]!.split('\n');
    let currentKey = '';
    for (const line of lines) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (kv) {
        currentKey = kv[1]!;
        const val = kv[2]!.trim();
        fm[currentKey] = isNaN(Number(val)) ? val : Number(val);
      } else if (currentKey && line.startsWith('  - ')) {
        const arr = fm[currentKey];
        if (!Array.isArray(arr)) fm[currentKey] = [];
        (fm[currentKey] as string[]).push(line.slice(4));
      }
    }
    return { frontmatter: fm, body: match[2] ?? '' };
  } catch {
    return { frontmatter: null, body: content };
  }
}

/**
 * 检测并迁移知识文件的 schema 版本
 * 返回 { migrated: boolean, error?: string }
 */
export async function migrateKnowledgeSchema(
  filePath: string
): Promise<{ migrated: boolean; error?: string }> {
  try {
    if (!existsSync(filePath)) return { migrated: false };

    const content = await readFile(filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(content);

    if (!frontmatter) {
      // 无 frontmatter → 自动添加 schema_version
      const newContent = [
        '---',
        `title: ${filePath.split('/').pop()?.replace('.md', '') || 'Untitled'}`,
        `schema_version: ${CURRENT_SCHEMA_VERSION}`,
        '---',
        '',
        body,
      ].join('\n');
      await writeFile(filePath, newContent, 'utf-8');
      logger.info('Schema 迁移：添加 frontmatter', { filePath });
      return { migrated: true };
    }

    if (frontmatter.schema_version === CURRENT_SCHEMA_VERSION) {
      return { migrated: false };
    }

    // 版本不匹配 → 更新版本号
    frontmatter.schema_version = CURRENT_SCHEMA_VERSION;
    const fmStr = Object.entries(frontmatter)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('\n');
    const newContent = `---\n${fmStr}\n---\n\n${body}\n`;
    await writeFile(filePath, newContent, 'utf-8');
    logger.info('Schema 迁移：更新版本', {
      filePath,
      from: frontmatter.schema_version,
      to: CURRENT_SCHEMA_VERSION,
    });
    return { migrated: true };
  } catch (err) {
    return {
      migrated: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 批量迁移目录下的所有 .md 文件
 */
export async function migrateDirectory(
  dirPath: string
): Promise<{ migrated: number; errors: string[] }> {
  const { readdir } = await import('fs/promises');
  let migrated = 0;
  const errors: string[] = [];

  try {
    if (!existsSync(dirPath))
      return { migrated: 0, errors: [`目录不存在: ${dirPath}`] };

    const entries = await readdir(dirPath, { recursive: true });
    for (const entry of entries) {
      if (typeof entry !== 'string' || !entry.endsWith('.md')) continue;
      const fullPath = join(dirPath, entry);
      const result = await migrateKnowledgeSchema(fullPath);
      if (result.migrated) migrated++;
      if (result.error) errors.push(`${entry}: ${result.error}`);
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return { migrated, errors };
}
