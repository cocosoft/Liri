/**
 * ChannelSecretStore 渠道密钥存储
 *
 * 数出同源：所有渠道凭据统一经由 channelRegistry 持久化到 app.db
 * 的 channel_configs 表。DB 无凭据时回退到 `LIRI_CHANNEL_<TYPE>_<FIELD>`
 * 环境变量（P1-2），保证纯 .env 部署可用。
 *
 * @example
 * ```typescript
 * // 读取 QQ 凭据
 * const creds = ChannelSecretStore.get('qq');
 * // => { appId: 'xxx', clientSecret: 'xxx' }
 *
 * // 写入 QQ 凭据（立即持久化到 DB）
 * ChannelSecretStore.set('qq', { appId: 'xxx', clientSecret: 'xxx' });
 * ```
 */

// 2026-08-06（P0-4）：凭据加密（敏感字段落库前加密，读取时解密）
import { encryptOptions, decryptOptions } from './encryption';

/**
 * ChannelRegistry 最小接口（避免 import type 被 madge 视作循环依赖）
 */
interface _ChannelRegistry {
  getConfig(
    name: string
  ): { options?: Record<string, unknown>; type?: string } | undefined;
  updateConfig(
    name: string,
    changes: { options?: Record<string, unknown> }
  ): boolean;
  getAllConfigs(): Array<{ type: string; options?: Record<string, unknown> }>;
}

/**
 * 模块级 channelRegistry 引用（延迟初始化）
 * 避免 ChannelSecretStore ↔ ChannelRegistry 循环依赖
 */
let _registry: _ChannelRegistry | null = null;

/** 设置 channelRegistry 引用（由启动代码在初始化时调用） */
export function initRegistry(registry: _ChannelRegistry): void {
  _registry = registry;
}

/** 获取 channelRegistry 引用 */
function getRegistry(): _ChannelRegistry {
  if (!_registry) {
    throw new Error(
      'ChannelSecretStore: channelRegistry 未初始化，请先调用 initRegistry()'
    );
  }
  return _registry;
}

/** SCREAMING_SNAKE_CASE → camelCase（BOT_TOKEN → botToken） */
function toCamelCase(snake: string): string {
  return snake
    .toLowerCase()
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * P1-2：从环境变量读取渠道凭据回退源
 * 命名规范：`LIRI_CHANNEL_<TYPE>_<FIELD>`（如 LIRI_CHANNEL_TELEGRAM_BOT_TOKEN）
 */
function getEnvCredentials(channelId: string): Record<string, unknown> {
  const prefix = `LIRI_CHANNEL_${channelId.toUpperCase()}_`;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(prefix) && value) {
      result[toCamelCase(key.slice(prefix.length))] = value;
    }
  }
  return result;
}

/**
 * ChannelSecretStore — 统一渠道凭据存储
 *
 * 单例模式，通过 ChannelSecretStore.getInstance() 获取实例。
 * 所有读写操作都经过此组件，确保数出同源。
 */
export class ChannelSecretStore {
  private static instance: ChannelSecretStore;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): ChannelSecretStore {
    if (!ChannelSecretStore.instance) {
      ChannelSecretStore.instance = new ChannelSecretStore();
    }
    return ChannelSecretStore.instance;
  }

  /**
   * 获取指定渠道的凭据
   *
   * 数出同源：DB 持久化配置优先；DB 无凭据时回退到
   * `LIRI_CHANNEL_<TYPE>_<FIELD>` 环境变量（P1-2），杜绝纯 .env 部署"注册成功但连不上"。
   * 2026-08-06（P0-4）：敏感字段密文落库，读取时解密返回。
   *
   * @param channelId 渠道 ID（如 'qq', 'telegram'）
   * @returns 凭据对象，可能为空对象
   */
  get(channelId: string): Record<string, unknown> {
    const config = getRegistry().getConfig(channelId);
    if (config?.options && Object.keys(config.options).length > 0) {
      return decryptOptions({ ...config.options });
    }
    // P1-2：DB 无凭据 → env 回退
    return getEnvCredentials(channelId);
  }

  /**
   * 保存指定渠道的凭据（敏感字段加密后持久化到 DB）
   *
   * @param channelId 渠道 ID
   * @param credentials 凭据对象
   */
  set(channelId: string, credentials: Record<string, unknown>): void {
    getRegistry().updateConfig(channelId, {
      options: encryptOptions(credentials),
    });
  }

  /**
   * 删除指定渠道的凭据（从 DB 中清除）
   *
   * @param channelId 渠道 ID
   */
  delete(channelId: string): void {
    getRegistry().updateConfig(channelId, { options: {} });
  }

  /**
   * 获取所有渠道的凭据概览（脱敏处理）
   * 用于仪表盘展示或调试
   */
  getAllSanitized(): Record<string, Record<string, unknown>> {
    const configs = getRegistry().getAllConfigs();
    const result: Record<string, Record<string, unknown>> = {};

    for (const config of configs) {
      if (config.options && Object.keys(config.options).length > 0) {
        // 2026-08-06（P0-4）：先解密（密文脱敏会误伤），再对明文脱敏
        const decrypted = decryptOptions({ ...config.options });
        const sanitized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(decrypted)) {
          if (typeof value === 'string' && value.length > 4) {
            sanitized[key] = value.slice(0, 2) + '****' + value.slice(-2);
          } else {
            sanitized[key] = value;
          }
        }
        result[config.type] = sanitized;
      }
    }

    return result;
  }
}
