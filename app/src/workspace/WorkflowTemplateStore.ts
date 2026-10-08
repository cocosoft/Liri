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
 * 工作流模板持久化存储（P2-1 落盘部分；台账 S24 ①）
 *
 * **背景（真实缺陷）**：模板 CRUD 原先落在**纯内存 Map**（`workflow-template-handlers.ts`
 * 的 `userTemplates`），进程重启即丢失 —— 而 `/v1/workflows/templates` 的 5 个 HTTP
 * CRUD 路由是**真实消费者**（非风格问题）。规格见 `.trae/specs/workflow-template-persistence.md`
 * （其 §6 曾自称"已在 main 落地"，实测**不成立**：该实现当时只存在于归档 tag
 * `dawate-archive-2026-09-16`，main 上零命中 ⇒ 本文件是在 main 上的**首次落地**）。
 *
 * **约定**（对齐本仓 `AgentRoleStore` 模式，CS01 复用）：
 * - 复用唯一 `app.db`（`resolveDbPath()`），**不新建 .db 文件**（project_rules §1.5）
 * - 表 `workflow_templates` 只存**用户自定义**模板；4 个内建模板保持代码内静态（D3）
 * - `steps` / `tags` 以 JSON 文本存储；`created_at` / `updated_at` 存 **ISO 文本**
 *   （与 `WorkflowTemplate` 域类型同源，避免时间戳精度/时区转换失真）
 */
import { Database } from '@modules/core/external/sqlite3';
import { getLogger } from '@modules/monitoring';
import { resolveDbPath } from '@modules/core';

import type { WorkflowTemplate } from './types';

const logger = getLogger('workspace:workflowTemplateStore');

/** workflow_templates 表名 */
export const WORKFLOW_TEMPLATES_TABLE = 'workflow_templates';

/** 数据行 */
interface WorkflowTemplateRow {
  id: string;
  name: string;
  description: string;
  category: string;
  /** `WorkflowStep[]` 的 JSON 文本 */
  steps: string;
  author: string;
  is_public: number;
  usage_count: number;
  /** ISO 文本 */
  created_at: string;
  /** ISO 文本 */
  updated_at: string;
  /** `string[]` 的 JSON 文本 */
  tags: string;
}

/** 数据行 → 域对象 */
function rowToTemplate(row: WorkflowTemplateRow): WorkflowTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    steps: JSON.parse(row.steps || '[]'),
    author: row.author,
    isPublic: row.is_public === 1,
    usageCount: row.usage_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tags: JSON.parse(row.tags || '[]'),
  };
}

/** 工作流模板存储库（用户自定义模板的唯一事实源） */
export class WorkflowTemplateStore {
  private db: Database | null = null;
  /** 进行中的初始化（并发调用共享，避免重复打开连接 —— 同 `AgentRoleStore` O11 修法） */
  private initPromise: Promise<void> | null = null;
  /**
   * **派生缓存**（非第二事实源；事实源仍是 `workflow_templates` 表）。
   *
   * 存在理由（P1-19 ②，2026-10-08）：workflow seam 的 `listWorkflows()` 是**同步**契约，
   * 而本 store 是**回调式异步** sqlite ⇒ 需要一个同步可见的快照。本类是表的**唯一写者**，
   * 故由本类在 `list`/`upsert`/`remove` 后同步维护，不会与库漂移。
   * 首次使用前须 `await init()` + `await list()` 预热（`registerWorkflowTemplateProvider` 已做）。
   */
  private snapshot: WorkflowTemplate[] = [];

  constructor(private readonly dbPath: string = resolveDbPath()) {}

  /** 打开连接并建表（幂等 + 并发安全） */
  async init(): Promise<void> {
    if (this.db) {
      return;
    }
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    await this.initPromise;
  }

  private async doInit(): Promise<void> {
    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve(db);
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `
        CREATE TABLE IF NOT EXISTS ${WORKFLOW_TEMPLATES_TABLE} (
          id           TEXT PRIMARY KEY,
          name         TEXT NOT NULL,
          description  TEXT NOT NULL DEFAULT '',
          category     TEXT NOT NULL DEFAULT 'custom',
          steps        TEXT NOT NULL DEFAULT '[]',
          author       TEXT NOT NULL DEFAULT 'user',
          is_public    INTEGER NOT NULL DEFAULT 0,
          usage_count  INTEGER NOT NULL DEFAULT 0,
          created_at   TEXT NOT NULL,
          updated_at   TEXT NOT NULL,
          tags         TEXT NOT NULL DEFAULT '[]'
        )
        `,
        (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });

