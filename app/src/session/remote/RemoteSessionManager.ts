/**
 * 远程会话管理器
 * 对标CC源码的RemoteSessionManager.ts
 */

import {
  SessionsWebSocket,
  createSessionsWebSocket,
  type SessionsWebSocketCallbacks,
} from '../websocket/SessionsWebSocket.js';
import type { SessionsWebSocketConfig } from '../websocket/SessionsWebSocket.js';
import type {
  UnifiedMessage,
  SDKMessage,
  PermissionRequest,
  PermissionResponse,
} from '../types/Message.js';
import type { UnifiedSession } from '../types/Session.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'session\remote\RemoteSessionManager',
  level: LogLevel.INFO,
});

export interface RemoteSessionConfig {
  sessionId: string;
  getAccessToken: () => string;
  orgUuid: string;
  hasInitialPrompt?: boolean;
  viewerOnly?: boolean;
  wsUrl?: string;
}

export interface RemoteSessionCallbacks {
  onMessage: (message: SDKMessage) => void;
  onPermissionRequest: (request: PermissionRequest, requestId: string) => void;
  onPermissionCancelled?: (requestId: string, toolUseId?: string) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onReconnecting?: () => void;
  onError?: (error: Error) => void;
}

interface SDKControlRequest {
  type: 'control_request';
  requestId: string;
  action: string;
  params?: Record<string, unknown>;
}

interface SDKControlResponse {
  type: 'control_response';
  requestId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

interface SDKControlCancelRequest {
  type: 'control_cancel';
  requestId: string;
  reason?: string;
}

type SessionMessage =
  | SDKMessage
  | SDKControlRequest
  | SDKControlResponse
  | SDKControlCancelRequest;

export class RemoteSessionManager {
  private websocket: SessionsWebSocket | null = null;
  private config: RemoteSessionConfig;
  private callbacks: RemoteSessionCallbacks;
  private pendingPermissionRequests: Map<string, PermissionRequest> = new Map();
  private isConnected = false;
  private messageQueue: SessionMessage[] = [];

  constructor(config: RemoteSessionConfig, callbacks: RemoteSessionCallbacks) {
    this.config = {
      wsUrl: 'wss://api.anthropic.com',
      hasInitialPrompt: false,
      viewerOnly: false,
      ...config,
    };
    this.callbacks = callbacks;
  }

  connect(): void {
    if (this.isConnected) {
      return;
    }

    const wsConfig: SessionsWebSocketConfig = {
      url: this.config.wsUrl!,
      sessionId: this.config.sessionId,
      orgUuid: this.config.orgUuid,
      getAccessToken: this.config.getAccessToken,
    };

    const wsCallbacks: SessionsWebSocketCallbacks = {
      onMessage: (message) => this.handleMessage(message as SessionMessage),
      onClose: () => this.handleClose(),
      onError: (error) => this.handleError(error),
      onConnected: () => this.handleConnected(),
      onReconnecting: () => this.callbacks.onReconnecting?.(),
    };

    this.websocket = createSessionsWebSocket(wsConfig, wsCallbacks);
    this.websocket.connect();
  }

  disconnect(): void {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
    this.isConnected = false;
    this.pendingPermissionRequests.clear();
    this.messageQueue = [];
  }

  async sendMessage(message: SDKMessage): Promise<void> {
    if (!this.isConnected) {
      this.messageQueue.push(message);
      return;
    }

    if (this.websocket) {
      this.websocket.send(message);
    }
  }

  sendPermissionResponse(
    requestId: string,
    response: PermissionResponse
  ): void {
    const controlResponse: SDKControlResponse = {
      type: 'control_response',
      requestId,
      success: response.approved,
      result: response.approved ? { approved: true } : undefined,
      error: response.approved ? undefined : response.reason,
    };

    if (this.websocket && this.isConnected) {
      this.websocket.send(controlResponse);
    }

    this.pendingPermissionRequests.delete(requestId);
  }

  private handleMessage(message: SessionMessage): void {
    if (message.type === 'control_request') {
      this.handleControlRequest(message as SDKControlRequest);
      return;
    }

    if (message.type === 'control_cancel') {
      this.handleControlCancel(message as SDKControlCancelRequest);
      return;
    }

    if (message.type === 'sdk_message' || 'type' in message) {
      const sdkMessage = message as SDKMessage;
      if (sdkMessage.type && !sdkMessage.type.startsWith('control_')) {
        this.callbacks.onMessage(sdkMessage);
      }
    }
  }

  private handleControlRequest(request: SDKControlRequest): void {
    if (request.action === 'permission_request') {
      const permissionRequest: PermissionRequest = {
        requestId: request.requestId,
        toolName: (request.params?.toolName as string) ?? 'unknown',
        params: request.params ?? {},
        timestamp: Date.now(),
      };

      this.pendingPermissionRequests.set(request.requestId, permissionRequest);
      this.callbacks.onPermissionRequest(permissionRequest, request.requestId);
      return;
    }

    const response: SDKControlResponse = {
      type: 'control_response',
      requestId: request.requestId,
      success: false,
      error: `Unknown action: ${request.action}`,
    };

    if (this.websocket) {
      this.websocket.send(response);
    }
  }

  private handleControlCancel(request: SDKControlCancelRequest): void {
    const pendingRequest = this.pendingPermissionRequests.get(
      request.requestId
    );
    if (pendingRequest) {
      this.pendingPermissionRequests.delete(request.requestId);
      this.callbacks.onPermissionCancelled?.(
        request.requestId,
        pendingRequest.params?.toolUseId as string | undefined
      );
    }
  }

  private handleConnected(): void {
    this.isConnected = true;
    this.callbacks.onConnected?.();

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message && this.websocket) {
        this.websocket.send(message);
      }
    }
  }

  private handleClose(): void {
    this.isConnected = false;
    this.callbacks.onDisconnected?.();
  }

  private handleError(error: Error): void {
    this.callbacks.onError?.(error);
  }

  getSessionId(): string {
    return this.config.sessionId;
  }

  isSessionConnected(): boolean {
    return this.isConnected;
  }

  getPendingPermissionRequests(): Map<string, PermissionRequest> {
    return new Map(this.pendingPermissionRequests);
  }

  hasPendingPermission(requestId: string): boolean {
    return this.pendingPermissionRequests.has(requestId);
  }
}

export function createRemoteSessionManager(
  config: RemoteSessionConfig,
  callbacks: RemoteSessionCallbacks
): RemoteSessionManager {
  return new RemoteSessionManager(config, callbacks);
}
