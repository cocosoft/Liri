/**
 * 聊天模块类型聚合导出
 */
export type { Message, NormalizedMessage } from './message';
export {
  MessageRole,
  MessageType,
  MessageStatus,
  MessagePriority,
} from './message';
export type {
  LiriEvent,
  LiriEventType,
  LiriEventMap,
  LiriEventCategory,
  LiriEventData,
  LiriEventOf,
} from './events';
export { isLiriEvent, categorizeEvent } from './events';
