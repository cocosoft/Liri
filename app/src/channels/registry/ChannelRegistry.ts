/**
 * ChannelRegistry 通道注册中心
 *
 * 统一通道注册代理，注册 IChannelPlugin / ChannelInterface 并提供
 * ChannelInterface 视图与 DB 持久化（channel_configs 表）。
 *
 * 2026-08-06（4.9/P1-6）：移除 core/gateway（ChannelPluginRegistry）桥接层依赖，
 * 双轨适配分支（adaptPluginToChannelInterface / setupActiveSync）已删除。
 *
 * 持久化：通过 channel_configs 表将配置（name/enabled/options）存入 app.db，
 * 重启后自动恢复。
 */

import { EventEmitter } from 'events';
import { Database } from '@modules/external';
import { resolveDbPath } from '@modules/environment';
// 多租户 P3：通道配置/凭据按归属（租户）映射（本地身份 ⇒ 空键，零变更）
import { currentOwnerKey } from '@openliri/kernel/identity/requestScope';
import type {
  ChannelCapabilities,
  ChannelMeta,
  IChannelPlugin,
} from '../types/IChannel';
import { channelEventBus, ChannelEvents } from '../events/ChannelEventBus';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
// 2026-10-01 D-205（子批 D，`channels -> context` 倒挂收口）：`DependencyRegistry` 早在
// **D-157 即已下沉 core**（`core/DependencyRegistry.ts`，`context/` 仅为转出层）⇒ 原
// `@modules/context`（app 层）取用属倒挂。改**相对直连 core 模块根**
// （同 D-157 先例 `permission/intercept/PermissionInterceptor.ts:40`；`core` 根文件不触发 R03-002）。
import { dependencyRegistry } from '@openliri/kernel/DependencyRegistry.js';
// B-4（2026-10-18）：凭据来源改为**显式注入**（默认实现见 `defaultSecretResolver`）。
// 静态 import 合法：`ChannelSecretStore` 不反向 import 本文件（它经 `initRegistry()` 取注册表）。
import { ChannelSecretStore } from '../secrets/ChannelSecretStore';

const logger = getLogger('channels:registry');

/**
 * 通道出站适配器接口
 * 用于 DeliveryRouter._sendWithFallback 的统一发送入口
 */
export interface ChannelOutbound {
  sendText(target: string, content: string): Promise<boolean>;
  sendMarkdown?(target: string, content: string): Promise<boolean>;
  sendInteractive?(
    target: string,
    content: string,
    card: Record<string, unknown>
  ): Promise<boolean>;
}

/**
 * 通道接口 —— **统一视图**（B-2，2026-10-18）
 *
 * 治理层（`ChannelRegistry`）只向上返回本视图：`IChannelPlugin` 经
 * {@link adaptPluginToInterface} **一次投影**得到，`capabilities` / `meta` 在投影时
 * **一次性带出**（唯一事实源仍是 `IChannelPlugin`，本处不复制、不派生）。
 *
 * @deprecated 过渡接口（B-2 下线计划）：legacy 直注册路径保留至 **v0.5.0（不晚于
 * 2026-12-31）**；到期后 `register()` 只接受 `IChannelPlugin`。见
 * `dev_docs/20261018/待修复任务清单-20261018.md` B-2。
 */
export interface ChannelInterface {
  name: string;
  type: string;
  enabled: boolean;
  connected: boolean;

  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  sendMessage(target: string, text: string): Promise<boolean>;
  getStatus(): Record<string, unknown>;
  /** 真实健康探测（插件适配层透传 lifecycle.healthCheck；legacy 直注册通道无此方法） */
  healthCheck?(): Promise<{ healthy: boolean; latencyMs: number }>;

  homeChannelId?: string;
  supportsThreads?: boolean;
  sendThreadMessage?(
    target: string,
    threadId: string,
    text: string
  ): Promise<boolean>;

