/**
 * 项目文件存储
 *
 * 将项目持久化到 .liri/projects/ 目录下，每个项目一个 JSON 文件。
 * 支持项目级规则继承（.liri/projects/<id>/rules.md）。
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
import type {
  Project,
  ProjectBoard,
  ProjectBoardColumn,
  WorkItemTemplate,
  WorkItem,
  WorkItemStatus,
} from './types';
import { WorkItemStore } from './WorkItemStore';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'workspace:ProjectStore',
  level: LogLevel.INFO,
});

/** 项目存储子目录 */
const PROJECTS_DIR = 'projects';

/** 工作项状态到看板列标题的映射 */
const STATUS_LABELS: Record<WorkItemStatus, string> = {
  pending: '待处理',
  running: '执行中',
  paused: '已暂停',
  review: '待审核',
  done: '已完成',
  failed: '已失败',
};

/** 内置工作项模板 */
const BUILTIN_TEMPLATES: WorkItemTemplate[] = [
  {
    type: 'bug',
    name: 'Bug 修复',
    description: '修复代码缺陷或异常行为',
    defaultTags: ['bug', '修复'],
    defaultPriority: 2,
    checklist: ['复现步骤', '根因分析', '修复方案', '验证修复'],
    estimatedImpact: '修复目标文件及关联测试',
    riskWarnings: ['注意回归风险', '检查是否有其他类似问题'],
  },
  {
    type: 'feature',
    name: '新功能',
    description: '实现新的功能特性',
    defaultTags: ['feature', '新功能'],
    defaultPriority: 3,
    checklist: ['需求确认', '接口设计', '实现', '单元测试', '集成测试'],
    estimatedImpact: '新增文件及现有模块扩展',
    riskWarnings: ['注意向后兼容性', '需更新文档'],
  },
  {
    type: 'refactor',
    name: '重构',
    description: '优化代码结构，不改变外部行为',
    defaultTags: ['refactor', '重构'],
    defaultPriority: 3,
    checklist: ['确认现有行为', '制定重构方案', '逐步重构', '回归测试'],
    estimatedImpact: '目标模块及相关依赖',
    riskWarnings: ['确保行为不变', '大规模重构需分步进行'],
  },
  {
    type: 'docs',
    name: '文档',
    description: '编写或更新项目文档',
    defaultTags: ['docs', '文档'],
    defaultPriority: 4,
    checklist: ['确认文档范围', '编写内容', '格式检查', '审核'],
    estimatedImpact: '仅文档文件',
    riskWarnings: [],
  },
  {
    type: 'task',
    name: '通用任务',
    description: '通用工作任务',
    defaultTags: [],
    defaultPriority: 3,
    checklist: [],
    estimatedImpact: '待评估',
    riskWarnings: [],
  },
  {
    type: 'decision',
    name: '技术决策',
    description: '记录和评估技术决策',
    defaultTags: ['decision', '决策'],
    defaultPriority: 2,
    checklist: ['问题描述', '可选方案', '方案对比', '最终决策', '决策理由'],
    estimatedImpact: '架构或技术选型层面',
    riskWarnings: ['影响范围可能较大', '需团队共识'],
  },
];

/**
 * 项目文件存储
 * 每个项目存储为 .liri/projects/<id>.json
 */
export class ProjectStore {
  /** 存储目录 */
  private storeDir: string;

  /** 工作项存储（用于构建看板） */
  private workItemStore: WorkItemStore;

