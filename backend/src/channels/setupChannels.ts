/**
 * 通道自动注册集成函数
 * 将 channels/ 各平台实现自动注册到 ChannelRegistry
 * 优化：先检查环境变量配置，仅导入已启用的通道模块
 */
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { channelBootstrapper } from './bootstrap/ChannelBootstrapper';
import type { ChannelBootstrapConfig } from './bootstrap/ChannelBootstrapper';
import { channelRegistry } from './registry/ChannelRegistry';
import { getCoreAPI } from '../runtime/api/CoreAPIImpl';
import type { IChannelPlugin, MessageContext } from './types/IChannel';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 根据配置自动注册 IChannelPlugin 通道
 * 读取环境变量确定哪些通道已启用，仅导入已启用的通道模块
 */
export async function setupChannelsFromConfig(): Promise<{
  registered: number;
  errors: string[];
}> {
  const t0 = Date.now();
  console.log(`[DIAG][${t0}] setupChannelsFromConfig: 函数入口, 开始检查通道配置...`);

  // 第一步：定义通道映射 + 筛选已启用的通道
  // 注意：import() 路径定义在函数内部而非模块顶层，避免 Bun 预解析所有路径
  const channelCandidates: Array<{
    type: string;
    enabled: boolean;
    importPath: string;
    exportKey: string;
  }> = [
    { type: 'telegram', enabled: !!process.env.TELEGRAM_BOT_TOKEN, importPath: '../channels/telegram/TelegramChannel', exportKey: 'telegramChannel' },
    { type: 'discord', enabled: !!process.env.DISCORD_TOKEN, importPath: '../channels/discord/DiscordChannel', exportKey: 'discordChannel' },
    { type: 'qq', enabled: !!process.env.QQ_APP_ID && !!process.env.QQ_APP_SECRET, importPath: '../channels/qq/QQChannel', exportKey: 'qqChannel' },
    { type: 'dingtalk', enabled: !!process.env.DINGTALK_APP_KEY && !!process.env.DINGTALK_APP_SECRET, importPath: '../channels/dingtalk/DingTalkChannel', exportKey: 'dingtalkChannel' },
    { type: 'feishu', enabled: !!process.env.FEISHU_APP_ID && !!process.env.FEISHU_APP_SECRET, importPath: '../channels/feishu/FeishuChannel', exportKey: 'feishuChannel' },
    { type: 'wechat', enabled: !!process.env.WECHAT_APP_ID && !!process.env.WECHAT_APP_SECRET, importPath: '../channels/wechat/WechatChannel', exportKey: 'wechatChannel' },
    { type: 'slack', enabled: !!process.env.SLACK_BOT_TOKEN && !!process.env.SLACK_SIGNING_SECRET, importPath: '../channels/slack/index', exportKey: 'slackChannelPlugin' },
    { type: 'line', enabled: !!process.env.LINE_CHANNEL_ACCESS_TOKEN && !!process.env.LINE_CHANNEL_SECRET, importPath: '../channels/line/index', exportKey: 'lineChannelPlugin' },
    { type: 'irc', enabled: !!process.env.IRC_SERVER && !!process.env.IRC_NICK, importPath: '../channels/irc/index', exportKey: 'ircChannelPlugin' },
    { type: 'nostr', enabled: !!process.env.NOSTR_PRIVATE_KEY || !!process.env.NOSTR_RELAYS, importPath: '../channels/nostr/index', exportKey: 'nostrChannelPlugin' },
    { type: 'email', enabled: !!process.env.EMAIL_HOST && !!process.env.EMAIL_USER, importPath: '../channels/email/EmailChannel', exportKey: 'emailChannelPlugin' },
    { type: 'sms', enabled: !!process.env.SMS_FROM_NUMBER, importPath: '../channels/sms/SmsChannel', exportKey: 'smsChannelPlugin' },
    { type: 'webhook', enabled: !!process.env.WEBHOOK_LISTEN_PORT, importPath: '../channels/webhook/WebhookChannel', exportKey: 'webhookChannelPlugin' },
    { type: 'wecom', enabled: !!process.env.WECOM_CORP_ID && !!process.env.WECOM_CORP_SECRET && !!process.env.WECOM_AGENT_ID, importPath: '../channels/wecom/WeComChannel', exportKey: 'wecomChannel' },
    { type: 'googlechat', enabled: !!process.env.GOOGLECHAT_SERVICE_ACCOUNT, importPath: '../channels/googlechat/index', exportKey: 'googleChatChannelPlugin' },
    { type: 'msteams', enabled: !!process.env.MSTEAMS_BOT_ID && !!process.env.MSTEAMS_BOT_PASSWORD, importPath: '../channels/msteams/index', exportKey: 'msteamsChannelPlugin' },
    { type: 'zalo', enabled: !!process.env.ZALO_APP_ID && !!process.env.ZALO_APP_SECRET, importPath: '../channels/zalo/index', exportKey: 'zaloChannelPlugin' },
    { type: 'yuanbao', enabled: !!process.env.YUANBAO_APP_ID && !!process.env.YUANBAO_APP_KEY, importPath: '../channels/yuanbao/index', exportKey: 'yuanbaoChannelPlugin' },
    { type: 'whatsapp', enabled: !!process.env.WHATSAPP_PHONE_NUMBER_ID && !!process.env.WHATSAPP_ACCESS_TOKEN, importPath: '../channels/whatsapp/index', exportKey: 'whatsAppChannelPlugin' },
    { type: 'signal', enabled: !!process.env.SIGNAL_ACCOUNT, importPath: '../channels/signal/index', exportKey: 'signalChannelPlugin' },
    { type: 'matrix', enabled: !!process.env.MATRIX_HOMESERVER_URL && !!process.env.MATRIX_ACCESS_TOKEN, importPath: '../channels/matrix/index', exportKey: 'matrixChannelPlugin' },
    { type: 'facebook', enabled: !!process.env.FACEBOOK_PAGE_ACCESS_TOKEN, importPath: '../channels/facebookmessenger/index', exportKey: 'facebookMessengerChannelPlugin' },
    { type: 'twitter', enabled: !!process.env.TWITTER_API_KEY && !!process.env.TWITTER_API_SECRET_KEY, importPath: '../channels/twitter/index', exportKey: 'twitterChannelPlugin' },
    { type: 'claude', enabled: !!process.env.CLAUDE_CHANNEL_ENABLED && !!process.env.CLAUDE_API_KEY, importPath: '../channels/claude/index', exportKey: 'claudeChannelPlugin' },
    { type: 'wechat-bot', enabled: !!process.env.WECHAT_ILINK_ENABLED, importPath: '../channels/wechat-bot/index', exportKey: 'wechatBotChannel' },
  ];

  const enabledDefs = channelCandidates.filter((c) => c.enabled);
  console.log(`[DIAG][${Date.now()}] setupChannelsFromConfig: 筛选完成 — ${enabledDefs.length}个启用, ${channelCandidates.length - enabledDefs.length}个跳过（环境变量未配置）`);

  if (enabledDefs.length === 0) {
    console.log(`[DIAG][${Date.now()}] setupChannelsFromConfig: 无启用的通道, 跳过`);
    logger.info('通道自动注册: 无启用的通道, 跳过');
    return { registered: 0, errors: [] };
  }

  // 第二步：按 CHANNEL_PRIORITY 排序 + 硬编码上限 3（WebSocket 通道资源占用高）
  // 未设置 CHANNEL_PRIORITY 时，按定义顺序取前 3 个
  const MAX_CHANNELS = 3;
  const priorityStr = process.env.CHANNEL_PRIORITY || '';

  let selectedDefs: typeof enabledDefs;
  if (priorityStr) {
    const priorityOrder = priorityStr.split(',').map((s) => s.trim().toLowerCase());
    const priorityMap = new Map(priorityOrder.map((t, i) => [t, i]));
    selectedDefs = enabledDefs
      .filter((d) => priorityMap.has(d.type))
      .sort((a, b) => (priorityMap.get(a.type) ?? 999) - (priorityMap.get(b.type) ?? 999))
      .slice(0, MAX_CHANNELS);
    const skippedUnprioritized = enabledDefs.filter((d) => !priorityMap.has(d.type)).length;
    if (skippedUnprioritized > 0) {
      logger.info(`CHANNEL_PRIORITY 未包含的通道跳过: ${skippedUnprioritized} 个`);
    }
  } else {
    selectedDefs = enabledDefs.slice(0, MAX_CHANNELS);
  }

  const totalSkipped = enabledDefs.length - selectedDefs.length;
  if (totalSkipped > 0) {
    const skippedTypes = enabledDefs
      .filter((d) => !selectedDefs.find((s) => s.type === d.type))
      .map((d) => d.type);
    logger.info(`通道上限 ${MAX_CHANNELS} 个, 跳过: ${skippedTypes.join(', ')}`);
  }
  console.log(`[DIAG][${Date.now()}] setupChannelsFromConfig: 优先级排序完成 — 最终选取 ${selectedDefs.length} 个通道`);

  // 第三步：仅导入选中的通道模块（并行导入）
  console.log(`[DIAG][${Date.now()}] setupChannelsFromConfig: 开始并行导入 ${selectedDefs.length} 个通道模块...`);
  const importResults = await Promise.allSettled(
    selectedDefs.map(async (def) => {
      const t1 = Date.now();
      const mod = await import(def.importPath);
      const factory = (mod as Record<string, unknown>)[def.exportKey];
      logger.info(`通道模块导入: ${def.type} (${Date.now() - t1}ms)`);
      return { type: def.type, factory, exportKey: def.exportKey };
    })
  );
  console.log(`[DIAG][${Date.now()}] setupChannelsFromConfig: 并行导入完成`);

  // 第四步：注册通道工厂 + 构建配置
  console.log(`[DIAG][${Date.now()}] setupChannelsFromConfig: 开始注册通道工厂...`);
  const errors: string[] = [];
  const configChannels: { type: string; enabled: boolean }[] = [];

  for (const result of importResults) {
    if (result.status === 'fulfilled') {
      const { type, factory, exportKey } = result.value;
      if (factory) {
        channelBootstrapper.registerPluginChannel(type, () => factory as IChannelPlugin);
        logger.info(`通道工厂已注册: ${type}`);
      } else {
        const msg = `通道 ${type} 模块已导入但未找到工厂属性 "${exportKey}"`;
        logger.warning(msg);
        errors.push(msg);
      }
      configChannels.push({ type, enabled: true });
    } else {
      const msg = `通道模块导入失败: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`;
      logger.warning(msg);
      errors.push(msg);
    }
  }
  console.log(`[DIAG][${Date.now()}] setupChannelsFromConfig: 工厂注册完成, 配置通道数=${configChannels.length}`);

  // 第五步：执行 bootstrap
  const config: ChannelBootstrapConfig = { channels: configChannels };
  console.log(`[DIAG][${Date.now()}] setupChannelsFromConfig: 开始 bootstrap...`);
  const result = await channelBootstrapper.bootstrap(config);
  console.log(`[DIAG][${Date.now()}] setupChannelsFromConfig: bootstrap 完成 (registered=${result.registered})`);

  if (result.registered > 0) {
    logger.info(`通道自动注册完成: ${result.registered} 通道已注册`);
  }

  // 第六步：返回（连接延迟到应用启动后由 lazyConnectChannels() 执行）
  console.log(`[DIAG][${Date.now()}] setupChannelsFromConfig: 函数返回, 总耗时=${Date.now() - t0}ms`);
  logger.info(`通道自动注册结束, 总耗时: ${Date.now() - t0}ms`);
  return result;
}

