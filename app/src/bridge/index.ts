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
 * Bridge模块统一入口
 * 导出所有Bridge相关的类型和类
 */

// 类型定义
export * from './types';

// 状态管理
export * from './state/BridgeStateStore';

// WebSocket客户端
export * from './websocket/WebSocketClient';

// 消息处理
export * from './messaging/BridgeMessaging';

// 错误处理
export * from './error/BridgeErrorHandler';

// 工具类
export { FlushGate } from './utils/FlushGate';
export {
  createCapacityWake,
  type CapacityWake,
  type CapacitySignal,
} from './utils/CapacityWake';
export {
  extractInboundMessageFields,
  hasImageBlocks,
  extractImageData,
  type SDKMessage,
} from './utils/InboundMessages';

// Channel-Bridge 集成（互补协同层）
export { ChannelBridgeAdapter } from './channel/ChannelBridgeAdapter';
export type {
  ChannelTaskMetadata,
  ChannelBridgeOptions,
} from './channel/ChannelBridgeAdapter';
export { BridgeChannelReporter } from './channel/BridgeChannelReporter';
export type {
  BridgeTaskReport,
  TaskReportStatus,
  ReporterConfig,
} from './channel/BridgeChannelReporter';
export { AgentDelegationOrchestrator } from './channel/AgentDelegationOrchestrator';
export type {
  SubTaskDef,
  DelegationScenario,
  DelegationSession,
} from './channel/AgentDelegationOrchestrator';

// Manager导出
export { BridgeMain } from './BridgeMain';
export { createPollManager } from './managers/PollManager';
export { createSessionManager } from './managers/SessionManager';
export { createHeartbeatManager } from './managers/HeartbeatManager';
export { createWorktreeManager } from './managers/WorktreeManager';

// Logger
export { createBridgeLogger } from './logger/BridgeLogger';

// 多会话管理
export * from './sessions';

// 会话运行器
export { createSessionRunner } from './SessionRunner';
export type {
  SessionActivity,
  SessionHandle,
  SessionSpawnOpts,
  SessionDoneStatus,
} from './types/index';

// 信任设备
export { TrustedDevice } from './TrustedDevice';
export type { TrustedDevice as TrustedDeviceType } from './TrustedDevice';

// 容量管理
export * from './capacity';
