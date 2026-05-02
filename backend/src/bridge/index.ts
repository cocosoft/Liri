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
export { createCapacityWake, type CapacityWake, type CapacitySignal } from './utils/CapacityWake';
export { extractInboundMessageFields, hasImageBlocks, extractImageData, type SDKMessage } from './utils/InboundMessages';

// Manager导出
export { BridgeMain } from './BridgeMain';
export { createPollManager } from './managers/PollManager';
export { createSessionManager } from './managers/SessionManager';
export { createHeartbeatManager } from './managers/HeartbeatManager';
export { createWorktreeManager } from './managers/WorktreeManager';

// 多会话管理
export * from './sessions';

// 容量管理
export * from './capacity';

// 安全管理
export * from './security';
