/**
 * 知识库迁移工具
 * 将旧路径 (app/docs/知识库/) 的知识迁移到新路径 (~/.pyapp/knowledge/)
 */
import { join } from 'path';
import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { resolvePyappHome, resolveKnowledgeBaseDir } from '@modules/core';

const logger = new Logger({
  module: 'knowledge:knowledgeMigration',
  level: LogLevel.INFO,
});

export interface MigrationResult {
  migrated: number;
  skipped: number;
  errors: string[];
  totalFound: number;
}

/**
 * 获取旧知识库路径（后端项目中的 docs/知识库/）
 */
function getOldKnowledgePath(): string {
  return resolveKnowledgeBaseDir();
}

/**
 * 获取新知识库路径（用户目录下）
 */
function getNewKnowledgePath(): string {
  return join(resolvePyappHome(), 'knowledge');
}

/**
 * 执行知识库迁移
 * 将旧路径中的 .md 文件复制到新路径，保留 frontmatter 和内容
 */
export async function migrateKnowledgeBase(): Promise<MigrationResult> {
  const oldPath = getOldKnowledgePath();
  const newPath = getNewKnowledgePath();

  const result: MigrationResult = {
    migrated: 0,
    skipped: 0,
    errors: [],
    totalFound: 0,
  };

  if (!existsSync(oldPath)) {
    logger.info('旧知识库路径不存在，跳过迁移', { oldPath });
    return result;
  }

  await mkdir(newPath, { recursive: true });

  let files: string[];
  try {
    files = await readdir(oldPath);
  } catch (error) {
    logger.warning('读取旧知识库路径失败', { oldPath, error });
    return result;
  }

  for (const file of files) {
    if (!file.endsWith('.md')) continue;

    const oldFile = join(oldPath, file);
    const newFile = join(newPath, file);

    try {
      const stats = await stat(oldFile);
      if (!stats.isFile()) continue;

      result.totalFound++;

      if (existsSync(newFile)) {
        const existingContent = await readFile(newFile, 'utf-8');
        const oldContent = await readFile(oldFile, 'utf-8');

        if (existingContent.trim() === oldContent.trim()) {
          result.skipped++;
          continue;
        }
      }

      const content = await readFile(oldFile, 'utf-8');
      await writeFile(newFile, content, 'utf-8');
      result.migrated++;

      logger.info('知识库文档已迁移', { from: oldFile, to: newFile });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(`${file}: ${errMsg}`);
      await handleError(error, {
        module: 'knowledge:migration',
        action: 'migrate_document',
        context: { file: oldFile },
      });
    }
  }

  if (result.migrated > 0) {
    logger.info(
      `知识库迁移完成: ${result.migrated} 个文档已迁移, ${result.skipped} 个跳过, ${result.errors.length} 个错误`
    );
  }

  return result;
}

export { getOldKnowledgePath, getNewKnowledgePath };