  constructor(liriDir: string, workItemStore: WorkItemStore) {
    this.storeDir = join(liriDir, PROJECTS_DIR);
    this.workItemStore = workItemStore;
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
   * 获取项目文件路径
   */
  private getFilePath(id: string): string {
    return join(this.storeDir, `${id}.json`);
  }

  /**
   * 获取项目规则文件路径
   */
  private getRulesPath(id: string): string {
    return join(this.storeDir, id, 'rules.md');
  }

  /**
   * 列出工作空间中所有项目
   */
  list(workspaceId: string): Project[] {
    this.ensureDir();

    try {
      const files = readdirSync(this.storeDir);
      const projects: Project[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = readFileSync(join(this.storeDir, file), 'utf-8');
          const project = JSON.parse(content) as Project;
          if (project.workspaceId === workspaceId) {
            projects.push(project);
          }
        } catch (err) {
          // 跳过损坏的文件

          logger.debug('Operation skipped', {
            context: '跳过损坏的文件',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      projects.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      return projects;
    } catch {
      return [];
    }
  }

  /**
   * 获取单个项目
   */
  get(id: string): Project | null {
    const filePath = this.getFilePath(id);
    if (!existsSync(filePath)) return null;

    try {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as Project;
    } catch {
      return null;
    }
  }

  /**
   * 保存项目
   */
  save(project: Project): void {
    this.ensureDir();
    const filePath = this.getFilePath(project.id);
    writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8');
  }

  /**
   * 创建项目
   */
  create(params: {
    workspaceId: string;
    name: string;
    description?: string;
    template?: Project['template'];
    tags?: string[];
  }): Project {
    this.ensureDir();

    const now = new Date().toISOString();
    const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const project: Project = {
      id,
      workspaceId: params.workspaceId,
      name: params.name,
      description: params.description || '',
      status: 'active',
      workItemIds: [],
      template: params.template,
      tags: params.tags || [],
      createdAt: now,
      updatedAt: now,
    };

    this.save(project);
    return project;
  }

  /**
   * 更新项目字段
   */
  update(
    id: string,
    updates: Partial<
      Pick<Project, 'name' | 'description' | 'status' | 'tags' | 'template'>
    >
  ): Project | null {
    const project = this.get(id);
    if (!project) return null;

    const merged: Project = {
      ...project,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if (updates.status === 'completed' || updates.status === 'archived') {
      merged.completedAt = new Date().toISOString();
    }

    this.save(merged);
    return merged;
  }

  /**
   * 删除项目
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
   * 将工作项关联到项目
   */
  addWorkItem(projectId: string, workItemId: string): Project | null {
    const project = this.get(projectId);
    if (!project) return null;

    if (!project.workItemIds.includes(workItemId)) {
      project.workItemIds.push(workItemId);
      project.updatedAt = new Date().toISOString();
      this.save(project);
    }

    return project;
  }

  /**
   * 从项目移除工作项关联
   */
  removeWorkItem(projectId: string, workItemId: string): Project | null {
    const project = this.get(projectId);
    if (!project) return null;

    project.workItemIds = project.workItemIds.filter((id) => id !== workItemId);
    project.updatedAt = new Date().toISOString();
    this.save(project);
    return project;
  }

  /**
   * 构建项目看板
   * 按工作项状态分组，返回各列的工作项列表
   */
  buildBoard(projectId: string): ProjectBoard | null {
    const project = this.get(projectId);
    if (!project) return null;

    const allStatuses: WorkItemStatus[] = [
      'pending',
      'running',
      'paused',
      'review',
      'done',
      'failed',
    ];

    const columns: ProjectBoardColumn[] = allStatuses.map((status) => {
      const items = project.workItemIds
        .map((id) => this.workItemStore.get(id))
        .filter(
          (item): item is WorkItem => item !== null && item.status === status
        );

      return {
        id: status,
        title: STATUS_LABELS[status],
        items,
      };
    });

    return { projectId, columns };
  }

  /**
   * 获取项目级规则内容
   */
  getRules(projectId: string): string {
    const rulesPath = this.getRulesPath(projectId);
    if (!existsSync(rulesPath)) return '';

    try {
      return readFileSync(rulesPath, 'utf-8');
    } catch {
      return '';
    }
  }

  /**
   * 保存项目级规则
   */
  saveRules(projectId: string, content: string): void {
    const rulesPath = this.getRulesPath(projectId);
    const rulesDir = join(this.storeDir, projectId);

    if (!existsSync(rulesDir)) {
      mkdirSync(rulesDir, { recursive: true });
    }

    writeFileSync(rulesPath, content, 'utf-8');
  }

  /**
   * 获取工作项模板列表
   */
  getTemplates(): WorkItemTemplate[] {
    return BUILTIN_TEMPLATES;
  }

  /**
   * 获取指定类型的工作项模板
   */
  getTemplate(type: WorkItemTemplate['type']): WorkItemTemplate | undefined {
    return BUILTIN_TEMPLATES.find((t) => t.type === type);
  }

  /**
   * 按模板创建工作项
   */
  createWorkItemFromTemplate(
    projectId: string,
    params: {
      title: string;
      description?: string;
      type?: WorkItemTemplate['type'];
    }
  ): WorkItem | null {
    const project = this.get(projectId);
    if (!project) return null;

    const template = this.getTemplate(params.type || 'task');
    const item = this.workItemStore.create({
      workspaceId: project.workspaceId,
      title: params.title,
      description: params.description || template?.description || '',
      type: template?.type || 'task',
      tags: template?.defaultTags,
      priority: template?.defaultPriority,
    });

    if (item) {
      this.addWorkItem(projectId, item.id);
    }

    return item;
  }
}

/**
 * 从 .liri/ 目录创建 ProjectStore 实例
 */
export function createProjectStore(
  liriDir: string,
  workItemStore: WorkItemStore
): ProjectStore {
  return new ProjectStore(liriDir, workItemStore);
}
