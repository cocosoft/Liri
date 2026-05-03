// @ts-nocheck
/**
 * 桥接消息同步管理器
 * 实现消息双向同步：入站消息注入、出站消息发送
 */

import { randomUUID } from 'crypto';
import type { Message } from '../types/message.js';
import { BoundedUUIDSet } from './BoundedUUIDSet.js';

/**
 * SDK消息类型
 */
export interface SDKMessage {
  type: string;
  uuid?: string;
  [key: string]: unknown;
}

/**
 * 控制请求消息
 */
export interface SDKControlRequest {
  type: 'control_request';
  request_id: string;
  request: {
    subtype: string;
    [key: string]: unknown;
  };
}

/**
 * 控制响应消息
 */
export interface SDKControlResponse {
  type: 'control_response';
  response: {
    subtype: 'success' | 'error';
    request_id: string;
    error?: string;
    response?: unknown;
  };
}

/**
 * 桥接消息同步选项
 */
export interface BridgeMessageSyncOptions {
  /** 出站模式 */
  outboundOnly?: boolean;
  /** 消息历史长度 */
  historyLength?: number;
  /** 附件处理函数 */
  handleAttachments?: (message: Message) => Promise<Message>;
  /** 入站消息处理函数 */
  onInboundMessage?: (message: SDKMessage) => Promise<void>;
  /** 控制请求处理函数 */
  onControlRequest?: (request: SDKControlRequest) => void;
  /** 权限响应处理函数 */
  onPermissionResponse?: (response: SDKControlResponse) => void;
}

/**
 * 桥接消息同步管理器
 */
export class BridgeMessageSyncManager {
  private options: BridgeMessageSyncOptions;
  private recentPostedUUIDs: BoundedUUIDSet;
  private recentInboundUUIDs: BoundedUUIDSet;
  private queuedCommands: Array<{ message: Message; callback?: () => void }>;
  private isProcessing: boolean;

  constructor(options: BridgeMessageSyncOptions = {}) {
    this.options = {
      outboundOnly: false,
      historyLength: 100,
      ...options,
    };
    this.recentPostedUUIDs = new BoundedUUIDSet(this.options.historyLength!);
    this.recentInboundUUIDs = new BoundedUUIDSet(this.options.historyLength!);
    this.queuedCommands = [];
    this.isProcessing = false;
  }

  /**
   * 处理入站消息
   */
  handleIngressMessage(data: string): void {
    // 出站模式下忽略所有入站消息
    if (this.options.outboundOnly) {
      console.log('[bridge] Outbound-only mode: ignoring ingress message');
      return;
    }

    try {
      const parsed: unknown = JSON.parse(data);

      // 处理控制响应
      if (this.isSDKControlResponse(parsed)) {
        console.log('[bridge] Ingress message type=control_response');
        this.options.onPermissionResponse?.(parsed);
        return;
      }

      // 处理控制请求
      if (this.isSDKControlRequest(parsed)) {
        console.log(`[bridge] Inbound control_request subtype=${parsed.request.subtype}`);
        this.options.onControlRequest?.(parsed);
        return;
      }

      // 处理SDK消息
      if (this.isSDKMessage(parsed)) {
        // 检查UUID以检测回声
        const uuid = 'uuid' in parsed && typeof parsed.uuid === 'string' ? parsed.uuid : undefined;

        if (uuid && this.recentPostedUUIDs.has(uuid)) {
          console.log(`[bridge] Ignoring echo: type=${parsed.type} uuid=${uuid}`);
          return;
        }

        // 防止重复处理
        if (uuid && this.recentInboundUUIDs.has(uuid)) {
          console.log(`[bridge] Ignoring re-delivered inbound: type=${parsed.type} uuid=${uuid}`);
          return;
        }

        console.log(`[bridge] Ingress message type=${parsed.type}${uuid ? ` uuid=${uuid}` : ''}`);

        if (parsed.type === 'user') {
          if (uuid) this.recentInboundUUIDs.add(uuid);
          // 异步处理入站消息
          void this.options.onInboundMessage?.(parsed);
        } else {
          console.log(`[bridge] Ignoring non-user inbound message: type=${parsed.type}`);
        }
      }
    } catch (error) {
      console.error('[bridge] Failed to parse ingress message:', error);
    }
  }

