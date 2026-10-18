/**
 * B-1：通道启用判据全部下沉至 `CHANNEL_CATALOG`（单一事实源）。
 *
 * 覆盖：
 * ① 26 个目录项均声明 `credentials` 与 `isEnabled`；
 * ② 期望表与目录 type 集合完全一致（防漂移）；
 * ③ 每个通道「无凭据 ⇒ false」「凭据齐全 ⇒ true」；
 * ④ AND 语义通道「缺任一凭据 ⇒ false」；OR 语义通道（nostr）「任一即可 ⇒ true」。
 */
import { describe, expect, it } from 'bun:test';
import {
  CHANNEL_CATALOG,
  getChannelCatalogEntry,
} from '../../src/channels/ChannelCatalog.js';

/** 期望判据语义：`all` = 全部凭据必须存在；`any` = 任一存在即可 */
const EXPECTED: Record<string, { credentials: string[]; mode: 'all' | 'any' }> =
  {
    telegram: { credentials: ['TELEGRAM_BOT_TOKEN'], mode: 'all' },
    discord: { credentials: ['DISCORD_TOKEN'], mode: 'all' },
    qq: { credentials: ['QQ_APP_ID', 'QQ_APP_SECRET'], mode: 'all' },
    dingtalk: {
      credentials: ['DINGTALK_APP_KEY', 'DINGTALK_APP_SECRET'],
      mode: 'all',
    },
    feishu: {
      credentials: ['FEISHU_APP_ID', 'FEISHU_APP_SECRET'],
      mode: 'all',
    },
    wechat: { credentials: ['WECHAT_BOT_HTTP_URL'], mode: 'all' },
    slack: {
      credentials: ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'],
      mode: 'all',
    },
    line: {
      credentials: ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET'],
      mode: 'all',
    },
    irc: { credentials: ['IRC_SERVER', 'IRC_NICK'], mode: 'all' },
    nostr: {
      credentials: ['NOSTR_PRIVATE_KEY', 'NOSTR_RELAYS'],
      mode: 'any',
    },
    email: { credentials: ['EMAIL_HOST', 'EMAIL_USER'], mode: 'all' },
    sms: { credentials: ['SMS_FROM_NUMBER'], mode: 'all' },
    webhook: { credentials: ['WEBHOOK_LISTEN_PORT'], mode: 'all' },
    wecom: {
      credentials: ['WECOM_CORP_ID', 'WECOM_CORP_SECRET', 'WECOM_AGENT_ID'],
      mode: 'all',
    },
    googlechat: { credentials: ['GOOGLECHAT_SERVICE_ACCOUNT'], mode: 'all' },
    msteams: {
      credentials: ['MSTEAMS_BOT_ID', 'MSTEAMS_BOT_PASSWORD'],
      mode: 'all',
    },
    zalo: { credentials: ['ZALO_APP_ID', 'ZALO_APP_SECRET'], mode: 'all' },
    yuanbao: {
      credentials: ['YUANBAO_APP_ID', 'YUANBAO_APP_KEY'],
      mode: 'all',
    },
    whatsapp: {
      credentials: ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN'],
      mode: 'all',
    },
    signal: { credentials: ['SIGNAL_ACCOUNT'], mode: 'all' },
    matrix: {
      credentials: ['MATRIX_HOMESERVER_URL', 'MATRIX_ACCESS_TOKEN'],
      mode: 'all',
    },
    facebook: { credentials: ['FACEBOOK_PAGE_ACCESS_TOKEN'], mode: 'all' },
    twitter: {
      credentials: ['TWITTER_API_KEY', 'TWITTER_API_SECRET_KEY'],
      mode: 'all',
    },
    claude: {
      credentials: ['CHANNEL_CLAUDE_ENABLED', 'CHANNEL_CLAUDE_API_KEY'],
      mode: 'all',
    },
    mattermost: {
      credentials: ['MATTERMOST_URL', 'MATTERMOST_TOKEN'],
      mode: 'all',
    },
    bluebubbles: {
      credentials: ['BLUEBUBBLES_URL', 'BLUEBUBBLES_PASSWORD'],
      mode: 'all',
    },
  };

const TYPES = CHANNEL_CATALOG.map((e) => e.type);

/** 由键集合构造 env 访问器（存在即返回非空值） */
const envOf =
  (keys: readonly string[]) =>
  (key: string): string | undefined =>
    keys.includes(key) ? `value-of-${key}` : undefined;

describe('B-1 ChannelCatalog 启用判据（全量迁移）', () => {
  it('目录 26 项与期望表 type 集合完全一致', () => {
    expect(TYPES).toHaveLength(26);
    expect(new Set(TYPES).size).toBe(26);
    expect([...TYPES].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('每个目录项都声明 credentials 与 isEnabled', () => {
    for (const entry of CHANNEL_CATALOG) {
      expect(entry.credentials.length).toBeGreaterThan(0);
      expect(typeof entry.isEnabled).toBe('function');
      expect([...entry.credentials]).toEqual(EXPECTED[entry.type].credentials);
    }
  });

  it('空环境一律不启用', () => {
    for (const entry of CHANNEL_CATALOG) {
      expect(entry.isEnabled(() => undefined)).toBe(false);
    }
  });

  it('凭据齐全一律启用；AND 通道缺任一凭据即不启用', () => {
    for (const entry of CHANNEL_CATALOG) {
      const { credentials, mode } = EXPECTED[entry.type];
      expect(entry.isEnabled(envOf(credentials))).toBe(true);

      if (mode === 'all' && credentials.length > 1) {
        const missingLast = credentials.slice(0, -1);
        expect(entry.isEnabled(envOf(missingLast))).toBe(false);
      }
    }
  });

  it('OR 通道（nostr）任一凭据即可启用', () => {
    const nostr = getChannelCatalogEntry('nostr');
    expect(nostr?.isEnabled(envOf(['NOSTR_PRIVATE_KEY']))).toBe(true);
    expect(nostr?.isEnabled(envOf(['NOSTR_RELAYS']))).toBe(true);
    expect(nostr?.isEnabled(envOf([]))).toBe(false);
  });

  it('空字符串凭据视为未配置', () => {
    const env = (key: string): string | undefined =>
      key === 'TELEGRAM_BOT_TOKEN' ? '' : undefined;
    expect(getChannelCatalogEntry('telegram')?.isEnabled(env)).toBe(false);
  });
});
