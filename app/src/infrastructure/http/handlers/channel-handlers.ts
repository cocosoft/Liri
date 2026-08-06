// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/* eslint-disable @typescript-eslint/no-explicit-any -- legacy code with dynamic types */

import type http from 'http';
import { sendError, readRequestBody, type HandlerCtx } from './handler-utils';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';

const logger = new Logger({
  module: 'infrastructure:http:handlers:channel-handlers',
  level: LogLevel.INFO,
});

/**
 * 获取渠道解密后的配置（P0-4：DB 中敏感字段为密文，回显/恢复/合并前统一解密）
 */
async function getDecryptedOptions(
  channelId: string
): Promise<Record<string, unknown>> {
  const { ChannelSecretStore } =
    await import('@modules/channels/secrets/ChannelSecretStore');
  return ChannelSecretStore.getInstance().get(channelId);
}

// ========== Channel Dynamic Registration Table ==========

const CHANNEL_TABLE: Array<{
  type: string;
  name: string;
  importPath: string;
  exportKey: string;
}> = [
  {
    type: 'telegram',
    name: 'Telegram',
    importPath: '../../../channels/telegram/TelegramChannel',
    exportKey: 'telegramChannel',
  },
  {
    type: 'discord',
    name: 'Discord',
    importPath: '../../../channels/discord/DiscordChannel',
    exportKey: 'discordChannel',
  },
  {
    type: 'qq',
    name: 'QQ',
    importPath: '../../../channels/qq/QQChannel',
    exportKey: 'qqChannel',
  },
  {
    type: 'dingtalk',
    name: '钉钉',
    importPath: '../../../channels/dingtalk/DingTalkChannel',
    exportKey: 'dingtalkChannel',
  },
  {
    type: 'feishu',
    name: '飞书',
    importPath: '../../../channels/feishu/FeishuChannel',
    exportKey: 'feishuChannel',
  },
  {
    type: 'wechat',
    name: '微信',
    importPath: '../../../channels/wechat/WechatChannel',
    exportKey: 'wechatChannel',
  },
  {
    type: 'slack',
    name: 'Slack',
    importPath: '../../../channels/slack/index',
    exportKey: 'slackChannelPlugin',
  },
  {
    type: 'line',
    name: 'Line',
    importPath: '../../../channels/line/index',
    exportKey: 'lineChannelPlugin',
  },
  {
    type: 'irc',
    name: 'IRC',
    importPath: '../../../channels/irc/index',
    exportKey: 'ircChannelPlugin',
  },
  {
    type: 'nostr',
    name: 'Nostr',
    importPath: '../../../channels/nostr/index',
    exportKey: 'nostrChannelPlugin',
  },
  {
    type: 'email',
    name: '邮件',
    importPath: '../../../channels/email/EmailChannel',
    exportKey: 'emailChannelPlugin',
  },
  {
    type: 'sms',
    name: '短信',
    importPath: '../../../channels/sms/SmsChannel',
    exportKey: 'smsChannelPlugin',
  },
  {
    type: 'webhook',
    name: 'Webhook',
    importPath: '../../../channels/webhook/WebhookChannel',
    exportKey: 'webhookChannelPlugin',
  },
  {
    type: 'wecom',
    name: '企业微信',
    importPath: '../../../channels/wecom/WeComChannel',
    exportKey: 'wecomChannel',
  },
  {
    type: 'googlechat',
    name: 'Google Chat',
    importPath: '../../../channels/googlechat/index',
    exportKey: 'googleChatChannelPlugin',
  },
  {
    type: 'msteams',
    name: 'MS Teams',
    importPath: '../../../channels/msteams/index',
    exportKey: 'msteamsChannelPlugin',
  },
  {
    type: 'zalo',
    name: 'Zalo',
    importPath: '../../../channels/zalo/index',
    exportKey: 'zaloChannelPlugin',
  },
  {
    type: 'yuanbao',
    name: '元宝',
    importPath: '../../../channels/yuanbao/index',
    exportKey: 'yuanbaoChannelPlugin',
  },
  {
    type: 'whatsapp',
    name: 'WhatsApp',
    importPath: '../../../channels/whatsapp/index',
    exportKey: 'whatsAppChannelPlugin',
  },
  {
    type: 'signal',
    name: 'Signal',
    importPath: '../../../channels/signal/index',
    exportKey: 'signalChannelPlugin',
  },
  {
    type: 'matrix',
    name: 'Matrix',
    importPath: '../../../channels/matrix/index',
    exportKey: 'matrixChannelPlugin',
  },
  {
    type: 'facebook',
    name: 'Facebook Messenger',
    importPath: '../../../channels/facebookmessenger/index',
    exportKey: 'facebookMessengerChannelPlugin',
  },
  {
    type: 'twitter',
    name: 'Twitter/X',
    importPath: '../../../channels/twitter/index',
    exportKey: 'twitterChannelPlugin',
  },
  {
    type: 'claude',
    name: 'Claude',
    importPath: '../../../channels/claude/index',
    exportKey: 'claudeChannelPlugin',
  },
  {
    type: 'mattermost',
    name: 'Mattermost',
    importPath: '../../../channels/mattermost/MattermostChannel',
    exportKey: 'mattermostChannel',
  },
  {
    type: 'bluebubbles',
    name: 'iMessage',
    importPath: '../../../channels/bluebubbles/BlueBubblesChannel',
    exportKey: 'bluebubblesChannelPlugin',
  },
];

