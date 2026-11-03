/**
 * 项目文件存储
 *
 * 将项目持久化到 .liri/projects/ 目录下，每个项目一个 JSON 文件。
 * 支持项目级规则继承（.liri/projects/<id>/rules.md）。
 */

// C1（2026-10-09）：项目 id 熵源改用 crypto
import { randomIdSuffix } from '@openliri/infra/utils/common';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  rmSync,
  renameSync,
} from 'fs';
import { isAbsolute, join } from 'path';
import type {
  Project,
  ProjectBoard,
  ProjectBoardColumn,
  WorkItemTemplate,
  WorkItem,
  WorkItemStatus,
} from './types';
import { WorkItemStore } from './WorkItemStore';
import { resolveDataDir, resolveDataSubDir } from '@openliri/infra/environment';
// P2（2026-11-03）：项目工作区根的唯一解析入口（env > 用户设置 > 默认）
import { resolveProjectWorkspaceRoot } from './projectWorkspaceRoot';
// 多租户 P3：项目归属（创建请求的身份；本地身份不写字段、也不做过滤）
import {
  canAccessOwnerKey,
  currentOwnerKey,
} from '@openliri/kernel/identity/requestScope';
import { getLogger, getOTelTracing } from '@openliri/infra/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
// 2026-11-03（缺口 #2）：新建项目通知进程内订阅者（AlwaysOn 运行期注册）
import { globalEventBus } from '@openliri/kernel';
import { handleError } from '@openliri/infra/error';

const logger = getLogger('workspace:ProjectStore');

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
 * 「重新定位」结果（§九口径）：`noop` = 目标与当前相同（幂等，未写盘）。
 */
