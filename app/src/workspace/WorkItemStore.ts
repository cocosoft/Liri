/**
 * 工作项文件存储
 *
 * 将工作项持久化到 .liri/workitems/ 目录下，每个工作项一个 JSON 文件。
 * 生命周期状态：pending → running → paused | review → done | failed
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
import type { WorkItem, WorkItemStatus, WorkItemType } from './types';
import type { LiriConfigManager } from './LiriConfigManager';

import { handleError } from '@modules/error';

/** .liri/workitems/ 子目录 */
const WORKITEMS_DIR = 'workitems';

/** 记忆条目标签 */
const MEMORY_TAG = 'auto:workitem';

/**
 * 工作项文件存储
 * 每个工作项存储为 .liri/workitems/<id>.json
 */
export class WorkItemStore {
  /** .liri/ 目录路径 */
  private liriDir: string;

  /** 工作项存储目录 */
  private itemsDir: string;

  /** 可选的 LiriConfigManager（用于经验自动沉淀） */
  private configManager?: LiriConfigManager;

  constructor(liriDir: string, configManager?: LiriConfigManager) {
    this.liriDir = liriDir;
    this.itemsDir = join(liriDir, WORKITEMS_DIR);
    this.configManager = configManager;
  }

  /**
   * 确保存储目录存在
   */
  private ensureDir(): void {
    if (!existsSync(this.itemsDir)) {
      mkdirSync(this.itemsDir, { recursive: true });
    }
  }

  /**
   * 获取工作项文件路径
   */
  private getItemPath(id: string): string {
    return join(this.itemsDir, `${id}.json`);
  }

  /**
   * 列出指定工作空间的所有工作项
   */
  list(workspaceId: string): WorkItem[] {
    this.ensureDir();

    try {
      const files = readdirSync(this.itemsDir);
      const items: WorkItem[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = readFileSync(join(this.itemsDir, file), 'utf-8');
          const item = JSON.parse(content) as WorkItem;
          if (item.workspaceId === workspaceId) {
            items.push(item);
          }
        } catch (err) {
          // 跳过损坏的文件

          handleError(err, {
            module: 'workspace:WorkItemStore',
            action: 'skipCorruptedFile',
          });
        }
      }

      // 按创建时间倒序排列
      items.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      return items;
    } catch {
      return [];
    }
  }

  /**
   * 获取单个工作项
   */
  get(id: string): WorkItem | null {
    const filePath = this.getItemPath(id);
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as WorkItem;
    } catch {
      return null;
    }
  }

  /**
   * 创建或更新工作项
   */
  save(item: WorkItem): void {
    this.ensureDir();
    const filePath = this.getItemPath(item.id);
    writeFileSync(filePath, JSON.stringify(item, null, 2), 'utf-8');
  }

  /**
   * 更新工作项字段
   * 当状态变为 "done" 时，自动沉淀经验摘要到 .liri/memory/
   */
  update(
    id: string,
    updates: Partial<
      Pick<
        WorkItem,
        | 'title'
        | 'description'
        | 'type'
        | 'status'
        | 'sessionId'
        | 'tags'
        | 'priority'
      >
    >
  ): WorkItem | null {
    const item = this.get(id);
    if (!item) return null;

    const merged: WorkItem = {
      ...item,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if (updates.status === 'done' || updates.status === 'failed') {
      merged.completedAt = new Date().toISOString();

      // 经验自动沉淀：工作项完成时写入 memory
      this.accumulateExperience(merged);
    }

    this.save(merged);
    return merged;
  }

  /**
   * 自动沉淀经验到 .liri/memory/
   * 提取工作项的关键信息生成经验摘要
   */
  private accumulateExperience(item: WorkItem): void {
    if (!this.configManager) return;

    const summary = this.generateExperienceSummary(item);
    if (!summary) return;

    this.configManager.addMemoryEntry({
      tag: MEMORY_TAG,
      source: `workitem:${item.id}`,
      title: item.title,
      content: summary,
      summary,
      createdAt: new Date().toISOString(),
      metadata: {
        workItemId: item.id,
        workItemType: item.type,
        workItemStatus: item.status,
        tags: item.tags,
      },
    });
  }

  /**
   * 生成工作项经验摘要
   */
  private generateExperienceSummary(item: WorkItem): string {
    const parts: string[] = [];

    parts.push(`[${item.type}] ${item.title}`);

    if (item.description) {
      parts.push(`描述: ${item.description}`);
    }

    parts.push(`状态: ${item.status}`);
    parts.push(`完成时间: ${item.completedAt || item.updatedAt}`);

    if (item.tags && item.tags.length > 0) {
      parts.push(`标签: ${item.tags.join(', ')}`);
    }

    if (item.riskWarnings && item.riskWarnings.length > 0) {
      parts.push(`风险提示: ${item.riskWarnings.join('; ')}`);
    }

    return parts.join('\n');
  }

  /**
   * 删除工作项
   */
  delete(id: string): boolean {
    const filePath = this.getItemPath(id);
    if (!existsSync(filePath)) return false;

    try {
      unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 按状态筛选工作项
   */
  listByStatus(workspaceId: string, status: WorkItemStatus): WorkItem[] {
    return this.list(workspaceId).filter((item) => item.status === status);
  }

  /**
   * 创建新工作项
   */
  create(params: {
    workspaceId: string;
    title: string;
    description?: string;
    type?: WorkItemType;
    sessionId?: string;
    tags?: string[];
    priority?: number;
  }): WorkItem {
    this.ensureDir();

    const now = new Date().toISOString();
    const id = `wi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const item: WorkItem = {
      id,
      workspaceId: params.workspaceId,
      title: params.title,
      description: params.description || '',
      type: params.type || 'task',
      status: 'pending',
      sessionId: params.sessionId,
      tags: params.tags || [],
      priority: params.priority || 3,
      createdAt: now,
      updatedAt: now,
    };

    this.save(item);
    return item;
  }
}

/**
 * 从 .liri/ 目录创建 WorkItemStore 实例
 */
export function createWorkItemStore(
  liriDir: string,
  configManager?: LiriConfigManager
): WorkItemStore {
  return new WorkItemStore(liriDir, configManager);
}
