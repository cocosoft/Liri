/**
 * TaskStore — 统一任务节点 SQLite 存储
 *
 * Phase B: 替代 WorkItemStore（JSON 文件），所有 TaskNode 存入 app.db。
 * 参照 BalanceStore 模式：单例 + 延迟初始化 + CREATE TABLE IF NOT EXISTS。
 */

import { Database } from '@modules/core/external/sqlite3';
import { resolveDbPath } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import type { TaskNode, TaskStatus, TaskType } from './types';

const logger = getLogger('workspace:TaskStore');

const TABLE_NAME = 'tasks';

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

  private db: Database | null = null;
  private dbPath: string;
  private initPromise: Promise<void> | null = null;

  private constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  static getInstance(dbPath?: string): TaskStore {
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

  private createTables(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.db!.run(
        `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          id              TEXT PRIMARY KEY,
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
          updated_at      TEXT NOT NULL
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
            // 索引
            this.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON ${TABLE_NAME}(workspace_id)`,
              () => {}
            );
            this.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_tasks_project ON ${TABLE_NAME}(project_id)`,
              () => {}
            );
            this.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_tasks_status ON ${TABLE_NAME}(workspace_id, status)`,
              () => resolve()
            );
          }
        }
      );
    });
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
        `SELECT * FROM ${TABLE_NAME} WHERE workspace_id = ? ORDER BY created_at DESC`,
        [workspaceId],
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
        `SELECT * FROM ${TABLE_NAME} WHERE project_id = ? ORDER BY created_at DESC`,
        [projectId],
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
        `SELECT * FROM ${TABLE_NAME} WHERE id = ?`,
        [id],
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
        `INSERT OR REPLACE INTO ${TABLE_NAME}
          (id, workspace_id, project_id, title, description, type, status, priority,
           tags, parent_id, depends_on, estimated_effort, assignee, session_id,
           estimated_impact, risk_warnings, progress, started_at, completed_at,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        updates.status === 'archived'
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

      params.push(id);

      db.run(
        `UPDATE ${TABLE_NAME} SET ${setClauses.join(', ')} WHERE id = ?`,
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
        `DELETE FROM ${TABLE_NAME} WHERE id = ?`,
        [id],
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
        `SELECT * FROM ${TABLE_NAME} WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC`,
        [workspaceId, status],
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
        `SELECT * FROM ${TABLE_NAME} WHERE project_id = ? AND parent_id IS NULL ORDER BY created_at ASC`,
        [projectId],
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
        `SELECT * FROM ${TABLE_NAME} WHERE parent_id = ? ORDER BY created_at ASC`,
        [parentId],
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

/** 便捷获取单例 */
export const taskStore = TaskStore.getInstance();
