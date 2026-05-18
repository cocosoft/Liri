/**
 * ACP (Agent Communication Protocol) 归一化入口
 * 对标 OpenClaw acp/
 *
 * 类型体系: core/acp/types.ts（已合并 agent/acp 和 core/acp 两套类型）
 * 实现: AcpTransportClient / AcpTransportServer / AcpSessionManager / AcpTranslator
 * 向下兼容: 所有 Acl* 旧名作为 deprecated 别名导出
 */
export { AcpTransportClient } from './client.js';
export { AcpTransportServer } from './server.js';
export { AcpSessionManager } from './session.js';
export { AcpTranslator } from './translator.js';
export * from './types.js';

export { ACPPermissionHandler } from './ACPPermissionHandler.js';
export type {
  ACPPermissionRequest,
  ACPPermissionResponse,
} from './ACPPermissionHandler.js';
export { ACPPermissionDecision } from './ACPPermissionHandler.js';

// 向下兼容别名
export { AcpTransportClient as AclClient } from './client.js';
export { AcpTransportServer as AclServer } from './server.js';
export { AcpSessionManager as AclSessionManager } from './session.js';
export { AcpTranslator as AclTranslator } from './translator.js';
