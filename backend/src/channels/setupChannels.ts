/**
 * 通道自动注册集成函数
 * 将 channels/ 各平台实现自动注册到 ChannelRegistry
 */
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { channelBootstrapper } from './bootstrap/ChannelBootstrapper';
import type { ChannelBootstrapConfig } from './bootstrap/ChannelBootstrapper';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 根据配置自动注册 IChannelPlugin 通道
 * 读取 channels 配置中的 enabled 字段，自动注册并连接
 */
export async function setupChannelsFromConfig(): Promise<{
  registered: number;
  errors: string[];
}> {
  // 动态导入各通道实例，避免循环依赖
  let telegramPlugin:
    | typeof import('../channels/telegram/TelegramChannel')
    | undefined;
  let discordPlugin:
    | typeof import('../channels/discord/DiscordChannel')
    | undefined;
  let qqPlugin: typeof import('../channels/qq/QQChannel') | undefined;
  let dingtalkPlugin:
    | typeof import('../channels/dingtalk/DingTalkChannel')
    | undefined;
  let feishuPlugin:
    | typeof import('../channels/feishu/FeishuChannel')
    | undefined;
  let wechatPlugin:
    | typeof import('../channels/wechat/WechatChannel')
    | undefined;
  let slackPlugin: typeof import('../channels/slack/index') | undefined;
  let linePlugin: typeof import('../channels/line/index') | undefined;
  let ircPlugin: typeof import('../channels/irc/index') | undefined;
  let nostrPlugin: typeof import('../channels/nostr/index') | undefined;
  let emailPlugin: typeof import('../channels/email/EmailChannel') | undefined;
  let smsPlugin: typeof import('../channels/sms/SmsChannel') | undefined;
  let webhookPlugin:
    | typeof import('../channels/webhook/WebhookChannel')
    | undefined;
  let wecomPlugin: typeof import('../channels/wecom/WeComChannel') | undefined;
  let googleChatPlugin:
    | typeof import('../channels/googlechat/index')
    | undefined;
  let msteamsPlugin: typeof import('../channels/msteams/index') | undefined;
  let zaloPlugin: typeof import('../channels/zalo/index') | undefined;
  let yuanbaoPlugin: typeof import('../channels/yuanbao/index') | undefined;
  let whatsAppPlugin: typeof import('../channels/whatsapp/index') | undefined;
  let signalPlugin: typeof import('../channels/signal/index') | undefined;
  let matrixPlugin: typeof import('../channels/matrix/index') | undefined;
  let facebookMessengerPlugin:
    | typeof import('../channels/facebookmessenger/index')
    | undefined;
  let twitterPlugin: typeof import('../channels/twitter/index') | undefined;
  let wechatBotPlugin:
    | typeof import('../channels/wechat-bot/index')
    | undefined;
  let claudePlugin: typeof import('../channels/claude/index') | undefined;

  try {
    telegramPlugin = await import('../channels/telegram/TelegramChannel');
  } catch {
    // telegram 通道不可用
  }

  try {
    discordPlugin = await import('../channels/discord/DiscordChannel');
  } catch {
    // discord 通道不可用
  }

  try {
    qqPlugin = await import('../channels/qq/QQChannel');
  } catch {
    // qq 通道不可用
  }

  try {
    dingtalkPlugin = await import('../channels/dingtalk/DingTalkChannel');
  } catch {
    // dingtalk 通道不可用
  }

  try {
    feishuPlugin = await import('../channels/feishu/FeishuChannel');
  } catch {
    // feishu 通道不可用
  }

  try {
    wechatPlugin = await import('../channels/wechat/WechatChannel');
  } catch {
    // wechat 通道不可用
  }

  try {
    slackPlugin = await import('../channels/slack/index');
  } catch {
    // slack 通道不可用
  }

  try {
    linePlugin = await import('../channels/line/index');
  } catch {
    // line 通道不可用
  }

  try {
    ircPlugin = await import('../channels/irc/index');
  } catch {
    // irc 通道不可用
  }

  try {
    nostrPlugin = await import('../channels/nostr/index');
  } catch {
    // nostr 通道不可用
  }

  try {
    emailPlugin = await import('../channels/email/EmailChannel');
  } catch {
    // email 通道不可用
  }

  try {
    smsPlugin = await import('../channels/sms/SmsChannel');
  } catch {
    // sms 通道不可用
  }

  try {
    webhookPlugin = await import('../channels/webhook/WebhookChannel');
  } catch {
    // webhook 通道不可用
  }

  try {
    wecomPlugin = await import('../channels/wecom/WeComChannel');
  } catch {
    // wecom 通道不可用
  }

  try {
    googleChatPlugin = await import('../channels/googlechat/index');
  } catch {
    // googlechat 通道不可用
  }

  try {
    msteamsPlugin = await import('../channels/msteams/index');
  } catch {
    // msteams 通道不可用
  }

  try {
    zaloPlugin = await import('../channels/zalo/index');
  } catch {
    // zalo 通道不可用
  }

  try {
    yuanbaoPlugin = await import('../channels/yuanbao/index');
  } catch {
    // yuanbao 通道不可用
  }

  try {
    whatsAppPlugin = await import('../channels/whatsapp/index');
  } catch {
    // whatsapp 通道不可用
  }

  try {
    signalPlugin = await import('../channels/signal/index');
  } catch {
    // signal 通道不可用
  }

  try {
    matrixPlugin = await import('../channels/matrix/index');
  } catch {
    // matrix 通道不可用
  }

  try {
    facebookMessengerPlugin =
      await import('../channels/facebookmessenger/index');
  } catch {
    // facebookmessenger 通道不可用
  }

  try {
    twitterPlugin = await import('../channels/twitter/index');
  } catch {
    // twitter 通道不可用
  }

  try {
    wechatBotPlugin = await import('../channels/wechat-bot/index');
  } catch {
    // wechat-bot 通道不可用
  }

  try {
    claudePlugin = await import('../channels/claude/index');
  } catch {
    // claude 通道不可用
  }

  // 注册 IChannelPlugin 通道工厂
  if (telegramPlugin?.telegramChannel) {
    channelBootstrapper.registerPluginChannel(
      'telegram',
      () => telegramPlugin!.telegramChannel
    );
  }
  if (discordPlugin?.discordChannel) {
    channelBootstrapper.registerPluginChannel(
      'discord',
      () => discordPlugin!.discordChannel
    );
  }
  if (qqPlugin?.qqChannel) {
    channelBootstrapper.registerPluginChannel('qq', () => qqPlugin!.qqChannel);
  }
  if (dingtalkPlugin?.dingtalkChannel) {
    channelBootstrapper.registerPluginChannel(
      'dingtalk',
      () => dingtalkPlugin!.dingtalkChannel
    );
  }
  if (feishuPlugin?.feishuChannel) {
    channelBootstrapper.registerPluginChannel(
      'feishu',
      () => feishuPlugin!.feishuChannel
    );
  }
  if (wechatPlugin?.wechatChannel) {
    channelBootstrapper.registerPluginChannel(
      'wechat',
      () => wechatPlugin!.wechatChannel
    );
  }
  if (slackPlugin?.slackChannelPlugin) {
    channelBootstrapper.registerPluginChannel(
      'slack',
      () => slackPlugin!.slackChannelPlugin
    );
  }
  if (linePlugin?.lineChannelPlugin) {
    channelBootstrapper.registerPluginChannel(
      'line',
      () => linePlugin!.lineChannelPlugin
    );
  }
  if (ircPlugin?.ircChannelPlugin) {
    channelBootstrapper.registerPluginChannel(
      'irc',
      () => ircPlugin!.ircChannelPlugin
    );
  }
  if (nostrPlugin?.nostrChannelPlugin) {
    channelBootstrapper.registerPluginChannel(
      'nostr',
      () => nostrPlugin!.nostrChannelPlugin
    );
  }
  if (emailPlugin?.emailChannelPlugin) {
    channelBootstrapper.registerPluginChannel(
      'email',
      () => emailPlugin!.emailChannelPlugin
    );
  }
  if (smsPlugin?.smsChannelPlugin) {
    channelBootstrapper.registerPluginChannel(
      'sms',
      () => smsPlugin!.smsChannelPlugin
    );
  }
  if (webhookPlugin?.webhookChannelPlugin) {
    channelBootstrapper.registerPluginChannel(
      'webhook',
      () => webhookPlugin!.webhookChannelPlugin
    );
  }
  if (wecomPlugin?.wecomChannel) {
    channelBootstrapper.registerPluginChannel(
      'wecom',
      () => wecomPlugin!.wecomChannel
    );
  }
  if (googleChatPlugin?.googleChatChannelPlugin) {
    channelBootstrapper.registerPluginChannel(
      'googlechat',
      () => googleChatPlugin!.googleChatChannelPlugin
    );
  }
  if (msteamsPlugin?.msteamsChannelPlugin) {
    channelBootstrapper.registerPluginChannel(
      'msteams',
      () => msteamsPlugin!.msteamsChannelPlugin
    );
  }
  if (zaloPlugin?.zaloChannelPlugin) {
    channelBootstrapper.registerPluginChannel(
      'zalo',
      () => zaloPlugin!.zaloChannelPlugin
    );
  }
  if (yuanbaoPlugin?.yuanbaoChannelPlugin) {
    channelBootstrapper.registerPluginChannel(
      'yuanbao',
      () => yuanbaoPlugin!.yuanbaoChannelPlugin
    );
  }

  if (whatsAppPlugin?.whatsAppChannelPlugin) {
    channelBootstrapper.registerPluginChannel(
      'whatsapp',
      () => whatsAppPlugin!.whatsAppChannelPlugin
    );
  }

  if (signalPlugin?.signalChannelPlugin) {
    channelBootstrapper.registerPluginChannel(
      'signal',
      () => signalPlugin!.signalChannelPlugin
    );
  }

  if (matrixPlugin?.matrixChannelPlugin) {
    channelBootstrapper.registerPluginChannel(
      'matrix',
      () => matrixPlugin!.matrixChannelPlugin
    );
  }

  if (facebookMessengerPlugin?.facebookMessengerChannelPlugin) {
    channelBootstrapper.registerPluginChannel(
      'facebook',
      () => facebookMessengerPlugin!.facebookMessengerChannelPlugin
    );
  }

  if (twitterPlugin?.twitterChannelPlugin) {
    channelBootstrapper.registerPluginChannel(
      'twitter',
      () => twitterPlugin!.twitterChannelPlugin
    );
  }

  if (claudePlugin?.claudeChannelPlugin) {
    channelBootstrapper.registerPluginChannel(
      'claude',
      () => claudePlugin!.claudeChannelPlugin
    );
  }

  if (wechatBotPlugin?.wechatBotChannel) {
    channelBootstrapper.registerPluginChannel(
      'wechat-bot',
      () => wechatBotPlugin!.wechatBotChannel
    );
  }

  // 构建配置（从环境变量或配置文件读取）
  const config: ChannelBootstrapConfig = {
    channels: [
      {
        type: 'telegram',
        enabled: !!process.env.TELEGRAM_BOT_TOKEN,
      },
      {
        type: 'discord',
        enabled: !!process.env.DISCORD_TOKEN,
      },
      {
        type: 'qq',
        enabled: !!process.env.QQ_APP_ID && !!process.env.QQ_TOKEN,
      },
      {
        type: 'dingtalk',
        enabled:
          !!process.env.DINGTALK_APP_KEY && !!process.env.DINGTALK_APP_SECRET,
      },
      {
        type: 'feishu',
        enabled: !!process.env.FEISHU_APP_ID && !!process.env.FEISHU_APP_SECRET,
      },
      {
        type: 'wechat',
        enabled: !!process.env.WECHAT_APP_ID && !!process.env.WECHAT_APP_SECRET,
      },
      {
        type: 'slack',
        enabled:
          !!process.env.SLACK_BOT_TOKEN && !!process.env.SLACK_SIGNING_SECRET,
      },
      {
        type: 'line',
        enabled:
          !!process.env.LINE_CHANNEL_ACCESS_TOKEN &&
          !!process.env.LINE_CHANNEL_SECRET,
      },
      {
        type: 'irc',
        enabled: !!process.env.IRC_SERVER && !!process.env.IRC_NICK,
      },
      {
        type: 'nostr',
        enabled: !!process.env.NOSTR_PRIVATE_KEY || !!process.env.NOSTR_RELAYS,
      },
      {
        type: 'email',
        enabled: !!process.env.EMAIL_HOST && !!process.env.EMAIL_USER,
      },
      {
        type: 'sms',
        enabled: !!process.env.SMS_FROM_NUMBER,
      },
      {
        type: 'webhook',
        enabled: !!process.env.WEBHOOK_LISTEN_PORT,
      },
      {
        type: 'wecom',
        enabled:
          !!process.env.WECOM_CORP_ID &&
          !!process.env.WECOM_CORP_SECRET &&
          !!process.env.WECOM_AGENT_ID,
      },
      {
        type: 'googlechat',
        enabled: !!process.env.GOOGLECHAT_SERVICE_ACCOUNT,
      },
      {
        type: 'msteams',
        enabled:
          !!process.env.MSTEAMS_BOT_ID && !!process.env.MSTEAMS_BOT_PASSWORD,
      },
      {
        type: 'zalo',
        enabled: !!process.env.ZALO_APP_ID && !!process.env.ZALO_APP_SECRET,
      },
      {
        type: 'yuanbao',
        enabled: !!process.env.YUANBAO_APP_ID && !!process.env.YUANBAO_APP_KEY,
      },
      {
        type: 'whatsapp',
        enabled:
          !!process.env.WHATSAPP_PHONE_NUMBER_ID &&
          !!process.env.WHATSAPP_ACCESS_TOKEN,
      },
      {
        type: 'signal',
        enabled: !!process.env.SIGNAL_ACCOUNT,
      },
      {
        type: 'matrix',
        enabled:
          !!process.env.MATRIX_HOMESERVER_URL &&
          !!process.env.MATRIX_ACCESS_TOKEN,
      },
      {
        type: 'facebook',
        enabled: !!process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
      },
      {
        type: 'twitter',
        enabled:
          !!process.env.TWITTER_API_KEY && !!process.env.TWITTER_API_SECRET_KEY,
      },
      {
        type: 'claude',
        enabled: !!process.env.CLAUDE_API_KEY,
      },
      {
        type: 'wechat-bot',
        enabled: !!process.env.WECHAT_BOT_HTTP_URL,
      },
    ],
  };

  const result = await channelBootstrapper.bootstrap(config);

  if (result.registered > 0) {
    logger.info(`通道自动注册完成: ${result.registered} 通道已注册`);
  }

  if (result.errors.length > 0) {
    logger.warning('通道注册存在错误', { errors: result.errors });
  }

  return result;
}
