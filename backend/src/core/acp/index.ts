/**
 * ACP 模块统一出口
 *
 * 标准实现位于 src/agent/acp/（Acp* 命名，对标 OpenClaw acp/）
 * 本目录为向后兼容层，提供 Acl* 命名别名
 */

// 向后兼容：原有 Acl* 实现
export { AclClient } from './client.js';
export { AclServer } from './server.js';
export { AclSessionManager } from './session.js';
export { AclTranslator } from './translator.js';
export * from './types.js';

// 权限处理器（本目录独有）
export { ACPPermissionHandler } from './ACPPermissionHandler.js';
export type {
  ACPPermissionRequest,
  ACPPermissionResponse,
} from './ACPPermissionHandler.js';
export { ACPPermissionDecision } from './ACPPermissionHandler.js';

// 标准实现（从 agent/acp 引入）
export { AcpClient, AcpServer } from '../../agent/acp/index.js';
export type {
  AcpMessage,
  AcpMessageType,
  AcpPriority,
  AcpSession,
  AcpHandler,
  AcpServerConfig,
} from '../../agent/acp/index.js';
