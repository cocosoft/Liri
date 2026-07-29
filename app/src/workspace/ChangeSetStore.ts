/**
 * 变更集文件存储
 *
 * 将变更集持久化到 .liri/changesets/ 目录下，每个变更集一个 JSON 文件。
 * 变更集记录工作项执行期间所有改动的文件，支持统一审核。
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import type { ChangeSet, FileChange, FileChangeType } from './types';

import { handleError } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'workspace:ChangeSetStore',
  level: LogLevel.INFO,
});

/** 变更集存储子目录 */
const CHANGESETS_DIR = 'changesets';

/**
 * 变更集文件存储
 * 每个变更集存储为 .liri/changesets/<id>.json
 */
export class ChangeSetStore {
  /** 存储目录 */
  private storeDir: string;

  constructor(liriDir: string) {
    this.storeDir = join(liriDir, CHANGESETS_DIR);
  }

  /**
   * 确保存储目录存在
   */
  private ensureDir(): void {
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true });
    }
  }

  /**
   * 获取变更集文件路径
   */
  private getFilePath(id: string): string {
    return join(this.storeDir, `${id}.json`);
  }

  /**
   * 列出指定工作项的所有变更集
   */
  listByWorkItem(workItemId: string): ChangeSet[] {
    this.ensureDir();

    try {
      const files = readdirSync(this.storeDir);
      const changesets: ChangeSet[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = readFileSync(join(this.storeDir, file), 'utf-8');
          const cs = JSON.parse(content) as ChangeSet;
          if (cs.workItemId === workItemId) {
            changesets.push(cs);
          }
        } catch (err) {
          // 跳过损坏的文件

          handleError(err, {
            module: 'workspace:ChangeSetStore',
            action: 'skipCorruptedFile',
          });
        }
      }

      changesets.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      return changesets;
    } catch {
      return [];
    }
  }

  /**
   * 获取单个变更集
   */
  get(id: string): ChangeSet | null {
    const filePath = this.getFilePath(id);
    if (!existsSync(filePath)) return null;

    try {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as ChangeSet;
    } catch {
      return null;
    }
  }

  /**
   * 保存变更集
   */
  save(changeset: ChangeSet): void {
    this.ensureDir();
    const filePath = this.getFilePath(changeset.id);
    writeFileSync(filePath, JSON.stringify(changeset, null, 2), 'utf-8');
  }

  /**
   * 创建变更集
   */
  create(params: {
    workItemId: string;
    description: string;
    files?: FileChange[];
  }): ChangeSet {
    this.ensureDir();

    const now = new Date().toISOString();
    const id = `cs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const changeset: ChangeSet = {
      id,
      workItemId: params.workItemId,
      description: params.description,
      files: params.files || [],
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    };

    this.save(changeset);
    return changeset;
  }

  /**
   * 添加文件变更到变更集
   */
  addFileChange(changesetId: string, fileChange: FileChange): ChangeSet | null {
    const cs = this.get(changesetId);
    if (!cs) return null;

    // 更新或追加文件变更
    const existingIndex = cs.files.findIndex((f) => f.path === fileChange.path);
    if (existingIndex >= 0) {
      cs.files[existingIndex] = { ...cs.files[existingIndex], ...fileChange };
    } else {
      cs.files.push(fileChange);
    }

    cs.updatedAt = new Date().toISOString();
    this.save(cs);
    return cs;
  }

  /**
   * 记录文件变更（便捷方法）
   */
  recordFileChange(
    changesetId: string,
    path: string,
    change: FileChangeType,
    additions?: number,
    deletions?: number
  ): ChangeSet | null {
    return this.addFileChange(changesetId, {
      path,
      change,
      additions,
      deletions,
      status: 'pending',
    });
  }

  /**
   * 更新变更集状态
   */
  updateStatus(id: string, status: ChangeSet['status']): ChangeSet | null {
    const cs = this.get(id);
    if (!cs) return null;

    cs.status = status;
    cs.updatedAt = new Date().toISOString();
    this.save(cs);
    return cs;
  }

  /**
   * 批量更新文件变更状态
   */
  updateFileStatus(
    changesetId: string,
    filePath: string,
    status: FileChange['status']
  ): ChangeSet | null {
    const cs = this.get(changesetId);
    if (!cs) return null;

    const file = cs.files.find((f) => f.path === filePath);
    if (!file) return null;

    file.status = status;
    cs.updatedAt = new Date().toISOString();
    this.save(cs);
    return cs;
  }

  /**
   * 删除变更集
   */
  delete(id: string): boolean {
    const filePath = this.getFilePath(id);
    if (!existsSync(filePath)) return false;

    try {
      unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取变更集统计摘要
   */
  getSummary(changesetId: string): {
    totalFiles: number;
    added: number;
    modified: number;
    deleted: number;
    pending: number;
    verified: number;
    failed: number;
  } | null {
    const cs = this.get(changesetId);
    if (!cs) return null;

    const summary = {
      totalFiles: cs.files.length,
      added: 0,
      modified: 0,
      deleted: 0,
      pending: 0,
      verified: 0,
      failed: 0,
    };

    for (const file of cs.files) {
      summary[file.change]++;
      summary[file.status]++;
    }

    return summary;
  }
}

/**
 * 从 .liri/ 目录创建 ChangeSetStore 实例
 */
export function createChangeSetStore(liriDir: string): ChangeSetStore {
  return new ChangeSetStore(liriDir);
}
