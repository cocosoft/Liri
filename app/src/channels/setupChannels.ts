/**
 * 通道自动注册集成函数
 * 将 channels/ 各平台实现自动注册到 ChannelRegistry
 * 优化：先检查环境变量配置，仅导入已启用的通道模块
 */
import { Logger, LogLevel } from '@modules/monitoring';
import { channelBootstrapper } from './bootstrap/ChannelBootstrapper';
import type { ChannelBootstrapConfig } from './bootstrap/ChannelBootstrapper';
import { channelRegistry } from './registry/ChannelRegistry';
import { initRegistry } from './secrets/ChannelSecretStore';
import { getCoreAPI } from '../runtime/api/CoreAPIImpl';
import type {
  IChannelPlugin,
  MessageContext,
  ChannelId,
} from './types/IChannel';
import { routeChannelMessage } from './routing/messageRouter';
import { configManager } from '@modules/config';
import { handleError } from '@modules/error';
import { getDeliveryRouter } from './DeliveryRouter';

const logger = new Logger({ level: LogLevel.INFO, module: 'channels:setup' });

// ─── Feature Flag: Inbox ↔ 渠道桥接开关 ───
/** 渠道 ↔ Inbox 桥接总开关（默认开启，显式设为 'false' 时关闭） */
export function isBridgeEnabled(): boolean {
  return process.env.INBOX_CHANNEL_BRIDGE_ENABLED !== 'false';
}
/** 渠道 ← Inbox 回复回传开关（默认开启，显式设为 'false' 时关闭） */
export function isReplyEnabled(): boolean {
  return process.env.INBOX_CHANNEL_REPLY_ENABLED !== 'false';
}
/** DeliveryRouter 统一出站开关（默认开启，显式设为 '0' 时切回旧 onOutbound 路径） */
export function useDeliveryRouterOutbound(): boolean {
  return process.env.DELIVERY_ROUTER_OUTBOUND !== '0';
}

/**
 * 全部支持的通道类型清单（含显示名称）
 * 用于前端列表展示，即使通道未注册也能显示在 UI 中
 */
export const ALL_CHANNEL_DEFS: Array<{ type: string; name: string }> = [
  { type: 'telegram', name: 'Telegram' },
  { type: 'discord', name: 'Discord' },
  { type: 'qq', name: 'QQ' },
  { type: 'dingtalk', name: '钉钉' },
  { type: 'feishu', name: '飞书' },
  { type: 'wechat', name: '微信' },
  { type: 'slack', name: 'Slack' },
  { type: 'line', name: 'Line' },
  { type: 'irc', name: 'IRC' },
  { type: 'nostr', name: 'Nostr' },
  { type: 'email', name: '邮件' },
  { type: 'sms', name: '短信' },
  { type: 'webhook', name: 'Webhook' },
  { type: 'wecom', name: '企业微信' },
  { type: 'googlechat', name: 'Google Chat' },
  { type: 'msteams', name: 'MS Teams' },
  { type: 'zalo', name: 'Zalo' },
  { type: 'yuanbao', name: '元宝' },
  { type: 'whatsapp', name: 'WhatsApp' },
  { type: 'signal', name: 'Signal' },
  { type: 'matrix', name: 'Matrix' },
  { type: 'facebook', name: 'Facebook Messenger' },
  { type: 'twitter', name: 'Twitter/X' },
  { type: 'claude', name: 'Claude' },
  { type: 'mattermost', name: 'Mattermost' },
  { type: 'bluebubbles', name: 'iMessage' },
];

/**
 * 根据配置自动注册 IChannelPlugin 通道
 * 读取环境变量确定哪些通道已启用，仅导入已启用的通道模块
 */
