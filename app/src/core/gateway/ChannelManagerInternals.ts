/**
 * ChannelManager 内部实现
 * 从 ChannelManager.ts 抽取的私有辅助方法，遵循单类原则。
 *
 * 职责：
 * - 通道事件回调工厂
 * - 消息验证、错误响应、路由
 * - 通道启动/停止/重连生命周期
 * - 健康检查
 */
import type { CoreAPI } from '../../runtime/api/CoreAPI';
import type {
  GatewayChannel,
  ChannelEventCallbacks,
  InboundMessage,
} from './types';
import { ChannelEvent } from './types';
import { validateInboundFrame } from './protocol/validators';
import type { ValidationResult } from './protocol/validators';
import {
  channelEventBus,
  ChannelEvents,
} from '../../channels/events/ChannelEventBus.js';
import { routeChannelMessage } from '../../channels/routing/messageRouter';
import type { MessageContext } from '../../channels/types/IChannel';
import { channelRegistry } from '../../channels/registry/ChannelRegistry';
import type { ChannelInterface } from '../../channels/registry/ChannelRegistry';
import type {
  ChannelRegistration,
  ChannelManagerConfig,
  RedactedLogger,
} from './ChannelManagerTypes';

/**
 * 将 GatewayChannel 适配为 ChannelInterface，用于同步到 ChannelRegistry
 */
export function adaptToChannelInterface(
  channel: GatewayChannel
): ChannelInterface {
  return {
    name: channel.name,
    type: channel.type,
    enabled: true,
    get connected() {
      return channel.isConnected();
    },
    connect: async () => {
      try {
        await channel.connect();
        return true;
      } catch {
        return false;
      }
    },
    disconnect: async () => {
      await channel.disconnect();
    },
    sendMessage: async (_target: string, text: string) => {
      return channel.send({
        content: text,
        sessionId: _target,
        recipient: _target,
      });
    },
    getStatus: () => ({
      status: channel.status,
      connected: channel.isConnected(),
      stats: channel.stats,
    }),
  };
}

/**
 * 验证入站消息的合法性
 */
export function validateInboundMessage(
  message: InboundMessage
): ValidationResult {
  if (!message.id || typeof message.id !== 'string') {
    return { valid: false, errors: ['消息 ID 不能为空'] };
  }
  if (!message.sender || typeof message.sender !== 'string') {
    return { valid: false, errors: ['消息发送者不能为空'] };
  }
  if (
    !message.timestamp ||
    typeof message.timestamp !== 'number' ||
    message.timestamp <= 0
  ) {
    return { valid: false, errors: ['消息时间戳无效'] };
  }

  if (
    message.raw &&
    typeof message.raw === 'object' &&
    Object.keys(message.raw).length > 0
  ) {
    const frameResult = validateInboundFrame(message.raw);
    if (!frameResult.valid) {
      return frameResult;
    }
  }

  return { valid: true };
}

/**
 * 发送结构化错误帧到通道
 */
export async function sendErrorResponse(
  channel: GatewayChannel,
  message: InboundMessage,
  code: string,
  errorMessage: string,
  logger: RedactedLogger
): Promise<void> {
  const errorFrame = {
    type: 'error' as const,
    error: {
      code,
      message: errorMessage,
      details: {
        originalMessageId: message.id,
        channel: channel.name,
      },
    },
  };

  try {
    if (channel.isConnected()) {
      await channel.send({
        content: JSON.stringify(errorFrame),
        sessionId: message.sessionId || 'unknown',
        recipient: message.sender,
        type: 'text',
        metadata: { isErrorFrame: true, errorCode: code },
      });
    }
  } catch (sendError) {
    logger.warning(
      `ChannelManager: 发送错误帧失败 — ${channel.name}`,
      { error: String(sendError) }
    );
  }

  logger.warning(`ChannelManager: 非法消息被拦截 — ${channel.name}`, {
    messageId: message.id,
    errorCode: code,
    errorMessage,
  });
}

/**
 * 创建通道事件回调
 */
