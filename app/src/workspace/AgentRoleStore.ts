/**
 * Agent 角色配置存储
 *
 * 提供 agent_roles 数据库表的 CRUD 操作。
 * 该表存储理事会所需的专家 Agent 角色配置，
 * 支持前端管理页面进行增删改查。
 */
import { randomUUID } from 'node:crypto';
import { Database } from '@modules/core/external/sqlite3';
import { Logger, LogLevel } from '@modules/monitoring';
import { resolveDbPath } from '@modules/core';

const logger = new Logger({ level: LogLevel.INFO, module: 'AgentRoleStore' });

/** agent_roles 表名 */
export const AGENT_ROLES_TABLE = 'agent_roles';

/** Agent 角色配置数据行 */
export interface AgentRoleRow {
  /** 唯一标识 */
  id: string;
  /** Agent 标识（如 "architect"、"security"），用于代码引用 */
  agent_id: string;
  /** 显示名称 */
  name: string;
  /** 专业领域列表（JSON 数组字符串） */
  expertise: string;
  /** 辩论权重 */
  weight: number;
  /** System prompt 模板 */
  system_prompt: string;
  /** 图标 emoji */
  icon: string;
  /** 排序序号 */
  sort_order: number;
  /** 是否启用 */
  enabled: number;
  /** 创建时间 */
  created_at: number;
  /** 更新时间 */
  updated_at: number;
}

/** Agent 角色配置（业务层使用） */
export interface AgentRoleConfig {
  id?: string;
  agentId: string;
  name: string;
  expertise: string[];
  weight: number;
  systemPrompt: string;
  icon: string;
  sortOrder: number;
  enabled: boolean;
}

/**
 * 将数据行转为业务对象
 */
function rowToConfig(row: AgentRoleRow): AgentRoleConfig {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    expertise: JSON.parse(row.expertise || '[]'),
    weight: row.weight,
    systemPrompt: row.system_prompt,
    icon: row.icon,
    sortOrder: row.sort_order,
    enabled: row.enabled === 1,
  };
}

/**
 * Agent 角色配置存储库
 *
 * 基于 SQLite，遵循项目现有 CostRecordRepository 模式。
 */