  /**
   * 通道**声明能力**（B-2：投影自 `IChannelPlugin.capabilities`，**只读**）。
   *
   * 消费方（如 `DeliveryRouter._formatSupport`）只读本字段 —— 不再穿透
   * `plugin.capabilities`（那曾是第二处需同步维护的位置）。
   */
  capabilities?: ChannelCapabilities;
  /**
   * 通道**元信息**（B-2：投影自 `IChannelPlugin.meta`，**只读**）。
   *
   * 消费方只读本字段（如 `meta.markdownCapable`），不再穿透 `plugin.meta`。
   */
  meta?: ChannelMeta;

  /** 出站适配（`DeliveryRouter` 统一发送入口） */
  plugin?: {
    outbound: ChannelOutbound;
  };
}

/**
 * 凭据解析器（B-4，2026-10-18）—— **显式注入**，替代适配器内的动态 import。
 *
 * 默认实现 = `ChannelSecretStore.getInstance().get()`（DB 优先、`.env` 兜底）；
 * 测试 / 多租户场景可注入替身（`new ChannelRegistry({ secretResolver })`）。
 */
export type ChannelSecretResolver = (
  channelId: string
) => Record<string, unknown>;

/** 默认凭据解析器（唯一事实源 = `ChannelSecretStore`） */
const defaultSecretResolver: ChannelSecretResolver = (channelId) =>
  ChannelSecretStore.getInstance().get(channelId);

/** `ChannelRegistry` 构造选项（B-4：`dbPath` 与 `secretResolver` 均显式注入） */
export interface ChannelRegistryOptions {
  dbPath?: string;
  secretResolver?: ChannelSecretResolver;
}

/**
 * 将 `IChannelPlugin` **投影**为统一视图 `ChannelInterface`（B-2）。
 *
 * - `capabilities` / `meta` 一次性带出到**顶层**（消费方只读顶层，不再穿透 `plugin.*`）；
 * - `connect` 的凭据来源由 `resolveCredentials` **注入**（B-4，缺省 = `ChannelSecretStore`）。
 *
 * @param enabledOverride 持久化的 enabled 状态（P1-1：DB 配置为准，缺省视为启用）
 * @param resolveCredentials 凭据解析器（缺省 = `defaultSecretResolver`）
 */
export function adaptPluginToInterface(
  plugin: IChannelPlugin,
  enabledOverride?: boolean,
  resolveCredentials: ChannelSecretResolver = defaultSecretResolver
): ChannelInterface {
  return {
    name: plugin.id,
    type: plugin.id,
    enabled: enabledOverride ?? true,
    get connected() {
      return plugin.lifecycle.getStatus().connected;
    },
    get homeChannelId() {
      return (plugin as unknown as Record<string, string | undefined>)
        .homeChannelId;
    },
    connect: async () => {
      // B-4：凭据来源走注入的解析器（默认 = ChannelSecretStore；DB 优先、.env 兜底）
      const credentials = resolveCredentials(plugin.id);
      await plugin.lifecycle.connect(credentials);
      return plugin.lifecycle.getStatus().connected;
    },
    disconnect: async () => {
      await plugin.lifecycle.disconnect();
    },
    sendMessage: async (_target: string, text: string) => {
      const result = await plugin.outbound.sendText(_target, text);
      return result.success;
    },
    getStatus: () => ({
      ...plugin.lifecycle.getStatus(),
      type: plugin.id,
    }),
    healthCheck: async () => plugin.lifecycle.healthCheck(),
    // B-2：能力位/元信息在**投影处一次性带出**（唯一事实源 = `IChannelPlugin`，本处不复制、不派生）
    capabilities: plugin.capabilities,
    meta: plugin.meta,
    plugin: {
      outbound: {
        sendText: async (target: string, content: string) => {
          const result = await plugin.outbound.sendText(target, content);
          return result.success;
        },
        ...(typeof (plugin.outbound as unknown as Record<string, unknown>)
          .sendMarkdown === 'function'
          ? {
              sendMarkdown: async (target: string, content: string) => {
                const result = (await (
                  plugin.outbound as unknown as Record<string, Function>
                ).sendMarkdown(target, content)) as { success: boolean };
                return result.success;
              },
            }
          : {}),
        ...(typeof (plugin.outbound as unknown as Record<string, unknown>)
          .sendInteractive === 'function'
          ? {
              sendInteractive: async (
                target: string,
                content: string,
                card: Record<string, unknown>
              ) => {
                const result = (await (
                  plugin.outbound as unknown as Record<string, Function>
                ).sendInteractive(target, content, card)) as {
                  success: boolean;
                };
                return result.success;
              },
            }
          : {}),
      },
    },
  };
}

