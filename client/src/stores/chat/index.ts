/**
 * Chat Store — 消息流、文件管理、工具调用
 *
 * 使用 Zustand StateCreator 模式组合多个 slice。
 */
import { create } from "zustand";
import { createMessageSlice, type MessageSlice } from "./chat-message.slice";
import { createFileSlice, type FileSlice } from "./chat-file.slice";
import { withStoreLogging } from "../../utils/storeLogger";

// Re-export toolcall utilities
export {
  ChronologicalBlockBuilder,
  createThinkExtractor,
  generateBlockId,
  generateGroupId,
  findLastToolCallId,
  normalizeToolCall,
  rebuildBlocksFromContent,
} from "./chat-toolcall.slice";

// Re-export history utilities
export {
  shouldAutoRename,
  doAutoRename,
  _getCachedMessages,
  flushSaveBlocks,
} from "./chat-history.slice";

// Re-export file utilities
export { inferFileType, extractFileName } from "./chat-file.slice";
export type { FileType } from "./chat-file.slice";

/** 组合后的 Chat Store 状态类型 */
export interface ChatState extends MessageSlice, FileSlice {}

/**
 * 创建 Chat Store
 */
export const useChatStore = create<ChatState>()((...a) => ({
  ...createMessageSlice(...a),
  ...createFileSlice(...a),
}));

// 状态变更日志（仅开发环境）
withStoreLogging(useChatStore, "chatStore", []);
