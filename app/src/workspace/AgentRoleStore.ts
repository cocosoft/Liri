/**
 * Agent 角色配置存储
 *
 * 提供 agent_roles 数据库表的 CRUD 操作。
 * 该表存储理事会所需的专家 Agent 角色配置，
 * 支持前端管理页面进行增删改查。
 */
import { randomUUID } from 'crypto';
import { Database } from '@modules/core/external/sqlite3';
import { getLogger } from '@modules/monitoring';
import { resolveDbPath } from '@modules/core';

const logger = getLogger('AgentRoleStore');

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
  /** 推荐模型（O11-2：可空 —— 空表示沿用调用方/任务分工的默认模型） */
  model: string | null;
  /** T9：能否再委派子代理（0/1；缺省 0 = 不可委派） */
  can_delegate: number;
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
  /** 推荐模型（O11-2）：非空时子代理按此模型执行；空则沿用默认/任务分工 */
  model?: string;
  /**
   * T9：该角色**能否再委派子代理**（策略位，由用户在「Agent 角色」页设置）。
   *
   * 语义：**缺省/false = 不可委派**（fail-closed）。即使为 true，仍受父侧
   * `MAX_SUBAGENT_DEPTH` 深度上限约束（双判据）—— 模型**不能**通过 `subagent_type`
   * 自选该授权（它只能选择用户已授权的角色）。
   */
  canDelegate?: boolean;
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
    model: row.model ?? undefined,
    canDelegate: row.can_delegate === 1,
    icon: row.icon,
    sortOrder: row.sort_order,
    enabled: row.enabled === 1,
  };
}

/**
 * Agent 角色配置存储库
 *
 * 基于 SQLite，遵循项目现有 CostRecordRepository 模式。
 *
 * **所有权（T1 复核修正）**：`agent_roles` 是 Liri **全局 Agent 角色的单一数据源**，
 * 两个消费者共用同一份配置 ——
 * ① 理事会辩论（`CouncilOrchestrator`，取启用集）；② 子代理描述符解析链
 * （`AgentTool` 的 `subagent_type`，取单条并区分"被禁用 / 不存在"）。
 * ⚠ 原文写"该表存储**理事会**所需的专家 Agent 角色配置"与事实不符（子代理链路已在生产中读它），
 * 该表述是"命名/职责漂移"的源头（设计文档 A2/R1）。
 *
 * **`agent_id` 大小写契约（O16）**：写入（`insert` / `update`）与按 agentId 查询
 * （`getByAgentId`）两侧统一 `trim().toLowerCase()` —— 表列 `agent_id` 为
 * `TEXT NOT NULL UNIQUE`（**无** `COLLATE NOCASE`，SQLite 默认 BINARY 比较），
 * 若不归一，用户在管理页填 `CodeReview`、模型传 `codereview` 会**必然查不到**
 * （当前 5 个默认角色恰好全小写，掩盖了该洞）。
 * 归一化**收敛在本类内** ⇒ 调用方（HTTP 层 / 解析链）无需自行处理大小写。
 */
export class AgentRoleStore {
  private db: Database | null = null;

  /** O16：`agent_id` 归一化 —— 写入与查询的**唯一入口** */
  private static normalizeAgentId(agentId: string): string {
    return agentId.trim().toLowerCase();
  }

  private dbPath: string;
  /** 进行中的初始化（O11：并发调用共享，避免重复打开连接） */
  private initPromise: Promise<void> | null = null;

  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  /**
   * 初始化数据库连接和表结构。
   *
   * **幂等 + 并发安全**（O11）：`getAgentRoleStore()` 创建单例时会 fire-and-forget 调一次
   * `init()`；子代理描述符解析链随后 `await init()` —— 二者并发时旧实现会**重复打开连接**。
   * 现用单一 Promise 共享同一次初始化。
   */
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

    await this.createTables();
    await this.ensureColumns();
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
          model       TEXT,
          can_delegate INTEGER NOT NULL DEFAULT 0,
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