/**
 * 通道配置
 */
export interface ChannelConfig {
  name: string;
  type: string;
  enabled: boolean;
  options: Record<string, unknown>;
  /**
   * 归属键（多租户 P3：`<tenantId>:<userId>`）。
   *
   * 缺省 ⇒ 本地/部署级配置（桌面、CLI、纯 .env 部署与改造前完全一致）。
   * 同一进程内 `(ownerKey, type)` 唯一 —— 不同租户可以各配一套同类型通道凭据。
   */
  ownerKey?: string;
}

/**
 * 通道消息
 */
export interface ChannelMessage {
  id: string;
  channel: string;
  type: string;
  content: string;
  sender: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * 通道注册中心
 * 统一注册 IChannelPlugin / ChannelInterface，DB 持久化由 channel_configs 表承载
 */
export class ChannelRegistry extends EventEmitter {
  private channels: Map<string, ChannelInterface> = new Map();
  private configs: Map<string, ChannelConfig> = new Map();

  // ─── 持久化 ────────────────────────────────────────────
  private db: Database | null = null;
  private readonly dbPath: string;
  /** B-4：凭据解析器（构造注入；测试 / 多租户可替换） */
  private readonly secretResolver: ChannelSecretResolver;
  private persistenceReady = false;

  constructor(
    dbPathOrOptions: string | ChannelRegistryOptions = resolveDbPath()
  ) {
    super();
    if (typeof dbPathOrOptions === 'string') {
      this.dbPath = dbPathOrOptions;
      this.secretResolver = defaultSecretResolver;
    } else {
      this.dbPath = dbPathOrOptions.dbPath ?? resolveDbPath();
      this.secretResolver =
        dbPathOrOptions.secretResolver ?? defaultSecretResolver;
    }
  }

  /**
   * 初始化持久化（异步，在应用启动时调用）
   * 创建表 + 加载已保存的配置
   */
  async initPersistence(): Promise<void> {
    if (this.persistenceReady) return;

    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });

    await this.createTable();
    // 多租户 P3：存量库补 owner_key 列（幂等；NULL ⇒ 本地/部署级配置）
    await this.migrateOwnerKeyColumn();
    await this.loadSavedConfigs();

    // 迁移：归一化通道名称为小写（消除大小写不一致导致的重复行）
    this.db!.run(
      `UPDATE channel_configs SET name = LOWER(name) WHERE name != LOWER(name)`
    );

