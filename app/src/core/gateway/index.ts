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
/**
 * @deprecated 请使用 channels/ 目录下的 IChannelPlugin 体系替代。
 *   core/gateway/ 为遗留 Gateway Channel 体系，实现于 2025 年。
 *   新体系位于 channels/ 目录，包含 ChannelRegistry、IChannelPlugin、
 *   ChannelManager 等统一接口。
 *
 *   注意：新旧体系当前深度交织——channels/registry/ChannelRegistry
 *   仍从本文件导入 ChannelPluginRegistry 类型。迁移时应确保
 *   新体系不再依赖旧类型后方可移除此模块。
 *
 *   此模块将在未来版本中移除。
 */
export {
  ChannelType,
  ChannelStatus,
  MessageDirection,
  ChannelEvent,
} from './types';

export type {
  InboundMessage,
  OutboundMessage,
  ChannelConfig,
  ChannelEventCallbacks,
  ChannelStats,
  GatewayChannel,
} from './types';

export { ChannelManager } from './ChannelManager';
export {
  createChannelManager,
  getChannelManager,
  disconnectAllChannels,
} from './ChannelManagerFactory';

export type {
  ChannelManagerConfig,
  ChannelManagerStatus,
} from './ChannelManager';

export { TelegramChannel } from './TelegramChannel';

export type { TelegramChannelConfig } from './TelegramChannel';

export { WebChannel } from './WebChannel';

export type { WebChannelConfig } from './WebChannel';

export { setupGatewayFromConfig } from './GatewaySetup';

export type { GatewaySetupResult } from './GatewaySetup';

export { HealthMonitor } from './HealthMonitor';

export type {
  HealthConfig,
  HealthReport,
  HealthStatus,
  HealthEvent,
} from './HealthMonitor';

export { ChannelStatusReporter } from './ChannelStatusReporter';

export type {
  ChannelSnapshot,
  StatusReport,
  ReporterEvent,
} from './ChannelStatusReporter';

export { RateLimiter } from './RateLimiter';

export type {
  RateLimitConfig,
  RateLimitResult,
  RateLimitBucket,
} from './RateLimiter';

export { GatewayAuth } from './auth/GatewayAuth';

export type {
  AuthResult,
  AuthCredentials,
  GatewayAuthenticator,
  AuthConfig,
} from './auth/GatewayAuth';

export {
  createRequestFrame,
  createResponseFrame,
  createEventFrame,
  createErrorFrame,
  isRequestFrame,
  isResponseFrame,
  isEventFrame,
  isErrorFrame,
  isInboundFrame,
  getFrameId,
  computeWebSocketAcceptKey,
} from './protocol/frames';

export type {
  RequestFrame,
  ResponseFrame,
  EventFrame,
  ErrorFrame,
  GatewayFrame,
  InboundFrame,
  ErrorCode,
} from './protocol/types';

export { ChannelPluginRegistry, RegistryEvent } from './ChannelPluginRegistry';

export type { RegistryCallbacks } from './ChannelPluginRegistry';

export type {
  ChannelPlugin,
  ChannelCapabilities,
  PluginValidationResult,
} from './ChannelPlugin';
export { isChannelPlugin } from './ChannelPlugin';

export { GatewayMcpBridge, gatewayMcpBridge } from './mcp/GatewayMcpBridge.js';
export type {
  McpToolDefinition,
  McpCallRequest,
  McpCallResponse,
} from './mcp/GatewayMcpBridge.js';