/**
 * 延迟连接所有已注册的通道
 * 在应用完全启动后在后台执行，不阻塞主流程
 * 每个通道带 5 秒超时保护
 */
export async function lazyConnectChannels(): Promise<void> {
  const t0 = Date.now();
  const channels = channelRegistry.getEnabled();
  if (channels.length === 0) {
    return;
  }

  console.log(`[DIAG][${Date.now()}] lazyConnectChannels: 开始后台连接 ${channels.length} 个通道...`);
  let connectedCount = 0;
  const errors: string[] = [];

  for (const channel of channels) {
    try {
      await Promise.race([
        channel.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`通道 ${channel.name} 连接超时 (5s)`)), 5000)
        ),
      ]);
      connectedCount++;
      logger.info(`通道已连接: ${channel.name}`);

      // 查找对应的 IChannelPlugin 实例，设置入站消息处理器
      const plugin = channelBootstrapper.getPluginInstance(channel.name);
      if (plugin?.inbound) {
        plugin.inbound.setMessageHandler(async (message: MessageContext) => {
          try {
            const coreAPI = getCoreAPI();
            const response = await coreAPI.chat({
              content: message.content,
              sessionId: message.conversationId ?? message.senderId,
              metadata: {
                channel: message.channelId,
                sender: message.senderId,
                messageType: message.messageType,
                isDirectMessage: message.isDirectMessage,
                rawPayload: message.rawPayload,
              },
            });

            if (response.content && plugin.outbound) {
              await plugin.outbound.sendText(
                message.conversationId ?? message.senderId,
                response.content
              );
            }
          } catch (error) {
            logger.error(`通道 ${channel.name} 入站消息处理失败`, {
              messageId: message.messageId,
              error: String(error),
            });
          }
        });
        logger.info(`通道入站消息处理器已注册: ${channel.name}`);
      }
    } catch (error) {
      const msg = `连接通道失败: ${channel.name} — ${error instanceof Error ? error.message : String(error)}`;
      logger.warning(msg);
      errors.push(msg);
    }
  }

  console.log(`[DIAG][${Date.now()}] lazyConnectChannels: 连接完成 (connected=${connectedCount}, failed=${errors.length}), 耗时=${Date.now() - t0}ms`);
  if (errors.length > 0) {
    logger.warning('延迟通道连接存在错误', { errors });
  }
}
