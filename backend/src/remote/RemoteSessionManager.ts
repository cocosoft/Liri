/**
 * 远程会话管理器
 * 负责管理远程会话的连接、消息发送和接收
 */

import { logger } from '../utils/log.js';
import { SSHConnection, SSHConfig } from './SSHConnection.js';
import {
  DirectConnectManager,
  parseCCProtocolUrl,
} from './DirectConnectManager.js';

/**
 * 远程会话配置
 */
export interface RemoteSessionConfig {
  sessionId: string;
  getAccessToken?: () => string;
  orgUuid?: string;
  hasInitialPrompt?: boolean;
  viewerOnly?: boolean;
  sshConfig?: SSHConfig;
  directConnectUrl?: string;
}

/**
 * 远程会话回调
 */
export interface RemoteSessionCallbacks {
  onMessage: (message: any) => void;
  onPermissionRequest?: (request: any, requestId: string) => void;
  onPermissionCancelled?: (requestId: string, toolUseId?: string) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onReconnecting?: () => void;
  onError?: (error: Error) => void;
}

/**
 * 远程会话类型
 */
export enum RemoteSessionType {
  SSH = 'ssh',
  DIRECT_CONNECT = 'direct_connect',
}

/**
 * 远程会话管理器
 */
export class RemoteSessionManager {
  private config: RemoteSessionConfig;
  private callbacks: RemoteSessionCallbacks;
  private sessionType: RemoteSessionType;
  private sshConnection: SSHConnection | null = null;
  private directConnectManager: DirectConnectManager | null = null;
  private connected: boolean = false;

  constructor(config: RemoteSessionConfig, callbacks: RemoteSessionCallbacks) {
    this.config = config;
    this.callbacks = callbacks;

    // 确定会话类型
    if (config.sshConfig) {
      this.sessionType = RemoteSessionType.SSH;
    } else if (config.directConnectUrl) {
      this.sessionType = RemoteSessionType.DIRECT_CONNECT;
    } else {
      throw new Error(
        'Invalid remote session config: missing sshConfig or directConnectUrl'
      );
    }
  }

  /**
   * 连接到远程会话
   */
  async connect(): Promise<boolean> {
    try {
      logger.info(
        `Connecting to remote session (${this.sessionType}): ${this.config.sessionId}`
      );

      if (this.sessionType === RemoteSessionType.SSH) {
        await this.connectSSH();
      } else if (this.sessionType === RemoteSessionType.DIRECT_CONNECT) {
        await this.connectDirect();
      }

      this.connected = true;
      this.callbacks.onConnected?.();
      return true;
    } catch (error) {
      logger.error(
        'Failed to connect to remote session: ' +
          (error instanceof Error ? error.message : String(error))
      );
      this.callbacks.onError?.(error as Error);
      return false;
    }
  }

  /**
   * 连接SSH
   */
  private async connectSSH(): Promise<void> {
    if (!this.config.sshConfig) {
      throw new Error('SSH config not provided');
    }

    this.sshConnection = new SSHConnection(this.config.sshConfig);
    const success = await this.sshConnection.connect();

    if (!success) {
      throw new Error('SSH connection failed');
    }
  }

  /**
   * 连接直接连接
   */
  private async connectDirect(): Promise<void> {
    if (!this.config.directConnectUrl) {
      throw new Error('Direct connect URL not provided');
    }

    const parsedUrl = parseCCProtocolUrl(this.config.directConnectUrl);
    if (!parsedUrl) {
      throw new Error('Invalid direct connect URL');
    }

    this.directConnectManager = new DirectConnectManager();
    await this.directConnectManager.connect(
      parsedUrl.serverUrl,
      parsedUrl.authToken
    );

    // 监听消息
    this.directConnectManager.onMessage((message) => {
      this.handleMessage(message);
    });
  }

  /**
   * 处理消息
   */
  private handleMessage(message: any): void {
    if (message.type === 'control_request') {
      // 处理权限请求
      const { request_id, request: inner } = message;
      if (inner.subtype === 'can_use_tool') {
        this.callbacks.onPermissionRequest?.(inner, request_id);
      }
    } else if (message.type === 'control_cancel_request') {
      // 处理权限取消
      const { request_id } = message;
      this.callbacks.onPermissionCancelled?.(request_id);
    } else {
      // 处理普通消息
      this.callbacks.onMessage(message);
    }
  }

  /**
   * 发送消息
   */
  async sendMessage(content: any): Promise<boolean> {
    if (!this.connected) {
      logger.warn('Cannot send message: not connected');
      return false;
    }

    try {
      if (this.sessionType === RemoteSessionType.SSH && this.sshConnection) {
        // SSH方式发送消息（这里简化处理，实际需要根据具体协议实现）
        const result = await this.sshConnection.executeCommand(
          JSON.stringify(content)
        );
        return result.success;
      } else if (
        this.sessionType === RemoteSessionType.DIRECT_CONNECT &&
        this.directConnectManager
      ) {
        // 直接连接方式发送消息
        this.directConnectManager.sendMessage(content);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(
        'Failed to send message: ' +
          (error instanceof Error ? error.message : String(error))
      );
      this.callbacks.onError?.(error as Error);
      return false;
    }
  }

  /**
   * 响应权限请求
   */
  respondToPermissionRequest(
    requestId: string,
    result: { behavior: 'allow' | 'deny'; updatedInput?: any; message?: string }
  ): void {
    if (
      this.sessionType === RemoteSessionType.DIRECT_CONNECT &&
      this.directConnectManager
    ) {
      const response = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: result,
        },
      };
      this.directConnectManager.sendMessage(response);
    }
  }

  /**
   * 检查是否连接
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 取消会话
   */
  cancelSession(): void {
    if (
      this.sessionType === RemoteSessionType.DIRECT_CONNECT &&
      this.directConnectManager
    ) {
      const interruptMessage = {
        type: 'control_request',
        request: {
          subtype: 'interrupt',
        },
      };
      this.directConnectManager.sendMessage(interruptMessage);
    }
  }

  /**
   * 获取会话ID
   */
  getSessionId(): string {
    return this.config.sessionId;
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.sshConnection) {
      this.sshConnection.disconnect();
    }
    if (this.directConnectManager) {
      this.directConnectManager.disconnect();
    }
    this.connected = false;
    this.callbacks.onDisconnected?.();
    logger.info(`Disconnected from remote session: ${this.config.sessionId}`);
  }

  /**
   * 重新连接
   */
  async reconnect(): Promise<boolean> {
    this.disconnect();
    return this.connect();
  }
}

/**
 * 创建远程会话配置
 */
export function createRemoteSessionConfig(
  sessionId: string,
  options: {
    sshConfig?: SSHConfig;
    directConnectUrl?: string;
    getAccessToken?: () => string;
    orgUuid?: string;
    hasInitialPrompt?: boolean;
    viewerOnly?: boolean;
  }
): RemoteSessionConfig {
  return {
    sessionId,
    ...options,
  };
}

/**
 * 创建远程会话管理器
 */
export function createRemoteSessionManager(
  config: RemoteSessionConfig,
  callbacks: RemoteSessionCallbacks
): RemoteSessionManager {
  return new RemoteSessionManager(config, callbacks);
}
