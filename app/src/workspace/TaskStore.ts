/**
 * TaskStore — 统一任务节点 SQLite 存储
 *
 * Phase B: 替代 WorkItemStore（JSON 文件），所有 TaskNode 存入 app.db。
 * 参照 BalanceStore 模式：单例 + 延迟初始化 + CREATE TABLE IF NOT EXISTS。
 */

import { Database } from '@modules/external';
import { resolveDbPath, resolveTenantDbPath } from '@modules/environment';
// 租户级 DB（基础设施专项 §6.1 期 3）：库按**租户**分，用户靠 `owner_key` 行级隔离
import {
  getRequestPrincipal,
  getRequestPrincipalKey,
  isLocalPrincipal,
  principalKeyOf,
} from '@openliri/kernel/identity/requestScope.js';
import { registerScopedResource } from '@openliri/kernel/identity/scopedResources.js';
import { getLogger } from '@modules/monitoring';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import type { TaskNode, TaskStatus, TaskType } from './types';

const logger = getLogger('workspace:TaskStore');

const TASKS_TABLE_NAME = 'tasks';

// ─── 数据库行类型（snake_case，匹配 SQLite 列） ───

interface TaskRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  description: string;
  type: string;
  status: string;
  priority: number;
  tags: string; // JSON 数组
  parent_id: string | null;
  depends_on: string; // JSON 数组
  estimated_effort: string | null;
  assignee: string | null;
  session_id: string | null;
  estimated_impact: string | null;
  risk_warnings: string | null; // JSON 数组
  progress: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── 序列化辅助 ───

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toJsonArray(arr: string[]): string {
  return JSON.stringify(arr);
}

