/**
 * ACP 协议入口（归一化）
 *
 * 原 agent/acp/ 的实现已合并到 core/acp/，
 * 本文件作为向后兼容的 re-export 层。
 *
 * @deprecated 直接从 @modules/core/acp 导入
 */
export { AcpTransportClient as AcpClient } from '../../core/acp/index.js';
export { AcpTransportServer as AcpServer } from '../../core/acp/index.js';
export type {
  AcpMessageType,
  AcpMessagePriority as AcpPriority,
  AcpMessage,
  AcpSessionInfo as AcpSession,
  AcpMessageHandler as AcpHandler,
  AcpServerConfig,
} from '../../core/acp/index.js';