    this.persistenceReady = true;
  }

  /**
   * 关闭持久化连接（一次性运维场景用，如删除租户；幂等）
   *
   * 内存配置一并清空 —— 调用方若还要继续用，需要重新 `initPersistence()`。
   */
  async close(): Promise<void> {
    if (!this.db) return;
    const db = this.db;
    this.db = null;
    this.persistenceReady = false;
    this.configs.clear();
    await new Promise<void>((resolve) => {
      db.close(() => resolve());
    });
  }

  /** 创建 channel_configs 表 */
  private createTable(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db!.run(
        `CREATE TABLE IF NOT EXISTS channel_configs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 0,
          options TEXT NOT NULL DEFAULT '{}',
          owner_key TEXT,
          updated_at INTEGER NOT NULL DEFAULT 0
        )`,
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });
  }

  /**
   * 多租户 P3：为存量库补 `owner_key` 列（幂等）。
   *
   * 存量行的 `owner_key` 为 `NULL` ⇒ 视为本地/部署级配置（与改造前逐字一致）。
   */
  private migrateOwnerKeyColumn(): Promise<void> {
    return new Promise((resolve) => {
      this.db!.all(
        'PRAGMA table_info(channel_configs)',
        (err: Error | null, rows: Array<{ name: string }>) => {
          if (err || !rows?.some((r) => r.name === 'owner_key')) {
            // 列已存在（旧库升级后）或探测失败 ⇒ 尝试 ALTER；已存在时报错也无害
            this.db!.run(
              'ALTER TABLE channel_configs ADD COLUMN owner_key TEXT',
              (alterErr: Error | null) => {
                if (alterErr && !/duplicate column/i.test(alterErr.message)) {
                  handleError(alterErr, {
                    module: 'channels:registry',
                    action: 'migrateOwnerKeyColumn',
                  });
                }
                resolve();
              }
            );
            return;
          }
          resolve();
        }
      );
    });
  }

  /** 配置在内存 map 中的键：`<ownerKey>::<type>`（本地 ⇒ `::<type>`） */
  private configMapKey(ownerKey: string, type: string): string {
    return `${ownerKey}::${type}`;
  }

  /** 配置行的主键：本地沿用 `type`（兼容存量行）；租户 ⇒ `<ownerKey>::<type>` */
  private configStorageId(ownerKey: string, type: string): string {
    return ownerKey ? `${ownerKey}::${type}` : type;
  }

  /** 当前请求身份的归属键（本地 / 无作用域 ⇒ `''`） */
  private currentOwner(): string {
    return currentOwnerKey() ?? '';
  }

  /** 从 DB 加载已保存的配置到内存 */
  private loadSavedConfigs(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db!.all(
        'SELECT id, name, type, enabled, options, owner_key FROM channel_configs',
        (
          err: Error | null,
          rows: Array<{
            id: string;
            name: string;
            type: string;
            enabled: number;
            options: string;
            owner_key?: string | null;
          }>
        ) => {
          if (err) {
            reject(err);
            return;
          }

          for (const row of rows) {
            let options: Record<string, unknown> = {};
            try {
              options = JSON.parse(row.options || '{}');
            } catch (err) {
              handleError(err, {
                module: 'channels:registry',
                action: 'loadSavedConfigs',
                context: { rowType: row.type, rowName: row.name },
              });
            }

            const ownerKey = row.owner_key ?? '';
            // 多租户 P3：内存键带上归属 ⇒ 同类型的租户配置与本地配置可并存
            const key = this.configMapKey(ownerKey, row.type || row.name);

            // 若因历史数据重复（同一 key 多行），保留含凭据的配置
            const existing = this.configs.get(key);
            if (
              existing &&
              Object.keys(existing.options).length > 0 &&
              Object.keys(options).length === 0
            ) {
              continue;
            }

            this.configs.set(key, {
              name: row.name,
              type: row.type || row.id,
              enabled: row.enabled === 1,
              options,
              ...(ownerKey ? { ownerKey } : {}),
            });
          }
          resolve();
        }
      );
    });
  }

  /** 持久化单条配置（UPSERT）— 返回 true 表示写入成功，false 表示写入失败 */
  private persistConfig(config: ChannelConfig): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (!this.db || !this.persistenceReady) {
        resolve(false);
        return;
      }
      const { type, name, enabled, options } = config;
      const ownerKey = config.ownerKey ?? '';
      const optionsJson = JSON.stringify(options || {});
      const id = this.configStorageId(ownerKey, type);

      this.db!.run(
        `INSERT INTO channel_configs (id, name, type, enabled, options, owner_key, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           type = excluded.type,
           enabled = excluded.enabled,
           options = excluded.options,
           owner_key = excluded.owner_key,
           updated_at = excluded.updated_at`,
        [
          id,
          name,
          type,
          enabled ? 1 : 0,
          optionsJson,
          ownerKey || null,
          Date.now(),
        ],
        (err: Error | null) => {
          if (err) {
            handleError(err, {
              module: 'channels:registry',
              action: `持久化通道配置失败: ${type}`,
              context: { config },
            });
            resolve(false);
          } else {
            resolve(true);
          }
        }
      );
    });
  }

  /** 从 DB 删除单条配置 — 返回 true 表示删除成功 */
  private deletePersistedConfig(id: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (!this.db || !this.persistenceReady) {
        resolve(false);
        return;
      }
      this.db!.run(
        'DELETE FROM channel_configs WHERE id = ?',
        [id],
        (err: Error | null) => {
          if (err) {
            handleError(err, {
              module: 'channels:registry',
              action: `删除持久化通道配置失败: ${id}`,
            });
            resolve(false);
          } else {
            resolve(true);
          }
        }
      );
    });
  }

  /** 同步当前的全部内存配置到 DB — 返回成功写入的数量 */
  private async syncAllToDb(): Promise<number> {
    if (!this.db || !this.persistenceReady) return 0;
    let successCount = 0;
    for (const config of this.configs.values()) {
      const ok = await this.persistConfig(config);
      if (ok) successCount++;
    }
    if (successCount < this.configs.size) {
      logger.warning(
        `同步配置到 DB 不完全: ${successCount}/${this.configs.size}`
      );
    }
    return successCount;
  }

  /**
   * 统一 key 解析（DEEP-10 修复 + 多租户 P3 身份感知）
   *
   * **只在当前身份的配置里查找**：先按 `<ownerKey>::<type>` 直取，再回退按 name / type 匹配
   * （前端可能传显示名）。本地身份（`ownerKey=''`）⇒ 与改造前等价，只是内存键多了 `::` 前缀。
   */
  private getConfigResolved(
    key: string,
    ownerKey = this.currentOwner()
  ): ChannelConfig | undefined {
    const direct = this.configs.get(this.configMapKey(ownerKey, key));
    if (direct) return direct;
    for (const config of this.configs.values()) {
      if ((config.ownerKey ?? '') !== ownerKey) continue;
      if (config.name === key || config.type === key) return config;
    }
    return undefined;
  }

  /**
   * 注册通道（支持 ChannelInterface 和 IChannelPlugin）
   * 内存更新始终成功；DB 持久化失败时记录警告但不阻止通道运行
   */
  register(channel: ChannelInterface | IChannelPlugin): void {
    let adapted: ChannelInterface;

    if ('lifecycle' in channel && 'outbound' in channel) {
      // B-4：把构造期注入的凭据解析器传给投影（不再由适配器内部动态 import）
      adapted = adaptPluginToInterface(
        channel as IChannelPlugin,
        undefined,
        this.secretResolver
      );
    } else {
      adapted = channel as ChannelInterface;
    }

    // P1-1：DB 持久化配置为准 — 已存在配置时用其 enabled 覆盖（前端禁用后重启不再连接）
    const persistedEnabled = this.getConfigResolved(adapted.name)?.enabled;
    if (persistedEnabled !== undefined) {
      adapted.enabled = persistedEnabled;
    }

    // 去重守卫：检查是否为重复注册（相同名称、相同类型）
    const existing = this.channels.get(adapted.name);
    const isDuplicate = existing && existing.type === adapted.type;

    this.channels.set(adapted.name, adapted);

    // 检查是否已有持久化的配置（从 DB 加载），有则保留，避免覆盖用户已保存的凭据
    const existingConfig = this.getConfigResolved(adapted.name);
    if (!existingConfig) {
      const owner = this.currentOwner();
      const config: ChannelConfig = {
        name: adapted.name,
        type: adapted.type,
        enabled: adapted.enabled,
        options: {},
        ...(owner ? { ownerKey: owner } : {}),
      };
      // 多租户 P3：内存键 `<ownerKey>::<type>`（本地身份 ⇒ `::<type>`）
      this.configs.set(this.configMapKey(owner, adapted.type), config);

      // 异步持久化（不阻塞调用者，失败时自动记录错误日志）
      this.persistConfig(config)
        .then((ok) => {
          if (!ok) {
            logger.warning(
              `注册通道 ${adapted.name}: 内存已更新但 DB 持久化失败`
            );
          }
        })
        .catch((err) => {
          logger.warning(`注册通道 ${adapted.name}: DB 持久化异常`, {
            error: String(err),
          });
        });
    }

    // 仅首次注册时发出事件，避免双重注册路径（ChannelManager + ChannelPluginRegistry 同步）产生重复事件
    if (!isDuplicate) {
      this.emit('channel:registered', {
        name: adapted.name,
        type: adapted.type,
      });
      channelEventBus.publish(ChannelEvents.CHANNEL_REGISTERED, {
        name: adapted.name,
        type: adapted.type,
      });
    }

    // T3.5（G1）：通道状态经 DependencyRegistry 广播，依赖者 inject/subscribe 感知（"等待而非报错"）
    dependencyRegistry.provide(`channel:${adapted.name}:status`, {
      connected: adapted.connected,
      type: adapted.type,
      registered: true,
    });
  }

  /**
   * 注销通道
   */
  unregister(name: string): boolean {
    const channel = this.channels.get(name);

    if (channel) {
      channel.disconnect();
      this.channels.delete(name);
      // 多租户 P3：删除**当前身份**的配置（本地身份 ⇒ 原 `type` 行，零变更）
      const config = this.getConfigResolved(name);
      const owner = config?.ownerKey ?? '';
      const type = config?.type ?? channel.type;
      this.configs.delete(this.configMapKey(owner, type));

      // 异步删除持久化配置（不阻塞调用者，失败时自动记录错误日志）
      this.deletePersistedConfig(this.configStorageId(owner, type))
        .then((deleted) => {
          if (!deleted) {
            logger.warning(`注销通道 ${name}: 内存已更新但 DB 删除失败`);
          }
        })
        .catch((err) => {
          logger.warning(`注销通道 ${name}: DB 删除异常`, {
            error: String(err),
          });
        });

      this.emit('channel:unregistered', { name });
      channelEventBus.publish(ChannelEvents.CHANNEL_UNREGISTERED, { name });

      // T3.5（G1）：注销 = 状态 withdraw（订阅方收到预停用通知）
      dependencyRegistry.withdraw(`channel:${name}:status`);

      return true;
    }

    return false;
  }

  /**
   * 多租户 P5：删除某**归属前缀**下的全部通道配置（删除租户时调用）
   *
   * 主键约定：租户行 `<ownerKey>::<type>`（`owner_key` 列非空），部署级行
   * `owner_key IS NULL`（主键沿用 `type`）**不受影响**。内存 map 同步移除。
   *
   * @returns 删除的持久化行数（未启用持久化 ⇒ 0，内存仍已清理）
   */
  async purgeOwnerPrefix(prefix: string): Promise<number> {
    if (!prefix) return 0;

    for (const key of [...this.configs.keys()]) {
      if (key.startsWith(prefix)) this.configs.delete(key);
    }

    if (!this.db || !this.persistenceReady) return 0;
    return new Promise<number>((resolve) => {
      this.db!.run(
        'DELETE FROM channel_configs WHERE owner_key LIKE ?',
        [`${prefix}%`],
        function (this: { changes?: number }, err: Error | null) {
          if (err) {
            handleError(err, {
              module: 'channels:registry',
              action: '按归属前缀删除通道配置失败',
            });
            resolve(0);
            return;
          }
          resolve(this.changes ?? 0);
        }
      );
    });
  }

  get(name: string): ChannelInterface | undefined {
    return this.channels.get(name);
  }

  /**
   * 获取所有通道
   */
  getAll(): ChannelInterface[] {
    return Array.from(this.channels.values());
  }

  /**
   * 获取所有已启用通道
   */
  getEnabled(): ChannelInterface[] {
    return this.getAll().filter((c) => c.enabled);
  }

  /**
   * 获取配置（支持 type 或 name 查询，DEEP-10 统一 key 解析）
   */
  getConfig(name: string): ChannelConfig | undefined {
    return this.getConfigResolved(name);
  }

  /**
   * 更新通道配置（合并模式）
   * 支持更新 name / enabled / options
   * BUG-2/BUG-7：`clearOptions=true` 时 options 采用替换语义（覆盖而非合并），
   * 使空值/删除操作能真正清空旧字段。
   * 内存更新始终成功；DB 持久化失败时记录警告但不阻止调用方继续
   */
  updateConfig(
    name: string,
    changes: {
      name?: string;
      enabled?: boolean;
      options?: Record<string, unknown>;
      clearOptions?: boolean;
    }
  ): boolean {
    let config = this.getConfigResolved(name);
    if (!config) {
      const owner = this.currentOwner();
      // 本地身份保持既有语义：未知通道 ⇒ false（桌面行为零变更）
      if (!owner) return false;
      // 多租户 P3：租户首次保存某通道时**创建自己的配置行**
      //（租户通道不需要运行时实例，配置/凭据仍需落库）。
      config = {
        name: changes.name ?? name,
        type: name,
        enabled: changes.enabled ?? true,
        options: {},
        ownerKey: owner,
      };
      this.configs.set(this.configMapKey(owner, name), config);
    }

    if (changes.name !== undefined) {
      config.name = changes.name;
    }
    if (changes.enabled !== undefined) {
      config.enabled = changes.enabled;
      // P1-1：同步内存 ChannelInterface.enabled，使 getEnabled()/lazyConnectChannels 立即生效。
      // 多租户 P3：运行时实例是**部署级（本地）**的 —— 租户只改自己的配置行，不碰共享实例。
      if ((config.ownerKey ?? '') === '') {
        const ch = this.channels.get(name) ?? this.channels.get(config.type);
        if (ch) ch.enabled = changes.enabled;
      }
    }
    if (changes.options !== undefined) {
      if (changes.clearOptions) {
        // BUG-2/BUG-7：替换语义，空对象可真正清空旧字段
        config.options = { ...changes.options };
      } else {
        // 合并语义；BUG-7：空字符串值表示删除该字段（前端清空输入）
        config.options = { ...config.options, ...changes.options };
        for (const [k, v] of Object.entries(changes.options)) {
          if (typeof v === 'string' && v.length === 0) {
            delete config.options[k];
          }
        }
      }
    }

    // 异步持久化（不阻塞调用者，失败时自动记录错误日志）
    this.persistConfig(config)
      .then((ok) => {
        if (!ok) {
          logger.warning(`更新通道配置 ${name}: 内存已更新但 DB 持久化失败`);
        }
      })
      .catch((err) => {
        logger.warning(`更新通道配置 ${name}: DB 持久化异常`, {
          error: String(err),
        });
      });

    return true;
  }

  /**
   * 获取所有配置（**当前身份**的；本地身份 ⇒ 部署级配置，与改造前等价）
   */
  getAllConfigs(): ChannelConfig[] {
    const owner = this.currentOwner();
    return Array.from(this.configs.values()).filter(
      (c) => (c.ownerKey ?? '') === owner
    );
  }

  /**
   * 列出**全部身份**的配置（含租户与部署级）。
   *
   * 仅供**后台装配**使用（如租户通道运行时托管按归属逐个托管）——
   * 业务读路径一律用 `getAllConfigs()`（按当前身份过滤），避免跨身份泄露。
   */
  listAllConfigs(): ChannelConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * 广播消息到所有通道
   */
  async broadcast(
    text: string
  ): Promise<Array<{ channel: string; success: boolean }>> {
    const results: Array<{ channel: string; success: boolean }> = [];

    for (const channel of this.getEnabled()) {
      try {
        const success = await channel.sendMessage('', text);
        results.push({ channel: channel.name, success });
      } catch (err) {
        await handleError(err, {
          module: 'channels:registry',
          action: 'broadcast',
          context: { channel: channel.name },
        });
        results.push({ channel: channel.name, success: false });
      }
    }

    return results;
  }

  async sendToHomeChannel(name: string, text: string): Promise<boolean> {
    const channel = this.channels.get(name);
    if (!channel || !channel.enabled) return false;

    const target = channel.homeChannelId || '';
    const result = await channel.sendMessage(target, text);

    return result;
  }

  async sendThreadReply(
    name: string,
    threadId: string,
    text: string
  ): Promise<boolean> {
    const channel = this.channels.get(name);
    if (!channel || !channel.supportsThreads || !channel.sendThreadMessage)
      return false;

    const target = channel.homeChannelId || '';
    const result = await channel.sendThreadMessage(target, threadId, text);

    return result;
  }

  getHomeChannels(): Array<{ name: string; homeChannelId: string }> {
    return this.getEnabled()
      .filter((c) => c.homeChannelId)
      .map((c) => ({ name: c.name, homeChannelId: c.homeChannelId! }));
  }

  /**
   * 获取统计
   */
  getStats(): {
    total: number;
    enabled: number;
    types: Record<string, number>;
  } {
    const channels = Array.from(this.channels.values());
    const types: Record<string, number> = {};

    for (const channel of channels) {
      types[channel.type] = (types[channel.type] || 0) + 1;
    }

    return {
      total: channels.length,
      enabled: channels.filter((c) => c.enabled).length,
      types,
    };
  }

  /**
   * 获取所有通道状态（兼容旧 API）
   */
  getAllStatuses(): Array<{
    id: string;
    status: { connected: boolean; latencyMs: number };
  }> {
    return Array.from(this.channels.entries()).map(([name, channel]) => ({
      id: name,
      status: {
        connected: channel.connected,
        latencyMs: 0,
      },
    }));
  }

  /**
   * 获取通道连接状态（兼容旧 API）
   */
  getStatus(name: string): { connected: boolean } | undefined {
    const channel = this.channels.get(name);
    if (!channel) return undefined;

    return { connected: channel.connected };
  }

  /**
   * 连接通道（兼容旧 API）
   */
  async connect(name: string): Promise<boolean> {
    const channel = this.channels.get(name);
    if (!channel) return false;

    const ok = await channel.connect();
    // T3.5（G1）：连接状态变化经 DependencyRegistry 广播
    dependencyRegistry.provide(`channel:${name}:status`, {
      connected: ok,
      type: channel.type,
      registered: true,
    });
    return ok;
  }

  /**
   * 断开通道（兼容旧 API）
   */
  async disconnect(name: string): Promise<boolean> {
    const channel = this.channels.get(name);
    if (!channel) return false;

    await channel.disconnect();
    // T3.5（G1）：断开状态变化经 DependencyRegistry 广播
    dependencyRegistry.provide(`channel:${name}:status`, {
      connected: false,
      type: channel.type,
      registered: true,
    });

    return true;
  }

  /**
   * 检查通道是否已连接
   */
  isConnected(name: string): boolean {
    const channel = this.channels.get(name);
    return channel ? channel.connected : false;
  }

  /**
   * 断开所有已连接通道
   */
  async disconnectAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const channel of this.channels.values()) {
      if (channel.connected) {
        promises.push(channel.disconnect());
      }
    }
    await Promise.allSettled(promises);
  }
}

export const channelRegistry = new ChannelRegistry();
