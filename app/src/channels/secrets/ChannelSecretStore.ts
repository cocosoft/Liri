/**
 * ChannelSecretStore 渠道密钥存储
 *
 * 统一的渠道凭据存储入口，所有渠道的配置信息（API Key、Token、Secret 等）
 * 通过此组件读写，底层基于 channelRegistry 持久化到 app.db 的 channel_configs 表。
 *
 * 解析优先级：显式传入值 > store（DB 持久化） > process.env > 默认值
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

import { channelRegistry } from '../registry/ChannelRegistry';

/**
 * 渠道凭据环境变量对照表
 * key: 渠道 ID, value: 渠道配置键名到环境变量名的映射
 */
const CHANNEL_ENV_MAP: Record<string, Record<string, string>> = {
  qq: {
    appId: 'QQ_APP_ID',
    clientSecret: 'QQ_APP_SECRET',
    homeChannelId: 'QQ_HOME_CHANNEL_ID',
  },
  telegram: {
    botToken: 'TELEGRAM_BOT_TOKEN',
  },
  discord: {
    botToken: 'DISCORD_TOKEN',
  },
  dingtalk: {
    appKey: 'DINGTALK_APP_KEY',
    appSecret: 'DINGTALK_APP_SECRET',
  },
  feishu: {
    appId: 'FEISHU_APP_ID',
    appSecret: 'FEISHU_APP_SECRET',
  },
  wechat: {
    botHttpUrl: 'WECHAT_BOT_HTTP_URL',
  },
  slack: {
    botToken: 'SLACK_BOT_TOKEN',
    signingSecret: 'SLACK_SIGNING_SECRET',
  },
  line: {
    channelAccessToken: 'LINE_CHANNEL_ACCESS_TOKEN',
    channelSecret: 'LINE_CHANNEL_SECRET',
  },
  irc: {
    server: 'IRC_SERVER',
    nick: 'IRC_NICK',
  },
  nostr: {
    privateKey: 'NOSTR_PRIVATE_KEY',
    relays: 'NOSTR_RELAYS',
  },
  email: {
    host: 'EMAIL_HOST',
    user: 'EMAIL_USER',
  },
  sms: {
    fromNumber: 'SMS_FROM_NUMBER',
  },
  webhook: {
    listenPort: 'WEBHOOK_LISTEN_PORT',
  },
  wecom: {
    corpId: 'WECOM_CORP_ID',
    corpSecret: 'WECOM_CORP_SECRET',
    agentId: 'WECOM_AGENT_ID',
  },
  googlechat: {
    serviceAccount: 'GOOGLECHAT_SERVICE_ACCOUNT',
  },
  msteams: {
    botId: 'MSTEAMS_BOT_ID',
    botPassword: 'MSTEAMS_BOT_PASSWORD',
  },
  zalo: {
    appId: 'ZALO_APP_ID',
    appSecret: 'ZALO_APP_SECRET',
  },
  yuanbao: {
    appId: 'YUANBAO_APP_ID',
    appKey: 'YUANBAO_APP_KEY',
  },
  whatsapp: {
    phoneNumberId: 'WHATSAPP_PHONE_NUMBER_ID',
    accessToken: 'WHATSAPP_ACCESS_TOKEN',
  },
  signal: {
    account: 'SIGNAL_ACCOUNT',
  },
  matrix: {
    homeserverUrl: 'MATRIX_HOMESERVER_URL',
    accessToken: 'MATRIX_ACCESS_TOKEN',
  },
  facebook: {
    pageAccessToken: 'FACEBOOK_PAGE_ACCESS_TOKEN',
  },
  twitter: {
    apiKey: 'TWITTER_API_KEY',
    apiSecretKey: 'TWITTER_API_SECRET_KEY',
  },
  claude: {
    enabled: 'CLAUDE_CHANNEL_ENABLED',
    apiKey: 'CLAUDE_API_KEY',
  },
  mattermost: {
    serverUrl: 'MATTERMOST_URL',
    botToken: 'MATTERMOST_TOKEN',
  },
  bluebubbles: {
    serverUrl: 'BLUEBUBBLES_URL',
    password: 'BLUEBUBBLES_PASSWORD',
  },
};

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
   * 解析优先级：
   * 1. 从 channelRegistry 的已持久化配置中读取（DB 中的 options）
   * 2. 未命中时从 process.env 读取（向后兼容）
   *
   * @param channelId 渠道 ID（如 'qq', 'telegram'）
   * @returns 凭据对象，可能为空对象
   */
  get(channelId: string): Record<string, unknown> {
    const credentials: Record<string, unknown> = {};

    // 第一步：从 DB 持久化配置中读取
    const config = channelRegistry.getConfig(channelId);
    if (config?.options && Object.keys(config.options).length > 0) {
      Object.assign(credentials, config.options);
    }

    // 第二步：从 process.env 补充缺失值（向后兼容）
    const envMap = CHANNEL_ENV_MAP[channelId];
    if (envMap) {
      for (const [key, envVar] of Object.entries(envMap)) {
        if (
          !(key in credentials) ||
          credentials[key] === '' ||
          credentials[key] === undefined
        ) {
          const envVal = process.env[envVar];
          if (envVal) {
            credentials[key] = envVal;
          }
        }
      }
    }

    return credentials;
  }

  /**
   * 保存指定渠道的凭据（持久化到 DB）
   *
   * @param channelId 渠道 ID
   * @param credentials 凭据对象
   */
  set(channelId: string, credentials: Record<string, unknown>): void {
    channelRegistry.updateConfig(channelId, { options: credentials });
  }

  /**
   * 删除指定渠道的凭据（从 DB 中清除）
   *
   * @param channelId 渠道 ID
   */
  delete(channelId: string): void {
    channelRegistry.updateConfig(channelId, { options: {} });
  }

  /**
   * 获取所有渠道的凭据概览（脱敏处理）
   * 用于仪表盘展示或调试
   */
  getAllSanitized(): Record<string, Record<string, unknown>> {
    const configs = channelRegistry.getAllConfigs();
    const result: Record<string, Record<string, unknown>> = {};

    for (const config of configs) {
      if (config.options && Object.keys(config.options).length > 0) {
        const sanitized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(config.options)) {
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