export interface RelocateProjectResult {
  project: Project;
  previousPath: string;
  noop: boolean;
}

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
   * 获取项目文件路径（v3.1: 目录结构 <id>/project.json）
   */
  private getFilePath(id: string): string {
    return join(this.storeDir, id, 'project.json');
  }

  /**
   * 获取旧版项目文件路径（<id>.json，惰性迁移用）
   */
  private getLegacyFilePath(id: string): string {
    return join(this.storeDir, `${id}.json`);
  }

  /**
   * 获取项目规则文件路径
   */
  private getRulesPath(id: string): string {
    return join(this.storeDir, id, 'rules.md');
  }

  /**
   * 读取项目（兼容旧路径，惰性迁移到新路径）
   */
  private _readProject(id: string): Project | null {
    const newPath = this.getFilePath(id);
    if (existsSync(newPath)) {
      try {
        return JSON.parse(readFileSync(newPath, 'utf-8')) as Project;
      } catch {
        // @ignore-catch 项目 JSON 损坏时按"不存在"处理，不阻断主流程
        return null;
      }
    }

    // 惰性迁移：旧路径存在则迁移到新路径
    const legacyPath = this.getLegacyFilePath(id);
    if (existsSync(legacyPath)) {
      try {
        const project = JSON.parse(
          readFileSync(legacyPath, 'utf-8')
        ) as Project;
        // 补足可能缺失的 phase 字段
        if (!project.phase) {
          project.phase =
            project.status === 'completed'
              ? 'completed'
              : project.status === 'archived'
                ? 'archived'
                : 'active';
        }
        this.save(project); // 写入新路径
        // 不删除旧文件以保安全，后续版本清理
        return project;
      } catch {
        // @ignore-catch 旧路径 JSON 损坏时按"不存在"处理，不阻断主流程
        return null;
      }
    }

    return null;
  }

  /**
   * 列出工作空间中所有项目
   */
  list(workspaceId: string): Project[] {
    this.ensureDir();

    try {
      const entries = readdirSync(this.storeDir, { withFileTypes: true });
      const projects: Project[] = [];
      const seen = new Set<string>();

      for (const entry of entries) {
        // 新路径：子目录中的 project.json
        if (entry.isDirectory()) {
          const projectPath = join(this.storeDir, entry.name, 'project.json');
          if (existsSync(projectPath)) {
            try {
              const content = readFileSync(projectPath, 'utf-8');
              const project = JSON.parse(content) as Project;
              // 多租户 P3：已认证身份看不到他人项目（本地身份 `canAccessOwnerKey` 恒真）
              if (
                project.workspaceId === workspaceId &&
                canAccessOwnerKey(project.ownerKey)
              ) {
                projects.push(project);
                seen.add(project.id);
              }
            } catch {
              // @ignore-catch 单个项目 JSON 损坏时跳过，不阻断列表
            }
          }
        }
        // 旧路径：<id>.json 文件（惰性迁移）
        else if (entry.isFile() && entry.name.endsWith('.json')) {
          const legacyPath = join(this.storeDir, entry.name);
          const id = entry.name.replace(/\.json$/, '');
          if (seen.has(id)) continue; // 新路径已有

          try {
            const content = readFileSync(legacyPath, 'utf-8');
            const project = JSON.parse(content) as Project;
            if (
              project.workspaceId === workspaceId &&
              canAccessOwnerKey(project.ownerKey)
            ) {
              // 补足缺失字段并迁移
              if (!project.phase) {
                project.phase =
                  project.status === 'completed'
                    ? 'completed'
                    : project.status === 'archived'
                      ? 'archived'
                      : 'active';
              }
              this.save(project); // 写入新路径
              projects.push(project);
              seen.add(project.id);
            }
          } catch {
            // @ignore-catch 旧路径项目 JSON 损坏时跳过，不阻断列表与迁移
          }
        }
      }

      projects.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      return projects;
    } catch {
      // @ignore-catch 列表读取失败返回空数组，调用方按"无项目"处理
      return [];
    }
  }

  /**
   * 获取单个项目
   *
   * 多租户 P3：越权读与"不存在"返回同一结果（`null`），不泄露项目存在性。
   */
  get(id: string): Project | null {
    const project = this._readProject(id);
    return project && canAccessOwnerKey(project.ownerKey) ? project : null;
  }

  /**
   * 保存项目（写入新目录结构 <id>/project.json）
   */
  save(project: Project): void {
    this.ensureDir();
    const dirPath = join(this.storeDir, project.id);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
    const filePath = this.getFilePath(project.id);
    // D-5 修复：原子写（临时文件 + rename）。原实现直接 writeFileSync，
    // 写一半崩溃 → project.json 损坏 → _readProject 返回 null → 项目静默"消失"。
    const tmpPath = `${filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(project, null, 2), 'utf-8');
    renameSync(tmpPath, filePath);
    // P0-1/P0-2: 幂等补写项目上下文文件，覆盖 create/update/惰性迁移所有写路径
    this.writeContextFile(project);
  }

  /**
   * P0-1/P0-2: 写入项目上下文文件（供 systemPromptSections.projectContext 读取）
   * 幂等：内容比对，名称/目标/文件夹/创建时间不一致才重写，避免高频 save 无谓 I/O
   * best-effort：失败仅 warn，不影响项目保存/创建/迁移主流程
   */
  private writeContextFile(project: Project): void {
    try {
      const projDir = join(this.storeDir, project.id);
      const contextPath = join(projDir, 'project-context.md');
      const content = `## 项目上下文\n\n**名称**: ${project.name}\n**目标**: ${project.description}\n**文件夹**: ${project.sandboxPath}\n**创建时间**: ${project.createdAt}\n`;
      if (existsSync(contextPath)) {
        const existing = readFileSync(contextPath, 'utf-8');
        if (existing === content) return;
      }
      mkdirSync(projDir, { recursive: true });
      writeFileSync(contextPath, content, 'utf-8');
    } catch (e) {
      // @ignore-catch best-effort：context 补写失败不影响项目保存/创建/迁移主流程（方案 P0-2 异常隔离）
      logger.warn('写入项目上下文文件失败', {
        projectId: project.id,
        error: String(e),
      });
    }
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
    sandboxPath?: string;
    /** E-7: 显式指定项目 ID（migrateWorktrees 保留旧 worktreeId，避免会话/历史无法关联） */
    id?: string;
    /** P0-5: 延迟创建 sandbox 文件夹（自动建项目时设为 true，等首次使用再 mkdir） */
    delaySandbox?: boolean;
  }): Project {
    const otel = getOTelTracing();
    const span = otel.startSpan('ProjectStore.create');
    try {
      this.ensureDir();

      const now = new Date().toISOString();
      const id = params.id ?? `proj_${Date.now()}_${randomIdSuffix(6)}`;

      // 解析 sandboxPath：用户指定 > 默认路径（`<项目工作区根>/<projectId>`）
      // P1/P2（2026-11-03）：默认根由 `resolveProjectWorkspaceRoot()` 提供
      //（`LIRI_PROJECTS_DIR` > 设置 `projectsDirectory` > `~/Documents/LiriProjects`）——
      // 原先在此处硬编码 `~/Documents/LiriProjects`，属路径注册表之外的第二处事实源。
      const sandboxPath =
        params.sandboxPath ?? join(resolveProjectWorkspaceRoot(), id);

      // P0（2026-11-03，cwd 方案 §六.3）：sandboxPath **写入期校验** —— 元数据一旦
      // 指向不可用路径，工具链要到 spawn 期才炸（libuv 把 chdir 失败误报成 cmd.exe 缺失）。
      // 显式指定时：必须绝对路径；已存在则必须是目录（存在为文件 ⇒ 拒绝写入）。
      // `delaySandbox`（自动建项目/迁移）允许目录尚不存在（延迟创建契约），但同样要绝对。
      if (!isAbsolute(sandboxPath)) {
        throw new Error(
          `项目 sandboxPath 必须是绝对路径，收到: ${JSON.stringify(sandboxPath)}`
        );
      }
      if (existsSync(sandboxPath) && !statSync(sandboxPath).isDirectory()) {
        throw new Error(
          `项目 sandboxPath 已存在但不是目录: ${sandboxPath}（请换一个路径或先移走该文件）`
        );
      }
      if (!params.delaySandbox && !existsSync(sandboxPath)) {
        mkdirSync(sandboxPath, { recursive: true });
      }

      const project: Project = {
        id,
        workspaceId: params.workspaceId,
        name: params.name,
        description: params.description || '',
        status: 'active',
        phase: 'active',
        workItemIds: [],
        pdcaIds: [],
        template: params.template,
        tags: params.tags || [],
        sandboxPath,
        // 多租户 P3：归属取创建请求的身份（本地身份 ⇒ undefined ⇒ 字段不落盘，零变更）
        ownerKey: currentOwnerKey(),
        createdAt: now,
        updatedAt: now,
      };

      this.save(project); // 项目上下文文件由 save() 幂等补写（P0-1/P0-2）

      logger.info('项目已创建', { projectId: id, name: params.name });
      // 2026-11-03（缺口 #2）：新建项目必须通知进程内订阅者 —— 此前 AlwaysOn 只在启动时
      // `collectProjects()` 收集一次 ⇒ 新建项目要重启才进入自主执行（与删除侧的
      // `project:deleted` 对称）。`delaySandbox`（自动建项目/迁移）时目录可能尚不存在，
      // 订阅方按 `pathExists` 自行跳过（不在此处替它判）。
      globalEventBus.publish('project:created', {
        projectId: project.id,
        name: project.name,
        path: sandboxPath,
        ownerKey: project.ownerKey,
      });
      span.setAttribute('projectId', id);
      span.setStatus({ code: SpanStatusCode.OK });
      return project;
    } catch (e) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
      void handleError(e, {
        module: 'workspace:ProjectStore',
        action: 'create',
      });
      throw e;
    } finally {
      span.end();
    }
  }

  /**
   * 「重新定位」：**只改项目指向的目录**，不复制、不移动、不删除任何文件。
   *
   * 口径见 `dev_docs/20261103/工具cwd无效根因与修复方案-20261103.md §九`：
   * - 目标必须**已存在且是目录**（不自动建目录 —— 否则是"指针修好了、产物不在"的假修复）；
   * - 与当前路径相同 ⇒ `noop`（幂等，不写盘、不动会话）；
   * - 刻意**不**复用 `update()`：那条链路是字段白名单（BUG-4 防注入），路径必须走独立入口。
   *
   * @throws 目标不合法（非绝对路径 / 不存在 / 不是目录）—— 由调用方转 400
   */
  relocate(id: string, nextSandboxPath: string): RelocateProjectResult | null {
    const project = this.get(id);
    if (!project) return null;

    if (!isAbsolute(nextSandboxPath)) {
      throw new Error(
        `项目 sandboxPath 必须是绝对路径，收到: ${JSON.stringify(nextSandboxPath)}`
      );
    }
    const previousPath = project.sandboxPath ?? '';
    if (nextSandboxPath === previousPath) {
      return { project, previousPath, noop: true };
    }
    if (!existsSync(nextSandboxPath)) {
      throw new Error(
        `目标目录不存在: ${nextSandboxPath}（请先把目录搬好/恢复到该位置；本操作不会创建或复制文件）`
      );
    }
    if (!statSync(nextSandboxPath).isDirectory()) {
      throw new Error(`目标路径不是目录: ${nextSandboxPath}`);
    }

    const merged: Project = {
      ...project,
      sandboxPath: nextSandboxPath,
      updatedAt: new Date().toISOString(),
    };
    // save() 会幂等重写 project-context.md（含「**文件夹**: <path>」）
    this.save(merged);
    return { project: merged, previousPath, noop: false };
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
    const otel = getOTelTracing();
    const span = otel.startSpan('ProjectStore.delete');
    span.setAttribute('projectId', id);
    try {
      // 多租户 P3：先校验归属再删 —— 越权与"删除失败"同一结果（false），
      // 且**不会**动他人的项目目录 / 历史记录。
      const existing = this._readProject(id);
      if (existing && !canAccessOwnerKey(existing.ownerKey)) {
        logger.warn('拒绝删除他人项目', { projectId: id });
        span.setStatus({ code: SpanStatusCode.OK });
        return false;
      }

      const dirPath = join(this.storeDir, id);
      let deleted = false;

      try {
        if (existsSync(dirPath)) {
          rmSync(dirPath, { recursive: true, force: true });
          deleted = true;
          logger.info('项目已删除', { projectId: id });
        }
      } catch (e) {
        // @ignore-catch 项目目录删除失败仅记录（项目实体仍删除），不阻断删除主流程
        void handleError(e, {
          module: 'workspace:ProjectStore',
          action: 'deleteDirectory',
        });
      }

      // BUG-4 修复：兼容旧格式（仅 <id>.json 未迁移的项目）。
      // 原实现只删目录，legacy-only 项目返回 false → 404 且文件残留 → 项目永远删不掉。
      try {
        const legacyPath = this.getLegacyFilePath(id);
        if (existsSync(legacyPath)) {
          unlinkSync(legacyPath);
          deleted = true;
          logger.info('旧格式项目文件已删除', { projectId: id });
        }
      } catch (e) {
        // @ignore-catch legacy 文件删除失败仅记录，不阻断删除主流程
        void handleError(e, {
          module: 'workspace:ProjectStore',
          action: 'deleteLegacyFile',
        });
      }

      // E-5 修复：清理历史记录（data/history/<projectId>/*.jsonl）。
      // 原实现只删项目目录，ProjectHistoryStore 的历史数据残留（磁盘垃圾累积，
      // 若未来 id 复用存在数据泄漏风险）。
      try {
        const historyDir = join(resolveDataSubDir('history'), id);
        if (existsSync(historyDir)) {
          rmSync(historyDir, { recursive: true, force: true });
          logger.info('项目历史记录已删除', { projectId: id });
        }
      } catch (e) {
        // @ignore-catch 历史目录删除失败仅记录，不阻断删除主流程
        void handleError(e, {
          module: 'workspace:ProjectStore',
          action: 'deleteHistory',
        });
      }

      span.setStatus({ code: SpanStatusCode.OK });
      return deleted;
    } finally {
      span.end();
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
   * 将 PDCA 任务关联到项目
   */
  addPdca(projectId: string, pdcaId: string): Project | null {
    const project = this.get(projectId);
    if (!project) return null;

    if (!project.pdcaIds.includes(pdcaId)) {
      project.pdcaIds.push(pdcaId);
      project.updatedAt = new Date().toISOString();
      this.save(project);
    }
    return project;
  }

  /**
   * 列出项目下所有 PDCA 任务 ID
   */
  listPdcaIds(projectId: string): string[] {
    const project = this.get(projectId);
    if (!project) return [];
    return [...project.pdcaIds];
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
      // @ignore-catch 规则文件读取失败返回空串，调用方按"无规则"处理
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
  // P1-1: 防御日志 — systemPromptSections 固定读 resolveDataDir()/projects/<id>/project-context.md，
  // 若用非默认数据目录创建 store，context 会写错位置导致 AI 读不到，此处提前暴露
  try {
    if (liriDir !== resolveDataDir()) {
      logger.warn(
        'createProjectStore: liriDir 与 resolveDataDir() 不一致，project-context.md 将写到读取端不可见的位置',
        { liriDir, dataDir: resolveDataDir() }
      );
    }
  } catch {
    /* 防御日志失败不影响创建 */
  }
  return new ProjectStore(liriDir, workItemStore);
}