/** CHANNEL_TABLE 的快速索引 */
function getChannelEntry(type: string) {
  return CHANNEL_TABLE.find((e) => e.type === type);
}

// ========== Channel Handlers ==========

/**
 * 列出所有通道
 */
export async function handleListChannels(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { channelRegistry } =
      await import('@modules/channels/registry/ChannelRegistry');
    const { ALL_CHANNEL_DEFS } =
      await import('@modules/channels/setupChannels');

    // 已注册通道 → map
    const registeredMap = new Map<string, any>();
    for (const ch of channelRegistry.getAll()) {
      const cfg = channelRegistry.getConfig(ch.name);
      registeredMap.set(ch.name, {
        id: ch.name,
        name: ch.name,
        type: ch.type,
        // 优先使用 DB 持久化的 enabled 状态，而非 ChannelInterface 的硬编码值
        enabled: cfg?.enabled ?? ch.enabled,
        connected: (ch as any).connected ?? false,
        // P0-4：敏感字段密文落库，回显前解密
        config: cfg?.options ? await getDecryptedOptions(ch.name) : {},
      });
    }

    // 合并：全部候选 + 已注册数据
    const result = ALL_CHANNEL_DEFS.map((def) => {
      const registered = registeredMap.get(def.type);
      if (registered) {
        // 已注册的保留实际数据，但名使用定义中的显示名
        return { ...registered, name: def.name, registered: true };
      }
      // 未注册的显示为已知但未配置
      return {
        id: def.type,
        name: def.name,
        type: def.type,
        enabled: false,
        connected: false,
        registered: false,
        config: {},
      };
    });

    // 追加注册了但不在候选表中的通道（如有）
    for (const [name, reg] of registeredMap) {
      if (!ALL_CHANNEL_DEFS.some((d) => d.type === name)) {
        result.push(reg);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 获取通道详情
 */
export async function handleGetChannel(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  channelId: string
): Promise<void> {
  try {
    const { channelRegistry } =
      await import('@modules/channels/registry/ChannelRegistry');
    const channel = channelRegistry.get(channelId);
    if (!channel) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Channel not found' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: channel.name,
        name: channel.name,
        type: channel.type,
        enabled: channel.enabled,
        connected: channel.connected,
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 切换通道启用状态
 */
export async function handleToggleChannel(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  channelId: string,
  broadcastEvent?: (event: string, data: Record<string, unknown>) => void
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { enabled } = JSON.parse(body);
    const { channelRegistry } =
      await import('@modules/channels/registry/ChannelRegistry');
    const channel = channelRegistry.get(channelId);
    if (!channel) {
      // 尝试动态注册（可能 registry 状态已丢失）
      const dynRegistered = await tryDynamicRegister(channelId, undefined);
      if (!dynRegistered) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Channel not found' } }));
        return;
      }
    }
    // 先持久化 enabled 状态（确保重启后恢复）
    channelRegistry.updateConfig(channelId, { enabled });

    if (enabled) {
      const connectSuccess = await channelRegistry.connect(channelId);
      if (!connectSuccess) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            id: channelId,
            enabled: false,
            error: {
              message: `通道 ${channelId} 连接失败，请检查配置是否正确`,
            },
          })
        );
        return;
      }
    } else {
      await channelRegistry.disconnect(channelId);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, id: channelId, enabled }));
    broadcastEvent?.('channel:toggled', { id: channelId, enabled });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 删除通道
 */