    // 预热同步快照（P1-19 ②）：`listSync()` 是**同步**契约，若调用方未先 `list()` 就取用，
    // 会静默拿到空列表（"模板看似不可执行"的隐性错误）⇒ 在建表后立即填充一次。
    this.snapshot = await this.queryAll();

    logger.info('工作流模板表就绪', { table: WORKFLOW_TEMPLATES_TABLE });
  }

  /** 列出全部用户模板（按更新时间倒序）；**同时刷新同步快照** */
  async list(): Promise<WorkflowTemplate[]> {
    await this.init();
    const mapped = await this.queryAll();
    this.snapshot = mapped;
    return mapped;
  }

  /** 查全表（不含 `init()` 守卫 —— 供 `doInit` 预热与 `list()` 共用） */
  private async queryAll(): Promise<WorkflowTemplate[]> {
    return await new Promise<WorkflowTemplate[]>((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${WORKFLOW_TEMPLATES_TABLE} ORDER BY updated_at DESC`,
        (err: Error | null, rows: WorkflowTemplateRow[]) => {
          if (err) {
            reject(err);
          } else {
            resolve((rows || []).map(rowToTemplate));
          }
        }
      );
    });
  }

  /**
   * **同步快照**（供 workflow seam 的同步 `listWorkflows()` 消费）。
   *
   * 只读派生缓存：须先 `await list()` 预热；随后由 `upsert` / `remove` 同步维护。
   */
  listSync(): WorkflowTemplate[] {
    return this.snapshot;
  }

  /** 按 id 取用户模板（不存在 ⇒ `null`） */
  async get(id: string): Promise<WorkflowTemplate | null> {
    await this.init();
    return await new Promise<WorkflowTemplate | null>((resolve, reject) => {
      this.db!.get(
        `SELECT * FROM ${WORKFLOW_TEMPLATES_TABLE} WHERE id = ?`,
        [id],
        (err: Error | null, row: WorkflowTemplateRow | undefined) => {
          if (err) {
            reject(err);
          } else {
            resolve(row ? rowToTemplate(row) : null);
          }
        }
      );
    });
  }

  /** 新增或覆盖（handler 的 create / update 均走此处） */
  async upsert(template: WorkflowTemplate): Promise<WorkflowTemplate> {
    await this.init();
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `INSERT INTO ${WORKFLOW_TEMPLATES_TABLE}
           (id, name, description, category, steps, author, is_public, usage_count, created_at, updated_at, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           category = excluded.category,
           steps = excluded.steps,
           author = excluded.author,
           is_public = excluded.is_public,
           usage_count = excluded.usage_count,
           updated_at = excluded.updated_at,
           tags = excluded.tags`,
        [
          template.id,
          template.name,
          template.description ?? '',
          template.category ?? 'custom',
          JSON.stringify(template.steps ?? []),
          template.author ?? 'user',
          template.isPublic ? 1 : 0,
          template.usageCount ?? 0,
          template.createdAt,
          template.updatedAt,
          JSON.stringify(template.tags ?? []),
        ],
        (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            // 同步快照维护：本类是表的**唯一写者** ⇒ 此处更新不会与库漂移
            // （置于最前，与 `list()` 的 `updated_at DESC` 语义一致）
            this.snapshot = [
              template,
              ...this.snapshot.filter((t) => t.id !== template.id),
            ];
            resolve();
          }
        }
      );
    });
    return template;
  }

  /** 删除；返回**是否确有删除**（供 handler 的 404 判定，替代原 `has()` + `delete()` 两次访问） */
  async remove(id: string): Promise<boolean> {
    await this.init();
    const store = this;
    return await new Promise<boolean>((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${WORKFLOW_TEMPLATES_TABLE} WHERE id = ?`,
        [id],
        function (this: { changes?: number }, err: Error | null) {
          if (err) {
            reject(err);
            return;
          }
          const removed = (this?.changes ?? 0) > 0;
          if (removed) {
            // 同步快照维护（仅在确有删除时）
            store.snapshot = store.snapshot.filter((t) => t.id !== id);
          }
          resolve(removed);
        }
      );
    });
  }

  /** 关闭数据库连接 */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

/** 全局单例 */
let instance: WorkflowTemplateStore | null = null;

/** 获取 WorkflowTemplateStore 单例（方法内部自 `await init()`，调用方无需预热） */
export function getWorkflowTemplateStore(): WorkflowTemplateStore {
  if (!instance) {
    instance = new WorkflowTemplateStore();
  }
  return instance;
}
