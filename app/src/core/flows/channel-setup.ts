import type {
  ChannelSetupResult,
  FlowContext,
  FlowConfigProvider,
} from './types.js';

export type ChannelSetupPlugin = {
  channelId: string;
  name: string;
  description?: string;
  defaultAccountId?: string;
  configure: (
    accountId: string,
    context: FlowContext,
    configProvider: FlowConfigProvider
  ) => Promise<{ ok: boolean; error?: string }>;
};

const DEFAULT_PLUGINS: ChannelSetupPlugin[] = [
  {
    channelId: 'qq',
    name: 'QQ Bot',
    description: 'QQ 开放平台 Bot',
    configure: async (accountId, ctx, configProvider) => {
      if (!ctx.env?.QQ_APP_ID || !ctx.env?.QQ_APP_SECRET) {
        return { ok: false, error: 'QQ_APP_ID 和 QQ_APP_SECRET 未配置' };
      }
      configProvider.set(
        `channels.qq.accounts.${accountId}.appId`,
        ctx.env.QQ_APP_ID
      );
      configProvider.set(
        `channels.qq.accounts.${accountId}.clientSecret`,
        ctx.env.QQ_APP_SECRET
      );
      return { ok: true };
    },
  },
  {
    channelId: 'irc',
    name: 'IRC',
    description: 'Internet Relay Chat',
    configure: async (accountId, ctx, configProvider) => {
      if (!ctx.env?.IRC_SERVER) {
        return { ok: false, error: 'IRC_SERVER not configured' };
      }
      configProvider.set(
        `channels.irc.accounts.${accountId}.server`,
        ctx.env.IRC_SERVER
      );
      return { ok: true };
    },
  },
  {
    channelId: 'discord',
    name: 'Discord',
    description: 'Discord messaging platform',
    configure: async (accountId, ctx, configProvider) => {
      if (!ctx.env?.DISCORD_TOKEN) {
        return { ok: false, error: 'DISCORD_TOKEN not configured' };
      }
      configProvider.set(
        `channels.discord.accounts.${accountId}.token`,
        ctx.env.DISCORD_TOKEN
      );
      return { ok: true };
    },
  },
  {
    channelId: 'telegram',
    name: 'Telegram',
    description: 'Telegram messaging platform',
    configure: async (accountId, ctx, configProvider) => {
      if (!ctx.env?.TELEGRAM_BOT_TOKEN) {
        return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' };
      }
      configProvider.set(
        `channels.telegram.accounts.${accountId}.botToken`,
        ctx.env.TELEGRAM_BOT_TOKEN
      );
      return { ok: true };
    },
  },
  {
    channelId: 'slack',
    name: 'Slack',
    description: 'Slack workspace messaging',
    configure: async (accountId, ctx, configProvider) => {
      if (!ctx.env?.SLACK_BOT_TOKEN) {
        return { ok: false, error: 'SLACK_BOT_TOKEN not configured' };
      }
      configProvider.set(
        `channels.slack.accounts.${accountId}.token`,
        ctx.env.SLACK_BOT_TOKEN
      );
      configProvider.set(
        `channels.slack.accounts.${accountId}.appToken`,
        ctx.env.SLACK_APP_TOKEN
      );
      return { ok: true };
    },
  },
  {
    channelId: 'line',
    name: 'LINE',
    description: 'LINE messaging platform',
    configure: async (accountId, ctx, configProvider) => {
      if (!ctx.env?.LINE_CHANNEL_ACCESS_TOKEN) {
        return { ok: false, error: 'LINE_CHANNEL_ACCESS_TOKEN not configured' };
      }
      configProvider.set(
        `channels.line.accounts.${accountId}.channelAccessToken`,
        ctx.env.LINE_CHANNEL_ACCESS_TOKEN
      );
      return { ok: true };
    },
  },
];

const pluginRegistry = new Map<string, ChannelSetupPlugin>();

for (const plugin of DEFAULT_PLUGINS) {
  pluginRegistry.set(plugin.channelId, plugin);
}

/**
 * 注册渠道设置插件。
 */
export function registerChannelSetupPlugin(plugin: ChannelSetupPlugin): void {
  pluginRegistry.set(plugin.channelId, plugin);
}

/**
 * 获取指定渠道的设置插件。
 */
export function getChannelSetupPlugin(
  channelId: string
): ChannelSetupPlugin | undefined {
  return pluginRegistry.get(channelId);
}

/**
 * 列出所有可用的渠道设置插件。
 */
export function listChannelSetupPlugins(): ChannelSetupPlugin[] {
  return Array.from(pluginRegistry.values());
}

/**
 * 执行单个渠道的设置流程。
 */
export async function setupChannel(
  channelId: string,
  accountId: string = 'default',
  context: FlowContext = {},
  configProvider: FlowConfigProvider
): Promise<ChannelSetupResult> {
  const plugin = pluginRegistry.get(channelId);

  if (!plugin) {
    return {
      channelId,
      configured: false,
      error: `No setup plugin for channel: ${channelId}`,
    };
  }

  try {
    const result = await plugin.configure(accountId, context, configProvider);
    return {
      channelId,
      configured: result.ok,
      accountId,
      error: result.error,
    };
  } catch (err) {
    return {
      channelId,
      configured: false,
      accountId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 批量执行渠道设置流程。
 */
export async function setupChannels(
  targets: Array<{ channelId: string; accountId?: string }>,
  context: FlowContext = {},
  configProvider: FlowConfigProvider
): Promise<ChannelSetupResult[]> {
  return Promise.all(
    targets.map((t) =>
      setupChannel(
        t.channelId,
        t.accountId ?? 'default',
        context,
        configProvider
      )
    )
  );
}

/**
 * 检查渠道是否已设置。
 */
export function isChannelConfigured(
  channelId: string,
  configProvider: FlowConfigProvider,
  accountId: string = 'default'
): boolean {
  const accounts = configProvider.get<Record<string, unknown>>(
    `channels.${channelId}.accounts`
  );
  return !!accounts?.[accountId];
}
