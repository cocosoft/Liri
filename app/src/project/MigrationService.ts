/**
 * P0b-4: 旧数据迁移服务
 *
 * 1. 文件迁移：~/.pyapp/projects/ → ~/.pyapp/data/projects/
 * 2. 批量迁移：前端 localStorage worktree → 后端 Project 实体
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { resolveDataDir } from '@modules/core/paths';
import { createProjectStore } from '../workspace/ProjectStore.js';
import { WorkItemStore } from '../workspace/WorkItemStore.js';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'project:Migration',
  level: LogLevel.INFO,
});

/** 迁移标记文件 — 存在即表示已完成 */
const MIGRATION_MARKER = join(resolveDataDir(), 'projects', '.migrated_v8');

/** 旧数据路径 */
const OLD_PROJECTS_DIR = join(homedir(), '.pyapp', 'projects');
const NEW_PROJECTS_DIR = join(resolveDataDir(), 'projects');

/**
 * 文件级迁移：复制旧路径下未迁移的文件到新路径
 * 仅在标记文件不存在时执行
 */
export function migrateLegacyFiles(): { copied: number; skipped: number } {
  let copied = 0;
  let skipped = 0;

  if (existsSync(MIGRATION_MARKER)) {
    logger.info('迁移标记已存在，跳过文件迁移');
    return { copied: 0, skipped: 0 };
  }

  if (!existsSync(OLD_PROJECTS_DIR)) {
    logger.info('旧路径不存在，无需文件迁移');
    // 仍写标记，避免重复检查
    writeMigrationMarker();
    return { copied: 0, skipped: 0 };
  }

  try {
    const entries = readdirSync(OLD_PROJECTS_DIR, { withFileTypes: true });
    if (!existsSync(NEW_PROJECTS_DIR)) {
      mkdirSync(NEW_PROJECTS_DIR, { recursive: true });
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const oldDir = join(OLD_PROJECTS_DIR, entry.name);
      const newDir = join(NEW_PROJECTS_DIR, entry.name);

      if (existsSync(newDir)) {
        skipped++;
        continue;
      }

      try {
        mkdirSync(newDir, { recursive: true });
        const files = readdirSync(oldDir);
        for (const file of files) {
          const oldPath = join(oldDir, file);
          const newPath = join(newDir, file);
          if (existsSync(oldPath)) {
            const content = readFileSync(oldPath);
            writeFileSync(newPath, content);
          }
        }
        copied++;
        logger.info('项目文件已迁移', {
          projectId: entry.name,
          files: files.length,
        });
      } catch (e) {
        logger.warn('迁移项目文件失败', {
          projectId: entry.name,
          error: String(e),
        });
      }
    }

    writeMigrationMarker();
    logger.info('旧数据文件迁移完成', { copied, skipped });
  } catch (e) {
    logger.error('文件迁移过程出错', { error: String(e) });
  }

  return { copied, skipped };
}

function writeMigrationMarker(): void {
  try {
    if (!existsSync(NEW_PROJECTS_DIR)) {
      mkdirSync(NEW_PROJECTS_DIR, { recursive: true });
    }
    writeFileSync(MIGRATION_MARKER, new Date().toISOString(), 'utf-8');
  } catch {
    /* 写标记失败不影响主流程 */
  }
}

/**
 * 批量迁移工作空间到 Project 实体
 * 从 localStorage worktree 数据调用此 API，为每个旧 worktree 创建 Project
 */
export function migrateWorktrees(
  worktrees: Array<{
    id: string;
    name: string;
    path?: string;
    description?: string;
  }>,
  workspaceId: string = 'default'
): { created: number; skipped: number } {
  const dataDir = resolveDataDir();
  const workItemStore = new WorkItemStore(dataDir);
  const store = createProjectStore(dataDir, workItemStore);

  let created = 0;
  let skipped = 0;

  for (const wt of worktrees) {
    // 检查是否已存在对应 Project
    const existing = store.get(wt.id);
    if (existing) {
      skipped++;
      continue;
    }

    try {
      store.create({
        workspaceId,
        name: wt.name,
        description: wt.description || '',
        sandboxPath: wt.path,
        delaySandbox: true, // 不重复创建已有文件夹
      });
      created++;
      logger.info('worktree 已迁移为 Project', { oldId: wt.id, name: wt.name });
    } catch (e) {
      logger.warn('worktree 迁移失败', { id: wt.id, error: String(e) });
    }
  }

  logger.info('worktree 批量迁移完成', { created, skipped });
  return { created, skipped };
}
