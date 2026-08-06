/**
 * 渠道配置字段渲染元数据（4.1 / P0-1）
 *
 * 前端表单渲染依据的唯一来源：`GET /v1/channels/schema` 由此模块生成。
 * 字段 key 必须与各渠道 `config-schema.ts` 保持一致（由 ChannelContract 契约测试保证）。
 * 原位于 client/src/components/views/platformFields.ts，2026-08-06 收敛至后端。
 */

/** 平台配置字段定义 */
export interface PlatformFieldDef {
  key: string;
  label: string;
  placeholder: string;
  type: 'text' | 'password' | 'number';
  required?: boolean;
}

/** 平台字段映射 */
export const PLATFORM_FIELDS: Record<string, PlatformFieldDef[]> = {
  telegram: [
    {
      key: 'botToken',
      label: 'Bot Token',
      placeholder: '123456:ABC-DEF...',
      type: 'password',
      required: true,
    },
  ],
  discord: [
    {
      key: 'botToken',
      label: 'Bot Token',
      placeholder: 'MTIzNDU2...',
      type: 'password',
      required: true,
    },
  ],
  slack: [
    {
      key: 'botToken',
      label: 'Bot Token',
      placeholder: 'xoxb-...',
      type: 'password',
      required: true,
    },
    {
      key: 'signingSecret',
      label: 'Signing Secret',
      placeholder: 'abcdef...',
      type: 'password',
    },
    {
      key: 'appToken',
      label: 'App Token',
      placeholder: 'xapp-...',
      type: 'password',
    },
  ],
  wecom: [
    {
      key: 'corpId',
      label: '企业 ID',
      placeholder: 'ww...',
      type: 'text',
      required: true,
    },
    {
      key: 'agentId',
      label: '应用 AgentId',
      placeholder: '1000002',
      type: 'text',
      required: true,
    },
    {
      key: 'corpSecret',
      label: '应用 Secret',
      placeholder: '...',
      type: 'password',
      required: true,
    },
    { key: 'token', label: '回调 Token', placeholder: '...', type: 'text' },
    {
      key: 'encodingAESKey',
      label: '回调 AES Key',
      placeholder: '...',
      type: 'password',
    },
  ],
  feishu: [
    {
      key: 'appId',
      label: 'App ID',
      placeholder: 'cli_...',
      type: 'text',
      required: true,
    },
    {
      key: 'appSecret',
      label: 'App Secret',
      placeholder: '...',
      type: 'password',
      required: true,
    },
  ],
  dingtalk: [
    {
      key: 'appKey',
      label: 'App Key',
      placeholder: '...',
      type: 'text',
      required: true,
    },
    {
      key: 'appSecret',
      label: 'App Secret',
      placeholder: '...',
      type: 'password',
      required: true,
    },
  ],
  wechat: [
    {
      key: 'botHttpUrl',
      label: 'Bot HTTP URL',
      placeholder: 'http://localhost:7600',
      type: 'text',
      required: true,
    },
  ],
  qq: [
    {
      key: 'appId',
      label: 'App ID',
      placeholder: '...',
      type: 'text',
      required: true,
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      placeholder: '...',
      type: 'password',
      required: true,
    },
    {
      key: 'homeChannelId',
      label: '默认发送目标',
      placeholder: 'QQ 群号/频道号',
      type: 'text',
    },
  ],
  line: [
    {
      key: 'channelAccessToken',
      label: 'Channel Access Token',
      placeholder: '...',
      type: 'password',
      required: true,
    },
    {
      key: 'channelSecret',
      label: 'Channel Secret',
      placeholder: '...',
      type: 'password',
      required: true,
    },
  ],
  whatsapp: [
    {
      key: 'phoneNumberId',
      label: 'Phone Number ID',
      placeholder: '...',
      type: 'text',
      required: true,
    },
    {
      key: 'accessToken',
      label: 'Access Token',
      placeholder: '...',
      type: 'password',
      required: true,
    },
  ],
  email: [
    {
      key: 'host',
      label: 'SMTP Host',
      placeholder: 'smtp.example.com',
      type: 'text',
      required: true,
    },
    {
      key: 'port',
      label: 'SMTP Port',
      placeholder: '587',
      type: 'number',
      required: true,
    },
    {
      key: 'user',
      label: '用户名',
      placeholder: 'user@example.com',
      type: 'text',
      required: true,
    },
    {
      key: 'pass',
      label: '密码',
      placeholder: '...',
      type: 'password',
      required: true,
    },
  ],
  irc: [
    {
      key: 'server',
      label: '服务器地址',
      placeholder: 'irc.libera.chat',
      type: 'text',
      required: true,
    },
    {
      key: 'port',
      label: '端口',
      placeholder: '6667',
      type: 'number',
      required: true,
    },
    {
      key: 'nickname',
      label: '昵称',
      placeholder: 'mybot',
      type: 'text',
      required: true,
    },
    { key: 'password', label: '密码', placeholder: '...', type: 'password' },
    {
      key: 'channels',
      label: '频道（逗号分隔）',
      placeholder: '#general,#dev',
      type: 'text',
    },
  ],
  nostr: [
    {
      key: 'privateKey',
      label: '私钥',
      placeholder: 'nsec1...',
      type: 'password',
      required: true,
    },
    {
      key: 'relays',
      label: 'Relay 地址',
      placeholder: 'wss://relay.damus.io',
      type: 'text',
    },
  ],
  sms: [
    {
      key: 'fromNumber',
      label: '发送号码',
      placeholder: '+86...',
      type: 'text',
      required: true,
    },
    {
      key: 'accountSid',
      label: 'Account SID',
      placeholder: '...',
      type: 'text',
      required: true,
    },
    {
      key: 'authToken',
      label: 'Auth Token',
      placeholder: '...',
      type: 'password',
      required: true,
    },
  ],
  webhook: [
    {
      key: 'listenPort',
      label: '监听端口',
      placeholder: '8080',
      type: 'number',
      required: true,
    },
    {
      key: 'secret',
      label: 'Webhook Secret',
      placeholder: '...',
      type: 'password',
    },
  ],
  matrix: [
    {
      key: 'homeserverUrl',
      label: '服务器 URL',
      placeholder: 'https://matrix.org',
      type: 'text',
      required: true,
    },
    {
      key: 'accessToken',
      label: 'Access Token',
      placeholder: '...',
      type: 'password',
      required: true,
    },
    {
      key: 'userId',
      label: '用户 ID',
      placeholder: '@user:matrix.org',
      type: 'text',
      required: true,
    },
  ],
};

/** 通用字段（未在映射表中的平台使用） */
export const GENERIC_FIELDS: PlatformFieldDef[] = [
  { key: 'token', label: 'Token', placeholder: '...', type: 'password' },
  { key: 'apiKey', label: 'API Key', placeholder: '...', type: 'password' },
  {
    key: 'apiBase',
    label: 'API Base URL',
    placeholder: 'https://...',
    type: 'text',
  },
];

/**
 * 获取指定平台的配置字段列表
 * 如果平台在映射表中，返回映射字段；否则返回通用字段
 */
export function getPlatformFields(type: string): PlatformFieldDef[] {
  return PLATFORM_FIELDS[type] || GENERIC_FIELDS;
}

/** schema 端点载荷：平台映射 + 通用字段 */
export interface ChannelSchemaPayload {
  platforms: Record<string, PlatformFieldDef[]>;
  generic: PlatformFieldDef[];
}

/** 构建 GET /v1/channels/schema 响应体 */
export function buildChannelSchema(): ChannelSchemaPayload {
  return {
    platforms: PLATFORM_FIELDS,
    generic: GENERIC_FIELDS,
  };
}