  /**
   * 逐列补齐既有库的缺失列（O11-2，与 O6③ 同法：**幂等 DDL**）。
   *
   * 老库（本列新增前创建）不会因 `CREATE TABLE IF NOT EXISTS` 得到新列，
   * 故以 `PRAGMA table_info` 探测后 `ALTER TABLE ADD COLUMN` 逐列补齐；
   * 仅**新增字段**，不改动/删除任何既有结构。
   */
  private async ensureColumns(): Promise<void> {
    if (!this.db) {
      return;
    }
    const columns = await new Promise<string[]>((resolve, reject) => {
      this.db!.all(
        `PRAGMA table_info(${AGENT_ROLES_TABLE})`,
        (err: Error | null, rows: Array<{ name: string }> | undefined) => {
          if (err) {
            reject(err);
          } else {
            resolve((rows || []).map((r) => r.name));
          }
        }
      );
    }).catch((err: unknown) => {
      logger.error('AgentRoleStore 读取表结构失败', { error: String(err) });
      return [] as string[];
    });

    if (columns.length > 0 && !columns.includes('model')) {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `ALTER TABLE ${AGENT_ROLES_TABLE} ADD COLUMN model TEXT`,
          (err: Error | null) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
      logger.info('AgentRoleStore 已补齐 model 列', {
        table: AGENT_ROLES_TABLE,
      });
    }

    // T9：角色级"能否再委派子代理"策略位（默认 0 = 不可委派，fail-closed）
    if (columns.length > 0 && !columns.includes('can_delegate')) {
      await new Promise<void>((resolve, reject) => {
        this.db!.run(
          `ALTER TABLE ${AGENT_ROLES_TABLE} ADD COLUMN can_delegate INTEGER NOT NULL DEFAULT 0`,
          (err: Error | null) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
      logger.info('AgentRoleStore 已补齐 can_delegate 列', {
        table: AGENT_ROLES_TABLE,
      });
    }
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

  /**
   * 统计**表内全部**角色行数（O11-2：用于 `seedDefaults` 的"是否已播种"判定）。
   *
   * ⚠ 语义校正：原实现为 `WHERE enabled = 1` ⇒ 用户把 5 个默认角色**全部禁用**后重启，
   * 计数归 0 ⇒ 重新播种 ⇒ 撞 `agent_id UNIQUE` 冲突（`INSERT` 报错被
   * `getAgentRoleStore()` 的 `.catch()` 吞掉，仅表现为启动日志一条 error）。
   * 播种的存在性判据应是"表是否为空"，与启用位无关。
   */
  private async count(): Promise<number> {
    if (!this.db) {
      return 0;
    }
    return await new Promise<number>((resolve, reject) => {
      this.db!.get(
        `SELECT COUNT(*) AS cnt FROM ${AGENT_ROLES_TABLE}`,
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
          (id, agent_id, name, expertise, weight, system_prompt, model, can_delegate, icon, sort_order, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          id,
          // O16：写入侧归一（查询侧同源，见 getByAgentId）
          AgentRoleStore.normalizeAgentId(config.agentId),
          config.name,
          JSON.stringify(config.expertise),
          config.weight,
          config.systemPrompt,
          config.model ?? null,
          // T9：缺省 0 = 不可委派（fail-closed）
          config.canDelegate ? 1 : 0,
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
      // O16：改 agentId 也是写入 ⇒ 同一归一化
      params.push(AgentRoleStore.normalizeAgentId(config.agentId));
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
    if (config.model !== undefined) {
      sets.push('model = ?');
      params.push(config.model);
    }
    if (config.canDelegate !== undefined) {
      // T9：策略位（显式提交才改；缺省保持原值）
      sets.push('can_delegate = ?');
      params.push(config.canDelegate ? 1 : 0);
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

  /**
   * 查询已启用的 Agent 角色。
   *
   * ⚠ 解析契约（O11-1）：`enabled = 0` 的角色**不出现**在本结果中，
   * 且子代理描述符解析遇到 disabled 角色时**判为解析失败**（显式拒绝），
   * **不得**回退默认提示词 —— "被禁用"与"不存在"必须让调用方能区分。
   *
   * （T7：启用判定的**单一实现**见 `resolveForDelegation()`；本方法在 SQL 侧过滤，
   *  属同一规则的"集合形态"，两处语义须一致。）
   */
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

  /**
   * 根据 agent_id 查询单条（O16：查询侧归一，与写入侧同源 ⇒ 大小写不敏感）
   *
   * ⚠ 解析链请用 [`resolveForDelegation`] —— 它把"启用判定"一并收敛，避免调用方自建第二份判定（T7）。
   */
  async getByAgentId(agentId: string): Promise<AgentRoleConfig | null> {
    if (!this.db) {
      return null;
    }
    return await new Promise<AgentRoleConfig | null>((resolve, reject) => {
      this.db!.get(
        `SELECT * FROM ${AGENT_ROLES_TABLE} WHERE agent_id = ?`,
        [AgentRoleStore.normalizeAgentId(agentId)],
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

  /**
   * T7：**解析链专用取数（三态）** —— 让"启用判定"在存储层成为**单一实现**。
   *
   * 为何不返回"角色 + 让调用方读 `enabled`"：那样"什么算启用"的规则会出现两份
   * （本类 `listEnabled()` 的 SQL 侧 + 解析链的内存侧），语义漂移时两边结论会不一致
   * （设计文档 A6/T7：双消费者分叉）。
   *
   * 三态的必要性（O11-1）：`disabled` 与 `missing` 必须可分辨 —— 前者文案是"已被禁用"、
   * 后者是"未知类型并给出可用名单"，且**都不得**静默回退默认提示词。
   */
  async resolveForDelegation(
    agentId: string
  ): Promise<
    | { state: 'ok'; role: AgentRoleConfig }
    | { state: 'disabled' }
    | { state: 'missing' }
  > {
    const role = await this.getByAgentId(agentId);
    if (!role) return { state: 'missing' };
    if (!AgentRoleStore.isEnabled(role)) return { state: 'disabled' };
    return { state: 'ok', role };
  }

  /**
   * 单一启用判定（T7）。
   *
   * `listEnabled()` 的 `WHERE enabled = 1` 与解析链的三态判定**语义同源**（同一列、同一规则），
   * 只是读法不同（集合 vs 单条）；此谓词是"内存侧"的唯一实现，SQL 侧须与它保持一致。
   */
  private static isEnabled(role: AgentRoleConfig): boolean {
    return role.enabled;
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