export function createChannelCallbacks(
  channel: GatewayChannel,
  channels: Map<string, ChannelRegistration>,
  config: Required<ChannelManagerConfig>,
  isRunning: () => boolean,
  emit: (event: string, ...args: unknown[]) => boolean,
  logger: RedactedLogger,
  routeMessageFn: (ch: GatewayChannel, msg: InboundMessage) => Promise<void>,
  attemptReconnectFn: (name: string, reg: ChannelRegistration) => void
): ChannelEventCallbacks & { onReconnecting: (attempt: number, maxAttempts: number) => void } {
  return {
    onConnected: () => {
      const reg = channels.get(channel.name);
      if (reg) {
        reg.reconnectAttempts = 0;
      }
      emit(ChannelEvent.CONNECTED, channel.name);
      channelEventBus.publish(ChannelEvents.CHANNEL_CONNECTED, {
        channelName: channel.name,
      });
      logger.info(`ChannelManager: 通道已连接 — ${channel.name}`);
    },

    onDisconnected: (reason?: string) => {
      emit(ChannelEvent.DISCONNECTED, channel.name, reason);
      channelEventBus.publish(ChannelEvents.CHANNEL_DISCONNECTED, {
        channelName: channel.name,
        reason: reason ?? 'unknown',
      });
      logger.warning(
        `ChannelManager: 通道已断开 — ${channel.name}${reason ? ` (${reason})` : ''}`
      );

      const reg = channels.get(channel.name);
      if (reg && config.autoReconnect && isRunning()) {
        attemptReconnectFn(channel.name, reg);
      }
    },

    onError: async (error: Error) => {
      emit(ChannelEvent.ERROR, channel.name, error);
      channelEventBus.publish(ChannelEvents.CHANNEL_ERROR, {
        channelName: channel.name,
        error: error.message,
      });
    },

    onMessage: (message: InboundMessage) => {
      emit(ChannelEvent.MESSAGE, channel.name, message);
      channelEventBus.publish(ChannelEvents.MESSAGE_RECEIVED, {
        channelName: channel.name,
        messageId: message.id,
        senderId: message.sender,
      });
      routeMessageFn(channel, message);
    },

    onStateChange: (status, previous) => {
      emit(ChannelEvent.STATE_CHANGE, channel.name, status, previous);
      channelEventBus.publish(ChannelEvents.CHANNEL_STATE_CHANGE, {
        channelName: channel.name,
        status,
        previousStatus: previous,
      });
    },

    onReconnecting: (attempt, maxAttempts) => {
      emit(ChannelEvent.RECONNECTING, channel.name, attempt, maxAttempts);
      channelEventBus.publish(ChannelEvents.CHANNEL_RECONNECTING, {
        channelName: channel.name,
        attempt,
        maxAttempts,
      });
    },
  };
}

/**
 * 路由入站消息到 CoreAPI
 *
 * @deprecated 内部委托到 routeChannelMessage()，旧路径保留兼容。
 */
export async function routeMessage(
  channel: GatewayChannel,
  message: InboundMessage,
  coreAPI: CoreAPI | null,
  logger: RedactedLogger,
  emit: (event: string, ...args: unknown[]) => boolean,
  sendErrorResponseFn: (
    ch: GatewayChannel,
    msg: InboundMessage,
    code: string,
    errMsg: string
  ) => Promise<void>
): Promise<void> {
  const messageContext: MessageContext = {
    messageId: message.id,
    channelId: channel.name as MessageContext['channelId'],
    senderId: message.sender,
    content: message.content,
    messageType: 'text',
    timestamp: message.timestamp,
    isDirectMessage: true,
    conversationId: message.sessionId || message.sender,
    rawPayload: message.raw || {},
  };

  const result = await routeChannelMessage(messageContext, {
    coreAPI: {
      chat: async (params) => {
        if (!coreAPI) {
          throw new Error('CoreAPI 未设置');
        }
        return coreAPI.chat({
          content: params.content,
          sessionId: params.sessionId,
          metadata: {
            ...params.metadata,
            channel: channel.name,
          },
        });
      },
    },
    onOutbound: async (content, target) => {
      await channel.send({
        content,
        sessionId: message.sessionId || 'unknown',
        recipient: target,
        type: 'text',
      });
    },
    channelName: channel.name,
    enableTracing: true,
  });

  if (!result.valid) {
    await sendErrorResponseFn(
      channel,
      message,
      result.errorCode || 'INVALID_FRAME',
      result.errorMessage || '消息格式无效'
    );
    emit(
      ChannelEvent.ERROR,
      channel.name,
      new Error(`消息验证失败: ${result.errorMessage}`)
    );
    channelEventBus.publish(ChannelEvents.CHANNEL_ERROR, {
      channelName: channel.name,
      error: `消息验证失败: ${result.errorMessage}`,
      errorCode: result.errorCode || 'INVALID_FRAME',
    });
  }
}