export async function setupChannelsFromConfig(): Promise<{
  registered: number;
  errors: string[];
}> {
  const t0 = Date.now();

  // 初始化 ChannelSecretStore 的 channelRegistry 引用
  initRegistry(channelRegistry);

  // 第一步：定义通道映射 + 筛选已启用的通道
  // 注意：import() 路径定义在函数内部而非模块顶层，避免 Bun 预解析所有路径
  const channelCandidates: Array<{
    type: string;
    enabled: boolean;
    importPath: string;
    exportKey: string;
  }> = [
    {
      type: 'telegram',
      enabled: !!configManager.env('TELEGRAM_BOT_TOKEN'),
      importPath: '../channels/telegram/TelegramChannel',
      exportKey: 'telegramChannel',
    },
    {
      type: 'discord',
      enabled: !!configManager.env('DISCORD_TOKEN'),
      importPath: '../channels/discord/DiscordChannel',
      exportKey: 'discordChannel',
    },
    {
      type: 'qq',
      enabled:
        !!configManager.env('QQ_APP_ID') &&
        !!configManager.env('QQ_APP_SECRET'),
      importPath: '../channels/qq/QQChannel',
      exportKey: 'qqChannel',
    },
    {
      type: 'dingtalk',
      enabled:
        !!configManager.env('DINGTALK_APP_KEY') &&
        !!configManager.env('DINGTALK_APP_SECRET'),
      importPath: '../channels/dingtalk/DingTalkChannel',
      exportKey: 'dingtalkChannel',
    },
    {
      type: 'feishu',
      enabled:
        !!configManager.env('FEISHU_APP_ID') &&
        !!configManager.env('FEISHU_APP_SECRET'),
      importPath: '../channels/feishu/FeishuChannel',
      exportKey: 'feishuChannel',
    },
    {
      type: 'wechat',
      enabled: !!configManager.env('WECHAT_BOT_HTTP_URL'),
      importPath: '../channels/wechat/WechatChannel',
      exportKey: 'wechatChannel',
    },
    {
      type: 'slack',
      enabled:
        !!configManager.env('SLACK_BOT_TOKEN') &&
        !!configManager.env('SLACK_SIGNING_SECRET'),
      importPath: '../channels/slack/index',
      exportKey: 'slackChannelPlugin',
    },
    {
      type: 'line',
      enabled:
        !!configManager.env('LINE_CHANNEL_ACCESS_TOKEN') &&
        !!configManager.env('LINE_CHANNEL_SECRET'),
      importPath: '../channels/line/index',
      exportKey: 'lineChannelPlugin',
    },
    {
      type: 'irc',
      enabled:
        !!configManager.env('IRC_SERVER') && !!configManager.env('IRC_NICK'),
      importPath: '../channels/irc/index',
      exportKey: 'ircChannelPlugin',
    },
    {
      type: 'nostr',
      enabled:
        !!configManager.env('NOSTR_PRIVATE_KEY') ||
        !!configManager.env('NOSTR_RELAYS'),
      importPath: '../channels/nostr/index',
      exportKey: 'nostrChannelPlugin',
    },
    {
      type: 'email',
      enabled:
        !!configManager.env('EMAIL_HOST') && !!configManager.env('EMAIL_USER'),
      importPath: '../channels/email/EmailChannel',
      exportKey: 'emailChannelPlugin',
    },
    {
      type: 'sms',
      enabled: !!configManager.env('SMS_FROM_NUMBER'),
      importPath: '../channels/sms/SmsChannel',
      exportKey: 'smsChannelPlugin',
    },
    {
      type: 'webhook',
      enabled: !!configManager.env('WEBHOOK_LISTEN_PORT'),
      importPath: '../channels/webhook/WebhookChannel',
      exportKey: 'webhookChannelPlugin',
    },
    {
      type: 'wecom',
      enabled:
        !!configManager.env('WECOM_CORP_ID') &&
        !!configManager.env('WECOM_CORP_SECRET') &&
        !!configManager.env('WECOM_AGENT_ID'),
      importPath: '../channels/wecom/WeComChannel',
      exportKey: 'wecomChannel',
    },
    {
      type: 'googlechat',
      enabled: !!configManager.env('GOOGLECHAT_SERVICE_ACCOUNT'),
      importPath: '../channels/googlechat/index',
      exportKey: 'googleChatChannelPlugin',
    },
    {
      type: 'msteams',
      enabled:
        !!configManager.env('MSTEAMS_BOT_ID') &&
        !!configManager.env('MSTEAMS_BOT_PASSWORD'),
      importPath: '../channels/msteams/index',
      exportKey: 'msteamsChannelPlugin',
    },
    {
      type: 'zalo',
      enabled:
        !!configManager.env('ZALO_APP_ID') &&
        !!configManager.env('ZALO_APP_SECRET'),
      importPath: '../channels/zalo/index',
      exportKey: 'zaloChannelPlugin',
    },
    {
      type: 'yuanbao',
      enabled:
        !!configManager.env('YUANBAO_APP_ID') &&
        !!configManager.env('YUANBAO_APP_KEY'),
      importPath: '../channels/yuanbao/index',
      exportKey: 'yuanbaoChannelPlugin',
    },
    {
      type: 'whatsapp',
      enabled:
        !!configManager.env('WHATSAPP_PHONE_NUMBER_ID') &&
        !!configManager.env('WHATSAPP_ACCESS_TOKEN'),
      importPath: '../channels/whatsapp/index',
      exportKey: 'whatsAppChannelPlugin',
    },
    {
      type: 'signal',
      enabled: !!configManager.env('SIGNAL_ACCOUNT'),
      importPath: '../channels/signal/index',
      exportKey: 'signalChannelPlugin',
    },
    {
      type: 'matrix',
      enabled:
        !!configManager.env('MATRIX_HOMESERVER_URL') &&
        !!configManager.env('MATRIX_ACCESS_TOKEN'),
      importPath: '../channels/matrix/index',
      exportKey: 'matrixChannelPlugin',
    },
    {
      type: 'facebook',
      enabled: !!configManager.env('FACEBOOK_PAGE_ACCESS_TOKEN'),
      importPath: '../channels/facebookmessenger/index',
      exportKey: 'facebookMessengerChannelPlugin',
    },
    {
      type: 'twitter',
      enabled:
        !!configManager.env('TWITTER_API_KEY') &&
        !!configManager.env('TWITTER_API_SECRET_KEY'),
      importPath: '../channels/twitter/index',
      exportKey: 'twitterChannelPlugin',
    },
    {
      type: 'claude',
      enabled:
        !!configManager.env('CLAUDE_CHANNEL_ENABLED') &&
        !!configManager.env('CLAUDE_API_KEY'),
      importPath: '../channels/claude/index',
      exportKey: 'claudeChannelPlugin',
    },
    {
      type: 'mattermost',
      enabled:
        !!configManager.env('MATTERMOST_URL') &&
        !!configManager.env('MATTERMOST_TOKEN'),
      importPath: '../channels/mattermost/MattermostChannel',
      exportKey: 'mattermostChannel',
    },
    {
      type: 'bluebubbles',
      enabled:
        !!configManager.env('BLUEBUBBLES_URL') &&
        !!configManager.env('BLUEBUBBLES_PASSWORD'),
      importPath: '../channels/bluebubbles/BlueBubblesChannel',
      exportKey: 'bluebubblesChannelPlugin',
    },
  ];

  const enabledDefs = channelCandidates.filter((c) => c.enabled);

  // 补充：DB 中已持久化且有实际凭据配置的通道也视为"已启用"（凭据来自前端保存，不依赖 .env）
  // 仅当通道的 options 非空时才启用，避免"已启用但无凭据"的空壳状态
  const persistedConfigs = channelRegistry.getAllConfigs();
  const persistedTypesWithCredentials = new Set(
    persistedConfigs
      .filter(
        (cfg) =>
          cfg.enabled && cfg.options && Object.keys(cfg.options).length > 0
      )
      .map((cfg) => cfg.type)
  );
  const dbEnabledDefs: typeof channelCandidates = [];
  for (const candidate of channelCandidates) {
    if (
      !candidate.enabled &&
      persistedTypesWithCredentials.has(candidate.type)
    ) {
      dbEnabledDefs.push({ ...candidate, enabled: true });
    }
  }
  const allEnabledDefs = [...enabledDefs, ...dbEnabledDefs];

  if (allEnabledDefs.length === 0) {
    logger.info('通道自动注册: 无启用的通道, 跳过');
    return { registered: 0, errors: [] };
  }

  // DB 来源的通道不受 MAX_CHANNELS 限制（前端显式配置的凭据 → 始终注册）
  const MAX_CHANNELS = parseInt(
    configManager.env('CHANNEL_MAX_COUNT') || '10',
    10
  );
  const priorityStr = configManager.env('CHANNEL_PRIORITY') || '';

  logger.info(
    `通道上限配置: ${MAX_CHANNELS} 个（可通过 CHANNEL_MAX_COUNT 环境变量调整）`
  );

  // 环境变量通道按优先级选择（上限 MAX_CHANNELS）
  let selectedEnvDefs: typeof channelCandidates;
  if (priorityStr) {
    const priorityOrder = priorityStr
      .split(',')
      .map((s) => s.trim().toLowerCase());
    const priorityMap = new Map(priorityOrder.map((t, i) => [t, i]));
    selectedEnvDefs = enabledDefs
      .filter((d) => priorityMap.has(d.type))
      .sort(
        (a, b) =>
          (priorityMap.get(a.type) ?? 999) - (priorityMap.get(b.type) ?? 999)
      )
      .slice(0, MAX_CHANNELS);
    const skippedUnprioritized = enabledDefs.filter(
      (d) => !priorityMap.has(d.type)
    ).length;
    if (skippedUnprioritized > 0) {
      logger.info(
        `CHANNEL_PRIORITY 未包含的通道跳过: ${skippedUnprioritized} 个`
      );
    }
  } else {
    selectedEnvDefs = enabledDefs.slice(0, MAX_CHANNELS);
  }

  // DB 来源通道 + 环境变量通道（去重：DB 优先）
  const envTypes = new Set(selectedEnvDefs.map((d) => d.type));
  const dedupedDbDefs = dbEnabledDefs.filter((d) => !envTypes.has(d.type));
  const selectedDefs = [...dedupedDbDefs, ...selectedEnvDefs];

  if (dbEnabledDefs.length > 0) {
    logger.info(
      `DB 持久化通道自动注册: ${dbEnabledDefs.map((d) => d.type).join(', ')}`
    );
  }

  const totalEnvSkipped = enabledDefs.length - selectedEnvDefs.length;
  if (totalEnvSkipped > 0) {
    const skippedTypes = enabledDefs
      .filter((d) => !selectedEnvDefs.find((s) => s.type === d.type))
      .map((d) => d.type);
    logger.info(
      `通道上限 ${MAX_CHANNELS} 个, 跳过: ${skippedTypes.join(', ')}`
    );
  }
  // 第三步：仅导入选中的通道模块（并行导入）
  const importResults = await Promise.allSettled(
    selectedDefs.map(async (def) => {
      const t1 = Date.now();
      const mod = await import(def.importPath);
      const factory = (mod as Record<string, unknown>)[def.exportKey];
      logger.info(`通道模块导入: ${def.type} (${Date.now() - t1}ms)`);
      return { type: def.type, factory, exportKey: def.exportKey };
    })
  );

  // 第四步：注册通道工厂 + 构建配置
  const errors: string[] = [];
  const configChannels: { type: string; enabled: boolean }[] = [];

  for (const result of importResults) {
    if (result.status === 'fulfilled') {
      const { type, factory, exportKey } = result.value;
      if (factory) {
        channelBootstrapper.registerPluginChannel(
          type,
          () => factory as IChannelPlugin
        );
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

  // 第五步：过滤已被 Gateway 系统（ChannelManager）管理的通道，避免双注册
  const gatewayManagedNames = new Set(
    channelRegistry.getAll().map((c) => c.name)
  );
  const preFilterCount = configChannels.length;
  const filteredChannels = configChannels.filter(
    (c) => !gatewayManagedNames.has(c.type)
  );
  const skippedCount = preFilterCount - filteredChannels.length;
  if (skippedCount > 0) {
    const skipped = configChannels
      .filter((c) => gatewayManagedNames.has(c.type))
      .map((c) => c.type);
    logger.info(`跳过已被 Gateway 系统管理的通道: ${skipped.join(', ')}`);
  }

  // 第六步：执行 bootstrap
  const config: ChannelBootstrapConfig = { channels: filteredChannels };
  const result = await channelBootstrapper.bootstrap(config);

  if (result.registered > 0) {
    logger.info(`通道自动注册完成: ${result.registered} 通道已注册`);
  }

  // 第七步：返回（连接延迟到应用启动后由 lazyConnectChannels() 执行）
  logger.info(`通道自动注册结束, 总耗时: ${Date.now() - t0}ms`);
  return result;
}

/** lazyConnectChannels 是否已执行过（防重复连接守卫） */
let _channelsConnected = false;

/**
 * 延迟连接所有已注册的通道
 * 在应用完全启动后在后台执行，不阻塞主流程
 * 每个通道带 5 秒超时保护
 * 内置防重复执行守卫（_channelsConnected），确保只连接一次
 */
export async function lazyConnectChannels(): Promise<void> {
  if (_channelsConnected) {
    return;
  }
  _channelsConnected = true;

  const t0 = Date.now();
  const channels = channelRegistry.getEnabled();
  if (channels.length === 0) {
    return;
  }

  logger.info(`lazyConnectChannels: 开始后台连接 ${channels.length} 个通道...`);
  let connectedCount = 0;
  const errors: string[] = [];

  for (const channel of channels) {
    // 查找对应的 IChannelPlugin 实例
    const plugin = channelBootstrapper.getPluginInstance(channel.name);

    // 跳过已被 Gateway 系统（ChannelManager）管理的通道
    // 这些通道已在 setupGatewayFromConfig 中注册并连接，由 ChannelManager 负责消息路由
    if (!plugin) {
      logger.info(
        `lazyConnectChannels: 跳过 Gateway 管理的通道 — ${channel.name}`
      );
      continue;
    }

    try {
      // 必须在 connect() 之前注册 messageHandler，否则连接建立后立即到达的消息会因
      // handler 未注册而被丢弃（'hasHandler: false' → 消息丢弃日志）
      if (plugin.inbound) {
        plugin.inbound.setMessageHandler(async (message: MessageContext) => {
          logger.info('[TRACE] setupChannels messageHandler 被调用', {
            channelName: channel.name,
            messageId: message.messageId,
            senderId: message.senderId,
            hasCoreAPI: !!getCoreAPI(),
          });
          // 终端回显：显示来源通道、发送者、消息内容
          const senderDisplay =
            message.senderName || message.senderId || 'unknown';
          logger.info(
            `── [${channel.name.toUpperCase()}] ${senderDisplay} ──\n${message.content}`,
            { module: 'channels:setup' }
          );

          const coreAPI = getCoreAPI();
          const result = await routeChannelMessage(message, {
            coreAPI,
            channelName: channel.name,
            enableTracing: true,
            onOutbound: async (content, target) => {
              logger.info('[TRACE] setupChannels onOutbound 回调被调用', {
                channelName: channel.name,
                target,
                contentLength: content.length,
                hasOutbound: !!plugin.outbound,
              });

              // AI 回复回显
              logger.info(
                `── [${channel.name.toUpperCase()}] Liri ──\n${content}`,
                { module: 'channels:setup' }
              );

              if (useDeliveryRouterOutbound()) {
                // Phase 2: 走 DeliveryRouter 统一出站路径（降级、并发控制、OTel 追踪）
                try {
                  const router = getDeliveryRouter();
                  const result = await router.deliverToOrigin(
                    channel.name as ChannelId,
                    target,
                    { format: 'text', content }
                  );
                  logger.info('[TRACE] setupChannels DeliveryRouter 返回', {
                    channelName: channel.name,
                    success: result.success,
                    actualFormat: result.actualFormat,
                    fallbackSteps: result.fallbackSteps,
                    durationMs: result.durationMs,
                  });
                  if (!result.success) {
                    logger.warning(
                      `通道 ${channel.name} 消息发送失败 (DeliveryRouter)`,
                      {
                        target,
                        error: result.error,
                        fallbackSteps: result.fallbackSteps,
                      }
                    );
                  }
                } catch (sendError) {
                  handleError(sendError, {
                    module: 'channels:setup',
                    action: 'inbound:deliveryRouter',
                    context: { target, channelName: channel.name },
                  });
                }
              } else if (plugin.outbound) {
                try {
                  logger.info(
                    '[TRACE] setupChannels 调用 plugin.outbound.sendText',
                    {
                      channelName: channel.name,
                      target,
                    }
                  );
                  const sendResult = await plugin.outbound.sendText(
                    target,
                    content
                  );
                  logger.info('[TRACE] setupChannels sendText 返回', {
                    channelName: channel.name,
                    success: sendResult.success,
                    error: sendResult.error,
                    messageId: sendResult.messageId,
                  });
                  if (!sendResult.success) {
                    logger.warning(`通道 ${channel.name} 消息发送失败`, {
                      target,
                      error: sendResult.error,
                      messageId: sendResult.messageId,
                    });
                  }
                } catch (sendError) {
                  handleError(sendError, {
                    module: 'channels:setup',
                    action: 'inbound:sendMessage',
                    context: { target, channelName: channel.name },
                  });
                }
              } else {
                logger.warning(
                  `通道 ${channel.name} 缺少 outbound 适配器，AI 回复无法发送到渠道`,
                  { target, channelName: channel.name }
                );
              }
            },
          });

          if (!result.valid) {
            logger.warning('消息路由返回无效结果', {
              channel: channel.name,
              messageId: message.messageId,
              errorCode: result.errorCode,
              errorMessage: result.errorMessage,
            });
          }
        });
        logger.info(`通道入站消息处理器已注册: ${channel.name}`);
      }

      // handler 已注册，现在建立连接。连接后到达的 WS 消息将能正确路由到 messageHandler
      await Promise.race([
        channel.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`通道 ${channel.name} 连接超时 (5s)`)),
            5000
          )
        ),
      ]);
      connectedCount++;
      logger.info(`通道已连接: ${channel.name}`);
    } catch (error) {
      handleError(error, {
        module: 'channels:setup',
        action: 'lazyConnectChannels',
        context: { channelName: channel.name },
      });
      errors.push(
        `连接通道失败: ${channel.name} — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  logger.info(
    `lazyConnectChannels: 连接完成 (connected=${connectedCount}, failed=${errors.length}), 耗时=${Date.now() - t0}ms`
  );
  if (errors.length > 0) {
    logger.warning('延迟通道连接存在错误', { errors });
  }
}