function rowToNode(row: TaskRow): TaskNode {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id ?? undefined,
    title: row.title,
    description: row.description,
    type: row.type as TaskType,
    status: row.status as TaskStatus,
    priority: row.priority as TaskNode['priority'],
    tags: parseJsonArray(row.tags),
    parentId: row.parent_id ?? undefined,
    dependsOn: parseJsonArray(row.depends_on),
    estimatedEffort: row.estimated_effort ?? undefined,
    assignee: row.assignee ?? undefined,
    sessionId: row.session_id ?? undefined,
    estimatedImpact: row.estimated_impact ?? undefined,
    riskWarnings: parseJsonArray(row.risk_warnings),
    progress: row.progress,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Store ───

export class TaskStore {
  private static instance: TaskStore | null = null;
  /** 租户级库实例缓存（键 = `tenantId`；库按租户分，用户靠 `owner_key` 行级隔离） */
  private static scopedInstances = new Map<string, TaskStore>();

  private db: Database | null = null;
  private dbPath: string;
  private initPromise: Promise<void> | null = null;

  private constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  /** 显式 `dbPath` 实例缓存（键 = 路径；仅测试/工具注入，如 `':memory:'`） */
  private static explicitInstances = new Map<string, TaskStore>();

  /**
   * 取任务库实例。
   *
   * 租户级 DB（基础设施专项 §6.1 期 3）：本地身份 ⇒ 原单例（零变更）；已认证身份 ⇒
   * 该**租户**的实例（`tenants/<t>/app.db`），同租户内不同用户共用连接、按 `owner_key`
   * 行级隔离。**不做"共享实例换连接"**——单字段连接在 `await` 交错点会串库。
   */
  static getInstance(dbPath?: string): TaskStore {
    // 2026-10-24：显式路径（测试/工具注入）按路径分桶，**不**复用默认单例 ——
    // 原"首次创建后忽略入参"会让 `:memory:` 在默认单例已存在时拿到真实 `app.db`。
    if (dbPath !== undefined) {
      const existing = TaskStore.explicitInstances.get(dbPath);
      if (existing) return existing;
      const created = new TaskStore(dbPath);
      TaskStore.explicitInstances.set(dbPath, created);
      return created;
    }
    const principal = getRequestPrincipal();
    if (!isLocalPrincipal(principal)) {
      const key = principal.tenantId;
      const existing = TaskStore.scopedInstances.get(key);
      if (existing) return existing;
      const scoped = new TaskStore(resolveTenantDbPath(principal));
      TaskStore.scopedInstances.set(key, scoped);
      // 多租户 P5：登记 closer（关连接 + 摘除本类缓存），删租户时统一释放文件句柄。
      // 登记键用**创建者**的 `<tenant>:<user>`（purge 按 `<tenant>:` 前缀关闭）。
      registerScopedResource(principalKeyOf(principal), () => {
        scoped.close();
        TaskStore.scopedInstances.delete(key);
      });
      return scoped;
    }
    if (!TaskStore.instance) {
      TaskStore.instance = new TaskStore(dbPath);
    }
    return TaskStore.instance;
  }

  /** 确保数据库已初始化并建表 */
  async initialize(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });

    await this.createTables();
    logger.info('TaskStore 初始化完成');
  }

  // ─── 建表 ───

  /**
   * 建表 + 旧库补 `owner_key` 列。
   *
   * ⚠️ 租户库：主键为 `(id, owner_key)` —— 任务 id 是 UUID，实际不会跨用户撞；
   * 复合主键是**纵深防御**（防止 `INSERT OR REPLACE` 静默覆盖他人同 id 行）。
   * 旧库（单身份）仍是 `id` 单列主键，`ALTER` 不能改主键，但本地全 `local:local` ⇒ 不碰撞。
   */
  private async createTables(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `CREATE TABLE IF NOT EXISTS ${TASKS_TABLE_NAME} (
          id              TEXT NOT NULL,
          workspace_id    TEXT NOT NULL,
          project_id      TEXT,
          title           TEXT NOT NULL,
          description     TEXT NOT NULL DEFAULT '',
          type            TEXT NOT NULL DEFAULT 'task',
          status          TEXT NOT NULL DEFAULT 'planning',
          priority        INTEGER NOT NULL DEFAULT 3,
          tags            TEXT NOT NULL DEFAULT '[]',
          parent_id       TEXT,
          depends_on      TEXT NOT NULL DEFAULT '[]',
          estimated_effort TEXT,
          assignee        TEXT,
          session_id      TEXT,
          estimated_impact TEXT,
          risk_warnings   TEXT NOT NULL DEFAULT '[]',
          progress        INTEGER NOT NULL DEFAULT 0,
          started_at      TEXT,
          completed_at    TEXT,
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL,
          owner_key       TEXT NOT NULL DEFAULT 'local:local',
          PRIMARY KEY (id, owner_key)
        )`,
        (err: Error | null) => {
          if (err) {
            reject(
              new AppError(
                'TaskStore 建表失败',
                ErrorCategory.DATABASE,
                ErrorSeverity.HIGH,
                undefined,
                { error: String(err) }
              )
            );
          } else {
            resolve();
          }
        }
      );
    });

    const columns = await new Promise<Array<{ name: string }>>(
      (resolve, reject) => {
        this.db!.all(
          `PRAGMA table_info(${TASKS_TABLE_NAME})`,
          [],
          (err: Error | null, rows) =>
            err ? reject(err) : resolve((rows || []) as Array<{ name: string }>)
        );
      }
    );
    if (!columns.some((c) => c.name === 'owner_key')) {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `ALTER TABLE ${TASKS_TABLE_NAME} ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'local:local'`,
          (err: Error | null) => (err ? reject(err) : resolve())
        );
      });
    }

    await new Promise<void>((resolve) => {
      this.db!.run(
        `CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON ${TASKS_TABLE_NAME}(workspace_id)`,
        () => {}
      );
      this.db!.run(
        `CREATE INDEX IF NOT EXISTS idx_tasks_project ON ${TASKS_TABLE_NAME}(project_id)`,
        () => {}
      );
      this.db!.run(
        `CREATE INDEX IF NOT EXISTS idx_tasks_status ON ${TASKS_TABLE_NAME}(workspace_id, status)`,
        () => resolve()
      );
    });
  }

  /** 当前写入/查询的归属键（本地 ⇒ `local:local`） */
  private owner(): string {
    return getRequestPrincipalKey();
  }

  private ensureDb(): Database {
    if (!this.db) {
      throw new AppError(
        'TaskStore 未初始化，请先调用 initialize()',
        ErrorCategory.DATABASE,
        ErrorSeverity.HIGH
      );
    }
    return this.db;
  }

  // ─── CRUD ───

  /** 列出指定工作空间的所有任务 */
  listByWorkspace(workspaceId: string): Promise<TaskNode[]> {
    return new Promise((resolve) => {
      const db = this.ensureDb();
      db.all(
        `SELECT * FROM ${TASKS_TABLE_NAME}
          WHERE workspace_id = ? AND owner_key = ? ORDER BY created_at DESC`,
        [workspaceId, this.owner()],
        (err: Error | null, rows: TaskRow[]) => {
          if (err) {
            handleError(err, {
              module: 'workspace:TaskStore',
              action: 'listByWorkspace',
            });
            resolve([]);
          } else {
            resolve((rows || []).map(rowToNode));
          }
        }
      );
    });
  }

  /** 列出指定项目下的所有任务 */
  listByProject(projectId: string): Promise<TaskNode[]> {
    return new Promise((resolve) => {
      const db = this.ensureDb();
      db.all(
        `SELECT * FROM ${TASKS_TABLE_NAME}
          WHERE project_id = ? AND owner_key = ? ORDER BY created_at DESC`,
        [projectId, this.owner()],
        (err: Error | null, rows: TaskRow[]) => {
          if (err) {
            handleError(err, {
              module: 'workspace:TaskStore',
              action: 'listByProject',
            });
            resolve([]);
          } else {
            resolve((rows || []).map(rowToNode));
          }
        }
      );
    });
  }

  /** 获取单个任务 */
  get(id: string): Promise<TaskNode | null> {
    return new Promise((resolve) => {
      const db = this.ensureDb();
      db.get(
        `SELECT * FROM ${TASKS_TABLE_NAME} WHERE id = ? AND owner_key = ?`,
        [id, this.owner()],
        (err: Error | null, row: TaskRow | undefined) => {
          if (err || !row) {
            resolve(null);
          } else {
            resolve(rowToNode(row));
          }
        }
      );
    });
  }

  /** 创建或全量覆盖任务（UPSERT） */
  save(node: TaskNode): Promise<void> {
    return new Promise((resolve, reject) => {
      const db = this.ensureDb();
      db.run(
        `INSERT OR REPLACE INTO ${TASKS_TABLE_NAME}
          (id, workspace_id, project_id, title, description, type, status, priority,
           tags, parent_id, depends_on, estimated_effort, assignee, session_id,
           estimated_impact, risk_warnings, progress, started_at, completed_at,
           created_at, updated_at, owner_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          node.id,
          node.workspaceId,
          node.projectId ?? null,
          node.title,
          node.description,
          node.type,
          node.status,
          node.priority,
          toJsonArray(node.tags),
          node.parentId ?? null,
          toJsonArray(node.dependsOn),
          node.estimatedEffort ?? null,
          node.assignee ?? null,
          node.sessionId ?? null,
          node.estimatedImpact ?? null,
          toJsonArray(node.riskWarnings ?? []),
          node.progress,
          node.startedAt ?? null,
          node.completedAt ?? null,
          node.createdAt,
          node.updatedAt,
          this.owner(),
        ],
        (err: Error | null) => {
          if (err) {
            // D-4 修复：错误必须 reject（原实现只 handleError 不 reject，
            // Promise 永远 resolve → saveBatch 的 catch/ROLLBACK 成为死代码，
            // 批量保存中单行失败时整体仍报成功 = 静默部分失败）
            handleError(err, { module: 'workspace:TaskStore', action: 'save' });
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  /** 批量保存（事务内） */
  async saveBatch(nodes: TaskNode[]): Promise<void> {
    const db = this.ensureDb();
    await new Promise<void>((resolve) => {
      db.run('BEGIN TRANSACTION', () => resolve());
    });

    try {
      for (const node of nodes) {
        await this.save(node);
      }
      await new Promise<void>((resolve) => {
        db.run('COMMIT', () => resolve());
      });
    } catch (err) {
      await new Promise<void>((resolve) => {
        db.run('ROLLBACK', () => resolve());
      });
      throw err;
    }
  }

  /** 更新任务字段 */
  update(
    id: string,
    updates: Partial<
      Pick<
        TaskNode,
        | 'title'
        | 'description'
        | 'type'
        | 'status'
        | 'priority'
        | 'progress'
        | 'assignee'
        | 'sessionId'
        | 'tags'
        | 'parentId'
        | 'dependsOn'
        | 'estimatedEffort'
        | 'estimatedImpact'
        | 'riskWarnings'
      >
    >
  ): Promise<TaskNode | null> {
    return new Promise((resolve) => {
      const db = this.ensureDb();
      const setClauses: string[] = [];
      const params: unknown[] = [];

      const fieldMap: Record<string, string> = {
        title: 'title',
        description: 'description',
        type: 'type',
        status: 'status',
        priority: 'priority',
        progress: 'progress',
        assignee: 'assignee',
        sessionId: 'session_id',
        estimatedEffort: 'estimated_effort',
        estimatedImpact: 'estimated_impact',
        parentId: 'parent_id',
      };

      for (const [key, col] of Object.entries(fieldMap)) {
        if (key in updates) {
          setClauses.push(`${col} = ?`);
          params.push((updates as Record<string, unknown>)[key] ?? null);
        }
      }

      // 数组字段特殊处理
      if (updates.tags) {
        setClauses.push('tags = ?');
        params.push(toJsonArray(updates.tags));
      }
      if (updates.dependsOn) {
        setClauses.push('depends_on = ?');
        params.push(toJsonArray(updates.dependsOn));
      }
      if (updates.riskWarnings) {
        setClauses.push('risk_warnings = ?');
        params.push(toJsonArray(updates.riskWarnings));
      }

      if (setClauses.length === 0) {
        this.get(id)
          .then(resolve)
          .catch(() => resolve(null));
        return;
      }

      setClauses.push('updated_at = ?');
      params.push(new Date().toISOString());

      // 终态处理
      if (
        updates.status === 'completed' ||
        updates.status === 'failed' ||
        updates.status === 'archived' ||
        updates.status === 'cancelled'
      ) {
        setClauses.push('completed_at = ?');
        params.push(new Date().toISOString());
      }
      if (
        updates.status === 'active' &&
        !('started_at' in (updates as Record<string, unknown>))
      ) {
        // 首次进入 active 时自动设置 started_at（仅当尚未设置时）
        setClauses.push('started_at = COALESCE(started_at, ?)');
        params.push(new Date().toISOString());
      }

      params.push(id, this.owner());

      db.run(
        `UPDATE ${TASKS_TABLE_NAME} SET ${setClauses.join(', ')}
          WHERE id = ? AND owner_key = ?`,
        params,
        (err: Error | null) => {
          if (err) {
            handleError(err, {
              module: 'workspace:TaskStore',
              action: 'update',
            });
            resolve(null);
          } else {
            this.get(id)
              .then(resolve)
              .catch(() => resolve(null));
          }
        }
      );
    });
  }

  /** 删除任务 */
  delete(id: string): Promise<boolean> {
    return new Promise((resolve) => {
      const db = this.ensureDb();
      db.run(
        `DELETE FROM ${TASKS_TABLE_NAME} WHERE id = ? AND owner_key = ?`,
        [id, this.owner()],
        (err: Error | null) => {
          if (err) {
            handleError(err, {
              module: 'workspace:TaskStore',
              action: 'delete',
            });
            resolve(false);
          } else {
            resolve(true);
          }
        }
      );
    });
  }

  /** 按状态筛选 */
  listByStatus(workspaceId: string, status: TaskStatus): Promise<TaskNode[]> {
    return new Promise((resolve) => {
      const db = this.ensureDb();
      db.all(
        `SELECT * FROM ${TASKS_TABLE_NAME}
          WHERE workspace_id = ? AND status = ? AND owner_key = ?
          ORDER BY created_at DESC`,
        [workspaceId, status, this.owner()],
        (err: Error | null, rows: TaskRow[]) => {
          if (err) {
            handleError(err, {
              module: 'workspace:TaskStore',
              action: 'listByStatus',
            });
            resolve([]);
          } else {
            resolve((rows || []).map(rowToNode));
          }
        }
      );
    });
  }

  /** 获取项目的根任务（parent_id IS NULL） */
  listRootTasks(projectId: string): Promise<TaskNode[]> {
    return new Promise((resolve) => {
      const db = this.ensureDb();
      db.all(
        `SELECT * FROM ${TASKS_TABLE_NAME}
          WHERE project_id = ? AND parent_id IS NULL AND owner_key = ?
          ORDER BY created_at ASC`,
        [projectId, this.owner()],
        (err: Error | null, rows: TaskRow[]) => {
          if (err) {
            handleError(err, {
              module: 'workspace:TaskStore',
              action: 'listRootTasks',
            });
            resolve([]);
          } else {
            resolve((rows || []).map(rowToNode));
          }
        }
      );
    });
  }

  /** 获取子任务 */
  listChildren(parentId: string): Promise<TaskNode[]> {
    return new Promise((resolve) => {
      const db = this.ensureDb();
      db.all(
        `SELECT * FROM ${TASKS_TABLE_NAME}
          WHERE parent_id = ? AND owner_key = ? ORDER BY created_at ASC`,
        [parentId, this.owner()],
        (err: Error | null, rows: TaskRow[]) => {
          if (err) {
            handleError(err, {
              module: 'workspace:TaskStore',
              action: 'listChildren',
            });
            resolve([]);
          } else {
            resolve((rows || []).map(rowToNode));
          }
        }
      );
    });
  }

  /** 关闭数据库连接 */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }
}
