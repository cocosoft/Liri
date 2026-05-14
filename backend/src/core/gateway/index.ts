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

export {
  ChannelManager,
  createChannelManager,
  getChannelManager,
  disconnectAllChannels,
} from './ChannelManager';

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

export { GatewayServer } from './GatewayServer';

export type {
  GatewayServerConfig,
  GatewayClient,
  GatewayStats,
  GatewayEvent,
} from './GatewayServer';

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
export { TokenAuth } from './auth/TokenAuth';
export { DeviceAuth } from './auth/DeviceAuth';

export type {
  AuthResult,
  AuthCredentials,
  GatewayAuthenticator,
  AuthConfig,
} from './auth/GatewayAuth';
export type { TokenAuthConfig, TokenUserInfo } from './auth/TokenAuth';
export type { DeviceAuthConfig, PendingDeviceCode } from './auth/DeviceAuth';

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

export { ControlUI } from './control-ui/ControlUI.js';
export type {
  ControlUIConfig,
  DashboardMetrics,
  DashboardPage,
} from './control-ui/ControlUI.js';