export class AgentRoleStore {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  /** 初始化数据库连接和表结构 */
  async init(): Promise<void> {
    if (this.db) {
      return;
    }

    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve(db);
        }
      });
    });

    await this.createTables();
    await this.seedDefaults();
  }

  /** 创建表结构 */
  private async createTables(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `
        CREATE TABLE IF NOT EXISTS ${AGENT_ROLES_TABLE} (
          id          TEXT PRIMARY KEY,
          agent_id    TEXT NOT NULL UNIQUE,
          name        TEXT NOT NULL,
          expertise   TEXT NOT NULL DEFAULT '[]',
          weight      REAL NOT NULL DEFAULT 1.0,
          system_prompt TEXT NOT NULL DEFAULT '',
          icon        TEXT NOT NULL DEFAULT '🤖',
          sort_order  INTEGER NOT NULL DEFAULT 0,
          enabled     INTEGER NOT NULL DEFAULT 1,
          created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
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
  }

  /** 首次初始化时写入默认 5 个专家角色 */
  private async seedDefaults(): Promise<void> {
    const count = await this.count();
    if (count > 0) {
      return;
    }

    const defaults: AgentRoleConfig[] = [
      {
        agentId: 'architect',
        name: '架构师',
        expertise: ['系统架构', '模块设计', '扩展性'],
        weight: 1.0,
        systemPrompt: `你是一位资深系统架构师，专长于系统架构设计、模块拆分和扩展性规划。
在辩论中，请从架构层面分析问题，关注：
- 模块边界划分和职责分离
- 接口契约设计和依赖方向
- 扩展性和可维护性
- 长远技术演进路径`,
        icon: '🏗️',
        sortOrder: 1,
        enabled: true,
      },
      {
        agentId: 'security',
        name: '安全专家',
        expertise: ['安全漏洞', '权限控制', '数据保护'],
        weight: 1.0,
        systemPrompt: `你是一位资深安全专家，专长于安全漏洞防御、权限控制和数据保护。
在辩论中，请从安全层面分析问题，关注：
- 潜在的安全漏洞和攻击面
- 认证授权方案（OAuth2、JWT 等）
- 数据加密和隐私保护
- 合规性要求`,
        icon: '🔒',
        sortOrder: 2,
        enabled: true,
      },
      {
        agentId: 'performance',
        name: '性能专家',
        expertise: ['性能优化', '资源占用', '并发处理'],
        weight: 1.0,
        systemPrompt: `你是一位资深性能优化专家，专长于性能调优、资源管理和并发处理。
在辩论中，请从性能层面分析问题，关注：
- 缓存策略和资源优化
- 数据库索引和查询优化
- 并发处理和线程安全
- 资源占用和响应延迟`,
        icon: '⚡',
        sortOrder: 3,
        enabled: true,
      },
      {
        agentId: 'frontend',
        name: '前端专家',
        expertise: ['UI/UX', '组件设计', '用户体验'],
        weight: 0.8,
        systemPrompt: `你是一位资深前端专家，专长于 UI/UX 设计、组件架构和用户体验。
在辩论中，请从前端层面分析问题，关注：
- 组件设计和状态管理
- 响应式布局和用户体验
- 前端性能优化（懒加载、代码分割）
- 可访问性和国际化`,
        icon: '🎨',
        sortOrder: 4,
        enabled: true,
      },
      {
        agentId: 'backend',
        name: '后端专家',
        expertise: ['API 设计', '数据存储', '服务编排'],
        weight: 1.0,
        systemPrompt: `你是一位资深后端专家，专长于 API 设计、数据存储和服务编排。
在辩论中，请从后端层面分析问题，关注：
- RESTful API 和微服务设计
- 数据库选型和数据建模
- 消息队列和异步处理
- 服务发现和负载均衡`,
        icon: '⚙️',
        sortOrder: 5,
        enabled: true,
      },
    ];

    for (const agent of defaults) {
      await this.insert(agent);
    }
    logger.info('已写入默认 5 个专家 Agent 角色', { count: defaults.length });
  }

  /** 查询已启用角色数量 */
  private async count(): Promise<number> {
    if (!this.db) {
      return 0;
    }
    return await new Promise<number>((resolve, reject) => {
      this.db!.get(
        `SELECT COUNT(*) AS cnt FROM ${AGENT_ROLES_TABLE} WHERE enabled = 1`,
        (err: Error | null, row: { cnt: number } | undefined) => {
          if (err) {
            reject(err);
          } else {
            resolve(row?.cnt ?? 0);
          }
        }
      );
    });
  }

  /** 插入一条 Agent 角色 */
  async insert(config: AgentRoleConfig): Promise<string> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const id = config.id || randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `
        INSERT INTO ${AGENT_ROLES_TABLE}
          (id, agent_id, name, expertise, weight, system_prompt, icon, sort_order, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          id,
          config.agentId,
          config.name,
          JSON.stringify(config.expertise),
          config.weight,
          config.systemPrompt,
          config.icon,
          config.sortOrder,
          config.enabled ? 1 : 0,
          now,
          now,
        ],
        (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
    return id;
  }

  /** 更新一条 Agent 角色 */
  async update(id: string, config: Partial<AgentRoleConfig>): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const now = Math.floor(Date.now() / 1000);
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (config.agentId !== undefined) {
      sets.push('agent_id = ?');
      params.push(config.agentId);
    }
    if (config.name !== undefined) {
      sets.push('name = ?');
      params.push(config.name);
    }
    if (config.expertise !== undefined) {
      sets.push('expertise = ?');
      params.push(JSON.stringify(config.expertise));
    }
    if (config.weight !== undefined) {
      sets.push('weight = ?');
      params.push(config.weight);
    }
    if (config.systemPrompt !== undefined) {
      sets.push('system_prompt = ?');
      params.push(config.systemPrompt);
    }
    if (config.icon !== undefined) {
      sets.push('icon = ?');
      params.push(config.icon);
    }
    if (config.sortOrder !== undefined) {
      sets.push('sort_order = ?');
      params.push(config.sortOrder);
    }
    if (config.enabled !== undefined) {
      sets.push('enabled = ?');
      params.push(config.enabled ? 1 : 0);
    }

    params.push(id);

    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `UPDATE ${AGENT_ROLES_TABLE} SET ${sets.join(', ')} WHERE id = ?`,
        params,
        (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /** 删除一条 Agent 角色 */
  async delete(id: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    await new Promise<void>((resolve, reject) => {
      this.db!.run(
        `DELETE FROM ${AGENT_ROLES_TABLE} WHERE id = ?`,
        [id],
        (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /** 查询所有 Agent 角色（按 sort_order 排序） */
  async listAll(): Promise<AgentRoleConfig[]> {
    if (!this.db) {
      return [];
    }
    return await new Promise<AgentRoleConfig[]>((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${AGENT_ROLES_TABLE} ORDER BY sort_order ASC`,
        (err: Error | null, rows: AgentRoleRow[]) => {
          if (err) {
            reject(err);
          } else {
            resolve((rows || []).map(rowToConfig));
          }
        }
      );
    });
  }

  /** 查询已启用的 Agent 角色 */
  async listEnabled(): Promise<AgentRoleConfig[]> {
    if (!this.db) {
      return [];
    }
    return await new Promise<AgentRoleConfig[]>((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${AGENT_ROLES_TABLE} WHERE enabled = 1 ORDER BY sort_order ASC`,
        (err: Error | null, rows: AgentRoleRow[]) => {
          if (err) {
            reject(err);
          } else {
            resolve((rows || []).map(rowToConfig));
          }
        }
      );
    });
  }

  /** 根据 agent_id 查询单条 */
  async getByAgentId(agentId: string): Promise<AgentRoleConfig | null> {
    if (!this.db) {
      return null;
    }
    return await new Promise<AgentRoleConfig | null>((resolve, reject) => {
      this.db!.get(
        `SELECT * FROM ${AGENT_ROLES_TABLE} WHERE agent_id = ?`,
        [agentId],
        (err: Error | null, row: AgentRoleRow | undefined) => {
          if (err) {
            reject(err);
          } else {
            resolve(row ? rowToConfig(row) : null);
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
    }
  }
}

/** 全局单例 */
let instance: AgentRoleStore | null = null;

/**
 * 获取 AgentRoleStore 单例
 */
export function getAgentRoleStore(): AgentRoleStore {
  if (!instance) {
    instance = new AgentRoleStore();
    instance.init().catch((err) => {
      logger.error('AgentRoleStore 初始化失败', { error: String(err) });
    });
  }
  return instance;
}
