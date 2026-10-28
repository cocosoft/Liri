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
 * - 租户级 DB（§6.1 / §1.5，2026-10-25 补齐）：库按**租户**分（`tenants/<t>/app.db`），
 *   租户内按 `owner_key`（`<tenant>:<user>`）行级隔离；表 `workflow_templates` 只存
 *   **用户自定义**模板（4 个内建模板保持代码内静态，D3）—— 用户模板是用户级数据，
 *   此前落在共享本地库且无归属列 ⇒ 租户内两用户互相可见/覆盖。
 * - `steps` / `tags` 以 JSON 文本存储；`created_at` / `updated_at` 存 **ISO 文本**
 *   （与 `WorkflowTemplate` 域类型同源，避免时间戳精度/时区转换失真）
 */
import { Database } from '@modules/external';
import { getLogger } from '@modules/monitoring';
import { resolveDbPath, resolveTenantDbPath } from '@modules/environment';
import {
  getRequestPrincipal,
  getRequestPrincipalKey,
  isLocalPrincipal,
  principalKeyOf,
} from '@openliri/kernel/identity/requestScope.js';
import { registerScopedResource } from '@openliri/kernel/identity/scopedResources.js';

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
   *
   * **按 owner 分桶**（2026-10-25，租户级 DB §6.1）：实例按 tenantId 分桶后，同一租户
   * 两用户交替 `list()` 若写同一份快照会互相污染 ⇒ 以 `owner_key` 分桶，`listSync()`
   * 同步读**当前身份**的桶（本地身份 ⇒ `local:local` 桶）。
   */
  private snapshotByOwner = new Map<string, WorkflowTemplate[]>();

  constructor(private readonly dbPath?: string) {}

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
    const dbPath = this.dbPath ?? resolveDbPath();
    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(dbPath, (err: Error | null) => {
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
          owner_key    TEXT NOT NULL DEFAULT 'local:local',
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

    // **补 owner_key 列**（2026-10-25，租户级 DB §6.1）：已建表的库没有该列。
    // SQLite 的 `ALTER TABLE` 不能改主键 ⇒ 旧库仍是 `id` 单列 PK；本地库只有
    // `local:local` 一种归属 ⇒ 不会与租户行碰撞（存量行落默认值即本地身份）。
    await new Promise<void>((resolve) => {
      this.db!.run(
        `ALTER TABLE ${WORKFLOW_TEMPLATES_TABLE} ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'local:local'`,
        (err: Error | null) => {
          if (err && !/duplicate column/i.test(err.message)) {
            logger.warn('workflow_templates 补 owner_key 失败', {
              error: err.message,
            });
          }
          resolve();
        }
      );
    });

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `CREATE INDEX IF NOT EXISTS idx_workflow_templates_owner
         ON ${WORKFLOW_TEMPLATES_TABLE} (owner_key, updated_at DESC)`,
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
    this.snapshotByOwner.set(
      this.owner(),
      await this.queryAllForOwner(this.owner())
    );

    logger.info('工作流模板表就绪', { table: WORKFLOW_TEMPLATES_TABLE });
  }

  /** 当前身份归属键（本地 ⇒ `local:local`；租户 ⇒ `<tenant>:<user>`） */
  private owner(): string {
    return getRequestPrincipalKey();
  }

  /** 列出当前用户模板（按更新时间倒序）；**同时刷新当前身份的同步快照** */
  async list(): Promise<WorkflowTemplate[]> {
    await this.init();
    const owner = this.owner();
    const mapped = await this.queryAllForOwner(owner);
    this.snapshotByOwner.set(owner, mapped);
    return mapped;
  }

  /** 查当前归属全表（不含 `init()` 守卫 —— 供 `doInit` 预热与 `list()` 共用） */
  private async queryAllForOwner(owner: string): Promise<WorkflowTemplate[]> {
    return await new Promise<WorkflowTemplate[]>((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${WORKFLOW_TEMPLATES_TABLE}
           WHERE owner_key = ? ORDER BY updated_at DESC`,
        [owner],
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
   * 只读派生缓存：读**当前身份**的桶（须先 `await list()` 预热；随后由 `upsert` / `remove`
   * 同步维护）；他人桶与本桶物理隔离，不会串读。
   */
  listSync(): WorkflowTemplate[] {
    return this.snapshotByOwner.get(this.owner()) ?? [];
  }

  /** 按 id 取当前用户模板（不存在 / 他人的 ⇒ `null`） */
  async get(id: string): Promise<WorkflowTemplate | null> {
    await this.init();
    return await new Promise<WorkflowTemplate | null>((resolve, reject) => {
      this.db!.get(
        `SELECT * FROM ${WORKFLOW_TEMPLATES_TABLE} WHERE id = ? AND owner_key = ?`,
        [id, this.owner()],
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
    const owner = this.owner();
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `INSERT INTO ${WORKFLOW_TEMPLATES_TABLE}
           (id, owner_key, name, description, category, steps, author, is_public, usage_count, created_at, updated_at, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          owner,
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
            this.snapshotByOwner.set(owner, [
              template,
              ...(this.snapshotByOwner.get(owner) ?? []).filter(
                (t) => t.id !== template.id
              ),
            ]);
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
    const owner = this.owner();
    const store = this;
    return await new Promise<boolean>((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${WORKFLOW_TEMPLATES_TABLE} WHERE id = ? AND owner_key = ?`,
        [id, owner],
        function (this: { changes?: number }, err: Error | null) {
          if (err) {
            reject(err);
            return;
          }
          const removed = (this?.changes ?? 0) > 0;
          if (removed) {
            // 同步快照维护（仅在确有删除时；只动当前身份桶）
            store.snapshotByOwner.set(
              owner,
              (store.snapshotByOwner.get(owner) ?? []).filter(
                (t) => t.id !== id
              )
            );
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
/** 租户级实例缓存（键 = `tenantId`；同租户共用连接，按 `owner_key` 行级隔离） */
const scopedInstances = new Map<string, WorkflowTemplateStore>();
/** 显式 `dbPath` 实例缓存（键 = 路径；仅测试/工具注入） */
const explicitInstances = new Map<string, WorkflowTemplateStore>();

/** 获取 WorkflowTemplateStore 单例（方法内部自 `await init()`，调用方无需预热） */
export function getWorkflowTemplateStore(
  dbPath?: string
): WorkflowTemplateStore {
  // 2026-10-25：显式路径（测试/工具注入）按路径分桶，**不**复用默认单例
  if (dbPath !== undefined) {
    const existing = explicitInstances.get(dbPath);
    if (existing) return existing;
    const created = new WorkflowTemplateStore(dbPath);
    explicitInstances.set(dbPath, created);
    return created;
  }
  const principal = getRequestPrincipal();
  if (!isLocalPrincipal(principal)) {
    const key = principal.tenantId;
    const existing = scopedInstances.get(key);
    if (existing) return existing;
    const scoped = new WorkflowTemplateStore(resolveTenantDbPath(principal));
    scopedInstances.set(key, scoped);
    // 删租户 / 退出时释放句柄并摘除缓存（否则 Windows 上 tenants/<t> 删不掉）
    registerScopedResource(principalKeyOf(principal), () => {
      scoped.close();
      scopedInstances.delete(key);
    });
    return scoped;
  }
  if (!instance) {
    instance = new WorkflowTemplateStore(dbPath);
  }
  return instance;
}

/** 仅测试：关掉并清空租户级实例缓存（**生产不调用**） */
export function resetWorkflowTemplateStoreScopedForTest(): void {
  for (const store of scopedInstances.values()) {
    store.close();
  }
  scopedInstances.clear();
}
