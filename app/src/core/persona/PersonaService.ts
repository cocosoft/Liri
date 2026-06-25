/**
 * PersonaService — 人设绑定关系持久化服务
 *
 * 管理 Agent 与 TTS 人设之间的绑定关系，提供 SQLite 持久化存储。
 *
 * 数据库迁移说明（2026-06-25）：
 *   新增 persona_bindings 表，记录 Agent 与人设的 N:1 绑定关系。
 *   该表通过 CREATE TABLE IF NOT EXISTS 自动创建，无需手工迁移。
 *
 * 与 TTSPersonaManager 的关系：
 *   - TTSPersonaManager 管理内存中的人设 CRUD 和绑定关系
 *   - PersonaService 提供可选的持久化层，将绑定关系写入数据库
 *   - 应用启动时可通过 loadBindings() 从 DB 恢复绑定到内存
 */

import { Database } from '@modules/core/external/sqlite3';
import { resolveDbPath } from '@modules/core';
import { SimpleMutex } from '@modules/core';
import { Logger, LogLevel } from '@modules/monitoring';
import type { PersonaBinding, CreatePersonaBindingInput } from './types';

const logger = new Logger({ level: LogLevel.INFO });

/** 数据库表名 */
const TABLE = 'persona_bindings';

/**
 * 人设绑定持久化服务
 */
export class PersonaService {
  private db: Database | null = null;
  private dbPath: string;
  private mutex = new SimpleMutex();

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? resolveDbPath();
  }

  /**
   * 初始化数据库连接并创建表
   */
  async init(): Promise<void> {
    if (this.db) return;

    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath!, (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });

    await this.createTable();
    logger.info('PersonaService · 初始化完成', { dbPath: this.dbPath });
  }

  /**
   * 创建 persona_bindings 表
   */
  private async createTable(): Promise<void> {
    if (!this.db) throw new Error('数据库未初始化');

    await new Promise<void>((resolve, reject) => {
      this.db!.exec(
        `
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT NOT NULL,
          persona_id TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
          UNIQUE(agent_id)
        );

        CREATE INDEX IF NOT EXISTS idx_persona_bindings_agent_id
          ON ${TABLE}(agent_id);

        CREATE INDEX IF NOT EXISTS idx_persona_bindings_persona_id
          ON ${TABLE}(persona_id);
        `,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    logger.info('PersonaService · 数据库表已就绪', { table: TABLE });
  }

  /**
   * 绑定 Agent 到人设
   *
   * 同一 Agent 只能绑定一个人设，新绑定会覆盖旧绑定。
   *
   * @returns 是否成功（false 一般不会发生，因为使用 INSERT OR REPLACE）
   */
  async bindAgent(agentId: string, personaId: string): Promise<boolean> {
    await this.init();
    if (!this.db) throw new Error('数据库未初始化');

    return this.mutex.run(async () => {
      await new Promise<void>((resolve, reject) => {
        const now = Math.floor(Date.now() / 1000);
        this.db!.run(
          `INSERT OR REPLACE INTO ${TABLE}
           (agent_id, persona_id, created_at, updated_at)
           VALUES (
             ?,
             ?,
             COALESCE((SELECT created_at FROM ${TABLE} WHERE agent_id = ?), ?),
             ?
           )`,
          [agentId, personaId, agentId, now, now],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      logger.info('PersonaService · Agent 绑定人设', { agentId, personaId });
      return true;
    });
  }

  /**
   * 解除 Agent 的人设绑定
   */
  async unbindAgent(agentId: string): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('数据库未初始化');

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${TABLE} WHERE agent_id = ?`,
        [agentId],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    logger.info('PersonaService · Agent 解除人设绑定', { agentId });
  }

  /**
   * 获取 Agent 绑定的人设 ID
   */
  async getPersonaIdForAgent(agentId: string): Promise<string | null> {
    await this.init();
    if (!this.db) throw new Error('数据库未初始化');

    const row = await new Promise<any>((resolve, reject) => {
      this.db!.get(
        `SELECT persona_id FROM ${TABLE} WHERE agent_id = ?`,
        [agentId],
        (err: Error | null, row: any) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    return row?.persona_id ?? null;
  }

  /**
   * 列出所有绑定关系
   */
  async listBindings(): Promise<PersonaBinding[]> {
    await this.init();
    if (!this.db) throw new Error('数据库未初始化');

    const rows = await new Promise<any[]>((resolve, reject) => {
      this.db!.all(
        `SELECT id, agent_id, persona_id, created_at, updated_at
         FROM ${TABLE}
         ORDER BY created_at DESC`,
        (err: Error | null, rows: any[]) => {
          if (err) reject(err);
          else resolve(rows ?? []);
        }
      );
    });

    return rows.map(this.rowToBinding);
  }

  /**
   * 获取人设的所有绑定 Agent 列表
   */
  async getAgentBindings(personaId: string): Promise<string[]> {
    await this.init();
    if (!this.db) throw new Error('数据库未初始化');

    const rows = await new Promise<any[]>((resolve, reject) => {
      this.db!.all(
        `SELECT agent_id FROM ${TABLE} WHERE persona_id = ?`,
        [personaId],
        (err: Error | null, rows: any[]) => {
          if (err) reject(err);
          else resolve(rows ?? []);
        }
      );
    });

    return rows.map((r) => r.agent_id);
  }

  /**
   * 获取绑定总数
   */
  async count(): Promise<number> {
    await this.init();
    if (!this.db) throw new Error('数据库未初始化');

    const row = await new Promise<any>((resolve, reject) => {
      this.db!.get(
        `SELECT COUNT(*) as cnt FROM ${TABLE}`,
        (err: Error | null, row: any) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    return row?.cnt ?? 0;
  }

  /**
   * 将数据库行转换为 PersonaBinding 对象
   */
  private rowToBinding(row: any): PersonaBinding {
    return {
      id: row.id,
      agentId: row.agent_id,
      personaId: row.persona_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (!this.db) return;

    await new Promise<void>((resolve, reject) => {
      this.db!.close((err: Error | null) => {
        if (err) reject(err);
        else {
          this.db = null;
          resolve();
        }
      });
    });

    logger.info('PersonaService · 数据库连接已关闭');
  }
}