export async function handleDeleteChannel(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  channelId: string,
  broadcastEvent?: (event: string, data: Record<string, unknown>) => void
): Promise<void> {
  try {
    const { channelRegistry } =
      await import('@modules/channels/registry/ChannelRegistry');
    const result = channelRegistry.unregister(channelId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: result }));
    broadcastEvent?.('channel:deleted', { id: channelId });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 更新通道配置
 */
export async function handleUpdateChannel(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  channelId: string,
  broadcastEvent?: (event: string, data: Record<string, unknown>) => void
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const parsedBody = body ? JSON.parse(body) : {};
    const { enabled, name, config } = parsedBody;

    // 仅切换启用/禁用
    if (enabled === undefined && name === undefined && config === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'At least one of enabled/name/config is required',
          },
        })
      );
      return;
    }

    const { channelRegistry } =
      await import('@modules/channels/registry/ChannelRegistry');
    const channel = channelRegistry.get(channelId);
    if (!channel) {
      // 尝试动态注册：前端凭据足够时自动创建并注册通道插件
      const dynRegistered = await tryDynamicRegister(
        channelId,
        config as Record<string, unknown> | undefined,
        broadcastEvent
      );
      if (!dynRegistered) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Channel not found' } }));
        return;
      }
    }

    // 更新配置
    const channelAfterDyn = channelRegistry.get(channelId)!;
    channelRegistry.updateConfig(channelId, {
      name: name,
      enabled: enabled,
      options: config as Record<string, unknown> | undefined,
    });

    // 同步写入统一凭据存储（使 ChannelSecretStore 查询可用）
    if (
      config &&
      typeof config === 'object' &&
      Object.keys(config).length > 0
    ) {
      const { ChannelSecretStore } =
        await import('@modules/channels/secrets/ChannelSecretStore');
      ChannelSecretStore.getInstance().set(
        channelId,
        config as Record<string, unknown>
      );
    }

    // 如果 enabled 有变化，执行连接/断开
    if (enabled !== undefined) {
      if (enabled) {
        await channelRegistry.connect(channelId);
      } else {
        await channelRegistry.disconnect(channelId);
      }
    }

    // 读取最新状态
    const latestConfig = channelRegistry.getConfig(channelId);
    const latestChannel = channelRegistry.get(channelId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: channelId,
        name: name || channelAfterDyn.name,
        type: channelAfterDyn.type,
        enabled: enabled !== undefined ? enabled : channelAfterDyn.enabled,
        connected: latestChannel?.connected ?? channelAfterDyn.connected,
        registered: true,
        // P0-4：DB 中敏感字段为密文，回显解密
        config: latestConfig?.options
          ? await getDecryptedOptions(channelId)
          : {},
      })
    );

    broadcastEvent?.('channel:updated', { id: channelId, enabled, name });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 批量应用通道配置
 */
export async function handleApplyChannelConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { channelRegistry } =
      await import('@modules/channels/registry/ChannelRegistry');

    // 获取所有已持久化的配置
    const savedConfigs = channelRegistry.getAllConfigs();

    // 对每个已保存但未注册的通道，尝试动态注册
    let registeredCount = 0;
    for (const config of savedConfigs) {
      const existing = channelRegistry.get(config.type);
      if (!existing) {
        // P0-4：DB 中敏感字段为密文，动态注册前解密（否则 applyConfig 拿到密文连接失败）
        const decrypted = await getDecryptedOptions(config.type);
        const dynRegistered = await tryDynamicRegister(config.type, decrypted);
        if (dynRegistered) {
          registeredCount++;
          // 恢复持久化的配置（含 enabled 状态）——options 保留原样（密文或明文）
          channelRegistry.updateConfig(config.type, {
            name: config.name,
            enabled: config.enabled,
            options: config.options,
          });
        }
      }
    }

    // 连接所有已启用的通道
    const enabledChannels = channelRegistry.getEnabled();
    let connectedCount = 0;
    const errors: string[] = [];

    for (const channel of enabledChannels) {
      try {
        await channel.connect();
        connectedCount++;
      } catch (e) {
        const msg = `连接通道失败: ${channel.name} — ${e instanceof Error ? e.message : String(e)}`;
        logger.warning(msg);
        errors.push(msg);
      }
    }

    logger.info('通道配置应用完成', {
      registered: registeredCount,
      connected: connectedCount,
      errors: errors.length,
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        success: true,
        registered: registeredCount,
        connected: connectedCount,
        errors: errors.length > 0 ? errors : undefined,
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:channel',
      action: 'apply_channel_config',
    });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: {
          message: '配置应用失败',
          detail: err instanceof Error ? err.message : String(err),
        },
      })
    );
  }
}

