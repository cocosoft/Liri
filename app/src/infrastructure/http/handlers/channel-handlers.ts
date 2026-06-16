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

import type http from 'node:http';
import type { HandlerCtx } from './handler-utils';
import type { IChannelPlugin } from '@modules/channels/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';
import { configManager } from '@modules/config';

const logger = new Logger({ level: LogLevel.INFO });

// ========== Channel Handlers ==========

export async function handleUpdateChannel(
  ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    channelId: string
  ): Promise<void> {
    try {
    const body = await ctx.readRequestBody(req);
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
          config as Record<string, unknown> | undefined
        );
        if (!dynRegistered) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Channel not found' } }));
          return;
        }
      }

      // 更新配置
      const channelAfterDyn = channelRegistry.get(channelId)!;
      const updated = channelRegistry.updateConfig(channelId, {
        name: name,
        enabled: enabled,
        options: config as Record<string, unknown> | undefined,
      });

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
          config: latestConfig?.options || {},
        })
      );

    } catch (err) {
      await handleError(err, { module: 'infra:http', action: 'handler_error' });
      if (!res.headersSent) {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
        } catch {} /* res可能已结束, 忽略 */
      }
    }
  }

  /**
   * 处理通道配置应用请求 POST /v1/channels/config/apply
   * 从 DB 中读取已保存的通道配置，重新注册并连接通道
   */
export async function handleApplyChannelConfig(
  ctx: HandlerCtx,
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
          const dynRegistered = await tryDynamicRegister(
            config.type,
            config.options
          );
          if (dynRegistered) {
            registeredCount++;
            // 恢复持久化的配置（含 enabled 状态）
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
      await handleError(err, { module: 'http:handlers', action: 'apply_channel_config' });
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

  /**
   * 通道动态注册元信息表（26 通道全覆盖）
   * 与 setupChannels.ts 中的 channelCandidates 保持同步
   */


/**
 * 尝试动态注册通道
 */
export async function tryDynamicRegister(
  channelId: string,
  config?: Record<string, unknown>
): Promise<boolean> {
  const { channelRegistry } = await import('@modules/channels/registry/ChannelRegistry');
  const { configManager } = await import('@modules/config');
  const logger = new Logger({ level: LogLevel.INFO });

  try {
    const channel = channelRegistry.get(channelId);
    if (channel) return true; // 已注册

    // 尝试加载通道类型对应的插件类
    const CHANNEL_TABLE: Array<{
      type: string; name: string; importPath: string; exportKey: string;
    }> = [
      { type: 'telegram', name: 'Telegram', importPath: '../../../channels/telegram/TelegramChannel', exportKey: 'telegramChannel' },
      { type: 'discord', name: 'Discord', importPath: '../../../channels/discord/DiscordChannel', exportKey: 'discordChannel' },
      { type: 'qq', name: 'QQ', importPath: '../../../channels/qq/QQChannel', exportKey: 'qqChannel' },
      { type: 'dingtalk', name: '钉钉', importPath: '../../../channels/dingtalk/DingTalkChannel', exportKey: 'dingtalkChannel' },
      { type: 'feishu', name: '飞书', importPath: '../../../channels/feishu/FeishuChannel', exportKey: 'feishuChannel' },
      { type: 'wechat', name: '微信', importPath: '../../../channels/wechat/WechatChannel', exportKey: 'wechatChannel' },
      { type: 'slack', name: 'Slack', importPath: '../../../channels/slack/index', exportKey: 'slackChannelPlugin' },
      { type: 'line', name: 'Line', importPath: '../../../channels/line/index', exportKey: 'lineChannelPlugin' },
      { type: 'irc', name: 'IRC', importPath: '../../../channels/irc/index', exportKey: 'ircChannelPlugin' },
      { type: 'nostr', name: 'Nostr', importPath: '../../../channels/nostr/index', exportKey: 'nostrChannelPlugin' },
      { type: 'email', name: '邮件', importPath: '../../../channels/email/EmailChannel', exportKey: 'emailChannelPlugin' },
      { type: 'sms', name: '短信', importPath: '../../../channels/sms/SmsChannel', exportKey: 'smsChannelPlugin' },
      { type: 'webhook', name: 'Webhook', importPath: '../../../channels/webhook/WebhookChannel', exportKey: 'webhookChannelPlugin' },
      { type: 'wecom', name: '企业微信', importPath: '../../../channels/wecom/WeComChannel', exportKey: 'wecomChannel' },
      { type: 'googlechat', name: 'Google Chat', importPath: '../../../channels/googlechat/index', exportKey: 'googleChatChannelPlugin' },
      { type: 'msteams', name: 'MS Teams', importPath: '../../../channels/msteams/index', exportKey: 'msteamsChannelPlugin' },
      { type: 'zalo', name: 'Zalo', importPath: '../../../channels/zalo/index', exportKey: 'zaloChannelPlugin' },
      { type: 'yuanbao', name: '元宝', importPath: '../../../channels/yuanbao/index', exportKey: 'yuanbaoChannelPlugin' },
      { type: 'whatsapp', name: 'WhatsApp', importPath: '../../../channels/whatsapp/index', exportKey: 'whatsAppChannelPlugin' },
      { type: 'signal', name: 'Signal', importPath: '../../../channels/signal/index', exportKey: 'signalChannelPlugin' },
      { type: 'matrix', name: 'Matrix', importPath: '../../../channels/matrix/index', exportKey: 'matrixChannelPlugin' },
      { type: 'facebook', name: 'Facebook Messenger', importPath: '../../../channels/facebookmessenger/index', exportKey: 'facebookMessengerChannelPlugin' },
      { type: 'twitter', name: 'Twitter/X', importPath: '../../../channels/twitter/index', exportKey: 'twitterChannelPlugin' },
      { type: 'claude', name: 'Claude', importPath: '../../../channels/claude/index', exportKey: 'claudeChannelPlugin' },
      { type: 'mattermost', name: 'Mattermost', importPath: '../../../channels/mattermost/MattermostChannel', exportKey: 'mattermostChannel' },
      { type: 'bluebubbles', name: 'iMessage', importPath: '../../../channels/bluebubbles/BlueBubblesChannel', exportKey: 'bluebubblesChannelPlugin' },
    ];
    const entry = CHANNEL_TABLE.find(e => e.type === channelId);
    if (!entry) {
      logger.warning('通道动态注册: 未找到通道类型', { channelId });
      return false;
    }

    const mod = await import(entry.importPath);
    const plugin: IChannelPlugin = mod[entry.exportKey];
    if (!plugin) {
      logger.warning('通道动态注册: 未找到插件导出', { importPath: entry.importPath, exportKey: entry.exportKey });
      return false;
    }

    // 从 configManager 获取凭据
    const channelConfig = configManager.getConfigValue<Record<string, any>>('channels') ?? {};
    const creds = channelConfig[channelId];
    channelRegistry.register(plugin);
    return true;
  } catch (err) {
    logger.error('通道动态注册失败', { channelId, err });
    return false;
  }
}