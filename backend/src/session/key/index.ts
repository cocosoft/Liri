/**
 * SessionKeyManager 导出（加密密钥管理）
 */
export { SessionKeyManager, sessionKeyManager } from './SessionKeyManager.js';
export type { KeyConfig, SessionKey } from './SessionKeyManager.js';

/**
 * 结构化会话路由 Key 导出
 */
export {
  SessionKey,
  SESSION_KEY_PREFIX,
  VALID_CHAT_TYPES,
} from './SessionKey.js';
export type { SessionKeyParts, ChatType } from './SessionKey.js';
export { SessionKeyFactory } from './SessionKeyFactory.js';
export type { SessionKeyFactoryConfig } from './SessionKeyFactory.js';
export { LegacyKeyAdapter, LEGACY_PREFIX } from './LegacyKeyAdapter.js';
export { SessionRouter } from './SessionRouter.js';
export type { SessionRoute } from './SessionRouter.js';
export { formatSessionSource, sessionSourceEquals } from './SessionSource.js';
export type { SessionSource, SessionPlatform, SessionChatType } from './SessionSource.js';
