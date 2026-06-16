/**
 * GatewaySetup — 通道自动配置工厂
 * 根据应用配置自动创建和注册 Telegram/WebSocket 通道
 *
 * @deprecated 旧通道启动路径（受 GATEWAY_LEGACY_DISABLED 环境变量控制）。
 *   新路径见 channels/setupChannels.ts 及 channels/registry/ChannelRegistry。
 *   当 GATEWAY_LEGACY_DISABLED=true 时，此模块不会被调用。
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { handleError } from '@modules/error/handleError';
import { cliConfigManager } from '../../cli/config';
import { configManager } from '@modules/config';
import { getChannelManager } from './ChannelManager';
import { getCoreAPI } from '../../runtime/api/CoreAPIImpl';
import { TelegramChannel } from './TelegramChannel';
import { WebChannel } from './WebChannel';
import { ChannelType } from './types';
import type { GatewayChannel } from './types';
import { channelRegistry, adaptPluginToChannelInterface } from '../../channels/registry/ChannelRegistry';

const logger = new Logger({ level: LogLevel.INFO, module: 'gateway:setup' });

/**
 * Gateway 初始化结果
 */
export interface GatewaySetupResult {
  registeredChannels: number;
  connectedChannels: number;
  errors: string[];
}

/**
 * Gateway 初始化选项
 * 对标 OpenClaw fast-path 设计：支持延迟连接和按类型选择通道
 */
export interface GatewaySetupOptions {
  /** 快速启动模式：仅注册通道，不发起连接（延迟到首次使用） */
  fastPath?: boolean;
  /** 仅初始化指定类型的通道，未指定时初始化所有 */
  channelTypes?: ChannelType[];
}

/**
 * 根据配置文件自动初始化 Gateway 通道
 * 读取 cli/config 中的 gateway 配置节，创建并注册已启用的通道
 *
 * @param options 初始化选项
 */
export async function setupGatewayFromConfig(
  options?: GatewaySetupOptions
): Promise<GatewaySetupResult> {
  const result: GatewaySetupResult = {
    registeredChannels: 0,
    connectedChannels: 0,
    errors: [],
  };

  // 止血开关：设置 GATEWAY_LEGACY_DISABLED=true 可禁用旧 Gateway 系统
  if (configManager.env('GATEWAY_LEGACY_DISABLED') === 'true') {
    logger.info('Gateway 旧通道已通过 GATEWAY_LEGACY_DISABLED 全局禁用');
    return result;
  }

  const gatewayConfig = cliConfigManager.getGatewayConfig();

  if (!gatewayConfig.enabled) {
    logger.info('Gateway 通道服务未启用（gateway.enabled = false）');
    return result;
  }

  logger.info('Gateway 通道服务启动中...');

  const channelManager = getChannelManager();
  const coreAPI = getCoreAPI();
  channelManager.setCoreAPI(coreAPI);

  // 注册 Telegram 通道
  if (gatewayConfig.telegram.enabled) {
    if (
      options?.channelTypes &&
      !options.channelTypes.includes(ChannelType.TELEGRAM)
    ) {
      logger.info('Telegram 通道被 fastPath 过滤跳过');
    } else {
      try {
        const token =
          gatewayConfig.telegram.token || configManager.env('TELEGRAM_BOT_TOKEN') || '';

        if (!token) {
          const errMsg =
            'Telegram 通道已启用但未配置 token（设置 gateway.telegram.token 或 TELEGRAM_BOT_TOKEN 环境变量）';
          logger.warning(errMsg);
          result.errors.push(errMsg);
        } else {
          const telegramChannel = new TelegramChannel({
            name: 'telegram',
            type: ChannelType.TELEGRAM,
            token,
            pollingTimeout: gatewayConfig.telegram.pollingTimeout,
            pollingInterval: gatewayConfig.telegram.pollingInterval,
          });

          channelManager.registerChannel(telegramChannel);
          result.registeredChannels++;
          logger.info('Telegram 通道已注册');
        }
      } catch (error) {
        await handleError(error, { module: 'gateway:setup', action: 'register_telegram' });
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  // 注册 WebSocket 通道
  if (gatewayConfig.websocket.enabled) {
    if (
      options?.channelTypes &&
      !options.channelTypes.includes(ChannelType.WEBSOCKET)
    ) {
      logger.info('WebSocket 通道被 fastPath 过滤跳过');
    } else {
      try {
        const webChannel = new WebChannel({
          name: 'websocket',
          type: ChannelType.WEBSOCKET,
          host: gatewayConfig.websocket.host,
          port: gatewayConfig.websocket.port,
          path: gatewayConfig.websocket.path,
          maxMessageSize: gatewayConfig.websocket.maxMessageSize,
        });

        channelManager.registerChannel(webChannel as unknown as GatewayChannel);
        channelRegistry.register(adaptPluginToChannelInterface(webChannel));
        result.registeredChannels++;
        logger.info(
          `WebSocket 通道已注册 (${gatewayConfig.websocket.host}:${gatewayConfig.websocket.port})`
        );
      } catch (error) {
        await handleError(error, { module: 'gateway:setup', action: 'register_websocket' });
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  // 自动启动已注册通道（快速启动模式下跳过连接，延迟到首次使用）
  if (result.registeredChannels > 0 && !options?.fastPath) {
    try {
      await channelManager.start();
      const status = channelManager.getStatus();
      result.connectedChannels = status.connectedChannels;
      logger.info(
        `Gateway 通道启动完成: ${result.connectedChannels}/${result.registeredChannels} 已连接`
      );
    } catch (error) {
      await handleError(error, { module: 'gateway:setup', action: 'start_channels' });
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (options?.fastPath) {
    logger.info(
      `Gateway 快速启动完成: ${result.registeredChannels} 通道已注册（延迟连接）`
    );
  }

  return result;
}