// ========== Channel Registration Helpers ==========

/**
 * 尝试动态注册未注册的通道（前端提供凭据时自动注册）
 */
async function tryDynamicRegister(
  channelType: string,
  config?: Record<string, unknown>,
  _broadcastEvent?: (event: string, data: Record<string, unknown>) => void
): Promise<boolean> {
  const entry = getChannelEntry(channelType);
  if (!entry) return false;

  try {
    // 动态导入插件模块
    const mod = await import(entry.importPath);
    const plugin = (mod as Record<string, unknown>)[entry.exportKey] as any;
    if (!plugin) {
      logger.warning(
        `tryDynamicRegister: 未找到插件导出 — ${channelType}/${entry.exportKey}`
      );
      return false;
    }

    // 1. 注册到 ChannelRegistry
    const { channelRegistry, adaptPluginToInterface } =
      await import('@modules/channels/registry/ChannelRegistry');
    channelRegistry.register(adaptPluginToInterface(plugin));

    // 2. 注册到 ChannelBootstrapper
    const { channelBootstrapper } =
      await import('../../../channels/bootstrap/ChannelBootstrapper');
    channelBootstrapper.registerPluginChannel(channelType, () => plugin);

    // 3. 写入配置（合并前端传入的凭据）
    // P0-4：已存配置可能为密文，先解密再与前端明文合并，最后统一加密落库
    const { encryptOptions } =
      await import('@modules/channels/secrets/encryption');
    const existingDecrypted = await getDecryptedOptions(channelType);
    channelRegistry.updateConfig(channelType, {
      name: entry.name,
      enabled: false,
      options: encryptOptions({
        ...existingDecrypted,
        ...(config || {}),
      }),
    });

    // 4. 绑定入站消息处理器
    bindInboundHandler(channelType, plugin);

    return true;
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:channel',
      action: 'try_dynamic_register',
      context: { channelType },
    });
    return false;
  }
}

/** 绑定入站消息 → AI → 出站 回路 */
function bindInboundHandler(channelType: string, plugin: any): void {
  if (!plugin.inbound) return;

  const _processingMessages = new Set<string>();

  /** 跟踪待重试的出站回复（用于断点恢复） */
  const _pendingOutboundReplies = new Map<
    string,
    {
      target: string;
      content: string;
      retryCount: number;
      lastAttemptAt: number;
      channelType: string;
    }
  >();

  /** 定期重试待发送的失败回复 */
  let _retryTimer: ReturnType<typeof setInterval> | null = null;
  function schedulePendingFlush(): void {
    if (_retryTimer) return;
    _retryTimer = setInterval(async () => {
      if (_pendingOutboundReplies.size === 0) return;
      const now = Date.now();
      for (const [key, pending] of _pendingOutboundReplies) {
        // 至少等待 10 秒再重试
        if (now - pending.lastAttemptAt < 10_000) continue;
        pending.lastAttemptAt = now;
        try {
          await plugin.outbound.sendText(pending.target, pending.content);
          _pendingOutboundReplies.delete(key);
          logger.info(`[${channelType}] 待发送消息重试成功`, { key });
        } catch (err) {
          pending.retryCount++;
          if (pending.retryCount >= 3) {
            _pendingOutboundReplies.delete(key);
            void handleError(err, {
              module: 'infra:handler:channel',
              action: 'outbound_retry_exhausted',
              context: {
                channelType,
                target: pending.target,
                retryCount: pending.retryCount,
              },
            });
          } else {
            logger.warn(
              `[${channelType}] 消息发送重试 ${pending.retryCount}/3 失败`,
              {
                error: String(err),
              }
            );
          }
        }
      }
      // 全部完成则停止定时器
      if (_pendingOutboundReplies.size === 0 && _retryTimer) {
        clearInterval(_retryTimer);
        _retryTimer = null;
      }
    }, 15_000);
  }

  plugin.inbound.setMessageHandler(async (message: any) => {
    // 帧级去重兜底（routeChannelMessage 内部另有 messageId/内容级去重）
    if (_processingMessages.has(message.messageId)) return;
    _processingMessages.add(message.messageId);

    try {
      const sender = message.senderName || message.senderId || 'unknown';
      const label = channelType.toUpperCase();
      logger.info(`[${label}] ${sender}`, { content: message.content });

      const coreAPI = getCoreAPI();

      // 2026-08-06（P0-3）：动态注册通道统一走 routeChannelMessage 单管线，
      // 与 env 注册通道共享帧验证 + DM 策略授权 + 去重 + 共享会话写入 + Inbox 桥接。
      // 原内联实现的 120s 超时由路由内部 CHAT_TIMEOUT_MS 承担；进度推送由出站回调保留。
      const { routeChannelMessage } =
        await import('@modules/channels/routing/messageRouter');
      await routeChannelMessage(message, {
        coreAPI,
        channelName: channelType,
        enableTracing: true,
        dmPolicy: {
          policy: plugin.security?.dmPolicy ?? 'open',
          allowFrom: plugin.security?.allowFrom ?? [],
        },
        onOutbound: async (content, target) => {
          logger.info(`[${label}] Liri reply`, { content });

          if (!plugin.outbound) return;

          // 发送回复（失败时加入重试队列）
          try {
            await plugin.outbound.sendText(target, content);
          } catch (err) {
            logger.warn(`[${channelType}] 首次发送失败，加入重试队列`, {
              target,
              error: String(err),
            });
            const retryKey = `${target}_${message.messageId || Date.now()}`;
            _pendingOutboundReplies.set(retryKey, {
              target,
              content,
              retryCount: 0,
              lastAttemptAt: Date.now(),
              channelType,
            });
            schedulePendingFlush();
          }
        },
      });
    } catch (error) {
      await handleError(error, {
        module: 'infra:http',
        action: 'channel_inbound_message',
        context: { channelType, messageId: message.messageId },
      });
    } finally {
      setTimeout(() => {
        _processingMessages.delete(message.messageId);
      }, 3000);
    }
  });
  logger.info(`[${channelType}] 入站消息处理器已绑定`);
}

