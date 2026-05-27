/**
 * ChannelPluginCatalog 渠道插件目录
 * 对标 OpenClaw 的 channel-catalog-registry，管理渠道插件的注册与发现
 */

/**
 * 渠道插件定义
 */
export interface ChannelPlugin {
  name: string;
  displayName: string;
  version: string;
  description: string;
  type: ChannelPluginType;
  protocol: string;
  capabilities: string[];
  configSchema: Record<string, unknown>;
  dependencies?: string[];
}

/**
 * 渠道插件类型
 */
export type ChannelPluginType =
  | 'messaging'
  | 'social'
  | 'notification'
  | 'voice'
  | 'custom';

/**
 * 渠道插件目录条目
 */
export interface ChannelPluginCatalogEntry {
  plugin: ChannelPlugin;
  installed: boolean;
  enabled: boolean;
  installedAt?: number;
}

/**
 * 渠道插件目录
 */
export class ChannelPluginCatalog {
  private entries: Map<string, ChannelPluginCatalogEntry> = new Map();

  /**
   * 注册渠道插件
   */
  register(plugin: ChannelPlugin): boolean {
    if (this.entries.has(plugin.name)) {
      return false;
    }

    this.entries.set(plugin.name, {
      plugin,
      installed: false,
      enabled: false,
    });

    return true;
  }

  /**
   * 批量注册默认渠道插件
   */
  registerDefaults(): number {
    const defaults: ChannelPlugin[] = [
      {
        name: 'channel-telegram',
        displayName: 'Telegram 通道',
        version: '1.0.0',
        description: 'Telegram 消息通道',
        type: 'messaging',
        protocol: 'telegram',
        capabilities: ['sendMessage', 'receiveMessage', 'sendMedia'],
        configSchema: { botToken: { type: 'string', required: true } },
      },
      {
        name: 'channel-discord',
        displayName: 'Discord 通道',
        version: '1.0.0',
        description: 'Discord 消息通道',
        type: 'messaging',
        protocol: 'discord',
        capabilities: ['sendMessage', 'receiveMessage', 'sendEmbed'],
        configSchema: { botToken: { type: 'string', required: true } },
      },
      {
        name: 'channel-slack',
        displayName: 'Slack 通道',
        version: '1.0.0',
        description: 'Slack 工作空间通道',
        type: 'messaging',
        protocol: 'slack',
        capabilities: ['sendMessage', 'receiveMessage', 'sendFile'],
        configSchema: { botToken: { type: 'string', required: true } },
      },
      {
        name: 'channel-irc',
        displayName: 'IRC 通道',
        version: '1.0.0',
        description: 'IRC 协议通道',
        type: 'messaging',
        protocol: 'irc',
        capabilities: ['sendMessage', 'receiveMessage', 'joinChannel'],
        configSchema: {
          server: { type: 'string', required: true },
          port: { type: 'number', default: 6667 },
        },
      },
      {
        name: 'channel-line',
        displayName: 'Line 通道',
        version: '1.0.0',
        description: 'Line 消息通道',
        type: 'messaging',
        protocol: 'line',
        capabilities: ['sendMessage', 'receiveMessage', 'sendReply'],
        configSchema: { channelToken: { type: 'string', required: true } },
      },
      {
        name: 'channel-nostr',
        displayName: 'Nostr 通道',
        version: '1.0.0',
        description: 'Nostr 去中心化协议通道',
        type: 'social',
        protocol: 'nostr',
        capabilities: ['sendMessage', 'receiveMessage', 'publishEvent'],
        configSchema: {
          privateKey: { type: 'string', required: true },
          relays: { type: 'array', default: [] },
        },
      },
    ];

    let count = 0;

    for (const plugin of defaults) {
      if (this.register(plugin)) {
        count++;
      }
    }

    return count;
  }

  /**
   * 获取渠道插件
   */
  get(name: string): ChannelPluginCatalogEntry | undefined {
    return this.entries.get(name);
  }

  /**
   * 设置安装状态
   */
  setInstalled(name: string, installed: boolean): boolean {
    const entry = this.entries.get(name);

    if (!entry) {
      return false;
    }

    entry.installed = installed;

    if (installed) {
      entry.installedAt = Date.now();
    }

    return true;
  }

  /**
   * 设置启用状态
   */
  setEnabled(name: string, enabled: boolean): boolean {
    const entry = this.entries.get(name);

    if (!entry) {
      return false;
    }

    entry.enabled = enabled;
    return true;
  }

  /**
   * 获取所有渠道插件
   */
  getAll(): ChannelPluginCatalogEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * 按类型获取渠道插件
   */
  getByType(type: ChannelPluginType): ChannelPluginCatalogEntry[] {
    return this.getAll().filter((e) => e.plugin.type === type);
  }

  /**
   * 获取已安装的渠道插件
   */
  getInstalled(): ChannelPluginCatalogEntry[] {
    return this.getAll().filter((e) => e.installed);
  }

  /**
   * 获取已启用的渠道插件
   */
  getEnabled(): ChannelPluginCatalogEntry[] {
    return this.getAll().filter((e) => e.enabled);
  }

  /**
   * 按协议获取渠道插件
   */
  getByProtocol(protocol: string): ChannelPluginCatalogEntry[] {
    return this.getAll().filter((e) => e.plugin.protocol === protocol);
  }

  /**
   * 按能力获取渠道插件
   */
  getByCapability(capability: string): ChannelPluginCatalogEntry[] {
    return this.getAll().filter((e) =>
      e.plugin.capabilities.includes(capability)
    );
  }

  /**
   * 获取目录统计
   */
  getStats(): {
    total: number;
    installed: number;
    enabled: number;
    byType: Record<string, number>;
  } {
    const byType: Record<string, number> = {};

    for (const entry of this.entries.values()) {
      byType[entry.plugin.type] = (byType[entry.plugin.type] || 0) + 1;
    }

    return {
      total: this.entries.size,
      installed: this.getInstalled().length,
      enabled: this.getEnabled().length,
      byType,
    };
  }
}

export const channelPluginCatalog = new ChannelPluginCatalog();