  /**
   * 发送出站消息
   */
  async sendOutboundMessage(message: Message): Promise<void> {
    if (this.options.outboundOnly) {
      console.log('[bridge] Outbound-only mode: skipping message sending');
      return;
    }

    // 检查消息是否适合桥接
    if (!this.isEligibleBridgeMessage(message)) {
      return;
    }

    // 处理附件
    let processedMessage = message;
    if (this.options.handleAttachments) {
      processedMessage = await this.options.handleAttachments(message);
    }

    // 生成UUID
    const uuid = randomUUID();
    this.recentPostedUUIDs.add(uuid);

    // 构建SDK消息
    const sdkMessage = this.buildSDKMessage(processedMessage, uuid);
    
    // 发送消息（这里需要与实际的传输层集成）
    console.log('[bridge] Sending outbound message:', sdkMessage.type);
  }

  /**
   * 队列命令
   */
  queueCommand(message: Message, callback?: () => void): void {
    this.queuedCommands.push({ message, callback });
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * 处理队列
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queuedCommands.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.queuedCommands.length > 0) {
        const { message, callback } = this.queuedCommands.shift()!;
        await this.sendOutboundMessage(message);
        callback?.();
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 检查消息是否适合桥接
   */
  private isEligibleBridgeMessage(message: Message): boolean {
    // 虚拟消息不适合桥接
    if ((message.type === 'user' || message.type === 'assistant') && (message as any).isVirtual) {
      return false;
    }

    // 只允许用户消息、助手消息和本地命令系统消息
    return (
      message.type === 'user' ||
      message.type === 'assistant' ||
      (message.type === 'system' && (message as any).subtype === 'local_command')
    );
  }

  /**
   * 构建SDK消息
   */
  private buildSDKMessage(message: Message, uuid: string): SDKMessage {
    const sdkMessage: SDKMessage = {
      type: message.type,
      uuid,
      ...message,
    };

    // 处理不同类型的消息
    if (message.type === 'user') {
      return {
        ...sdkMessage,
        message: message.message,
        origin: message.origin,
      };
    } else if (message.type === 'assistant') {
      return {
        ...sdkMessage,
        message: message.message,
        tool_use: (message as any).tool_use,
        tool_result: (message as any).tool_result,
      };
    }

    return sdkMessage;
  }

  /**
   * 类型检查：SDK消息
   */
  private isSDKMessage(value: unknown): value is SDKMessage {
    return (
      value !== null &&
      typeof value === 'object' &&
      'type' in value &&
      typeof (value as any).type === 'string'
    );
  }

  /**
   * 类型检查：控制响应
   */
  private isSDKControlResponse(value: unknown): value is SDKControlResponse {
    return (
      value !== null &&
      typeof value === 'object' &&
      (value as any).type === 'control_response' &&
      'response' in value
    );
  }

  /**
   * 类型检查：控制请求
   */
  private isSDKControlRequest(value: unknown): value is SDKControlRequest {
    return (
      value !== null &&
      typeof value === 'object' &&
      (value as any).type === 'control_request' &&
      'request_id' in value &&
      'request' in value
    );
  }

  /**
   * 清空队列
   */
  clearQueue(): void {
    this.queuedCommands = [];
  }

  /**
   * 获取队列长度
   */
  getQueueLength(): number {
    return this.queuedCommands.length;
  }

  /**
   * 设置出站模式
   */
  setOutboundOnly(outboundOnly: boolean): void {
    this.options.outboundOnly = outboundOnly;
  }

  /**
   * 获取出站模式状态
   */
  isOutboundOnly(): boolean {
    return this.options.outboundOnly || false;
  }
}