/**
 * 获取 weixin-cli 当前状态（含二维码扫码信息）
 */
export async function handleWechatCliStatus(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { WeixinCliManager } =
      await import('@modules/channels/wechat/cli-manager');
    const status = WeixinCliManager.getInstance().getStatus();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: status }));
  } catch (err) {
    ctx.sendError(res, err);
  }
}

// ========== Channel Health（4.12 / P2-6）==========

/**
 * 获取所有通道字段渲染元数据（4.1 / P0-1）
 * GET /v1/channels/schema — 前端表单渲染依据，替代前端硬编码 PLATFORM_FIELDS
 */
export async function handleChannelSchema(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { buildChannelSchema } =
      await import('@modules/channels/config-metadata');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildChannelSchema()));
  } catch (err) {
    sendError(res, err);
  }
}

let _healthMonitorPromise: Promise<unknown> | null = null;

/**
 * 获取全局 ChannelHealthMonitor 实例（懒加载单例，避免每请求重复注册检查项）
 */
async function getChannelHealthMonitor(): Promise<ChannelHealthMonitorLike> {
  if (!_healthMonitorPromise) {
    _healthMonitorPromise = (async () => {
      const { channelRegistry } =
        await import('@modules/channels/registry/ChannelRegistry');
      const { ChannelHealthMonitor } =
        await import('@modules/channels/monitoring/ChannelHealthMonitor');
      const monitor = new ChannelHealthMonitor(channelRegistry, {
        autoStart: false,
      });
      monitor.registerAllChannels();
      return monitor;
    })();
  }
  return _healthMonitorPromise as Promise<ChannelHealthMonitorLike>;
}

/** ChannelHealthMonitor 最小接口（避免静态 import 违反模块边界 lint） */
interface ChannelHealthMonitorLike {
  getReport(): Promise<
    Array<{
      channelId: string;
      healthy: boolean;
      connected: boolean;
      latencyMs: number;
      status: string;
      error?: string;
    }>
  >;
  getStats(): Promise<{
    total: number;
    healthy: number;
    unhealthy: number;
    overallStatus: string;
  }>;
}

/**
 * 获取所有通道健康状态聚合（P2-6 / 4.12）
 * GET /v1/channels/health
 */
export async function handleChannelHealth(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const monitor = await getChannelHealthMonitor();
    const [channels, stats] = await Promise.all([
      monitor.getReport(),
      monitor.getStats(),
    ]);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ channels, stats }));
  } catch (err) {
    sendError(res, err);
  }
}