/**
 * 启动单通道
 */
export async function startChannelInternal(
  channel: GatewayChannel,
  config: Required<ChannelManagerConfig>,
  logger: RedactedLogger,
  attemptReconnectFn: (name: string) => void
): Promise<void> {
  try {
    await channel.initialize();
    await channel.connect();
    logger.info(`ChannelManager: 通道已启动 — ${channel.name}`);
  } catch (error) {
    logger.warning(
      `ChannelManager: 通道启动失败 — ${channel.name}`,
      { error: String(error) }
    );

    if (config.autoReconnect) {
      attemptReconnectFn(channel.name);
    }

    throw error;
  }
}

/**
 * 停止单通道
 */
export async function stopChannelInternal(
  registration: ChannelRegistration,
  logger: RedactedLogger
): Promise<void> {
  const { channel } = registration;

  if (registration.healthCheckTimer) {
    clearInterval(registration.healthCheckTimer);
    registration.healthCheckTimer = undefined;
  }

  try {
    await channel.disconnect();
    logger.info(`ChannelManager: 通道已停止 — ${channel.name}`);
  } catch (error) {
    logger.warning(
      `ChannelManager: 通道停止失败 — ${channel.name}`,
      { error: String(error) }
    );
  }
}

/**
 * 尝试重连通道（仅通过 emit 触发 onReconnecting，不依赖回调工厂）
 */
export function attemptReconnect(
  name: string,
  registration: ChannelRegistration,
  config: Required<ChannelManagerConfig>,
  isRunning: () => boolean,
  logger: RedactedLogger,
  emit: (event: string, ...args: unknown[]) => boolean
): void {
  if (registration.reconnectAttempts >= config.maxReconnectAttempts) {
    logger.warning(
      `ChannelManager: 通道 ${name} 已达最大重连次数 (${config.maxReconnectAttempts})`
    );
    return;
  }

  registration.reconnectAttempts++;

  // 直接 emit 事件，无需通过回调工厂
  emit(ChannelEvent.RECONNECTING, name, registration.reconnectAttempts, config.maxReconnectAttempts);
  channelEventBus.publish(ChannelEvents.CHANNEL_RECONNECTING, {
    channelName: name,
    attempt: registration.reconnectAttempts,
    maxAttempts: config.maxReconnectAttempts,
  });

  setTimeout(async () => {
    if (!isRunning()) {
      return;
    }

    logger.info(
      `ChannelManager: 重连通道 ${name} (${registration.reconnectAttempts}/${config.maxReconnectAttempts})`
    );

    try {
      await registration.channel.disconnect();
      await registration.channel.initialize();
      await registration.channel.connect();
      registration.reconnectAttempts = 0;
      logger.info(`ChannelManager: 通道 ${name} 重连成功`);
    } catch (error) {
      logger.warning(
        `ChannelManager: 通道 ${name} 重连失败`,
        { error: String(error) }
      );
      attemptReconnect(
        name,
        registration,
        config,
        isRunning,
        logger,
        emit
      );
    }
  }, config.reconnectInterval);
}
