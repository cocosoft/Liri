/**
 * Chat Message Slice — setMessages 实现
 *
 * 从 chat-message.slice.ts 拆出（R04-001 文件行数限制治理）。
 * setMessages：加载历史消息时重建 blocks 结构（tool 结果合并 / 连续 assistant 合并 / groupId 迁移）。
 */
import type { Message, MessageBlock, FilePreview } from "@/types";
import { addFilePathsFromBlocks } from "./chat-file.slice";
import {
  generateGroupId,
  findLastToolCallId,
  rebuildBlocksFromContent,
  hasMeaningfulContentBlocks,
  ensureTextBlockFromContent,
} from "./chat-toolcall.slice";
import { setSessionCache, enqueueSaveBlocks } from "./chat-history.slice";
import { restorePlanTasks } from "@/utils/planRestore";
import { handleClientError } from "@/utils/handleError";
import {
  switchState,
  clearToolResultCache,
  cacheToolResult,
  truncateResult,
  MAX_INLINE_RESULT_LENGTH,
} from "./chat-message-shared";
import type { MessageSet, MessageGet } from "./chat-message.types";

/**
 * AB-7 修复：历史加载时归一化 tool_call 块。
 * 流中断/异常退出时，后端落盘的 tool_call 块可能残留 "running" 状态，
 * 若原样渲染，前端工具卡片会永久显示"执行中"。
 * 历史数据代表已完成的一轮，一律归一化为最终态：running → failed。
 */
function normalizeLoadedBlock(block: MessageBlock): MessageBlock {
  if (block.type === "tool_call" && block.toolCall?.status === "running") {
    return {
      ...block,
      isStreaming: false,
      toolCall: { ...block.toolCall, status: "failed" },
    };
  }
  return { ...block, isStreaming: false };
}

/**
 * 加载历史消息时为 assistant 消息重建 blocks 结构
 * 确保 AssistantMessage 组件能正确分组渲染（text / tool_call 等）
 * 如果后端已保存 blocks，则直接使用，否则自动重建。
 */
export function setMessagesImpl(
  set: MessageSet,
  get: MessageGet,
  messages: Message[],
): void {
  // BUG F2 修复: 每次加载新消息时清理旧缓存，防止内存无限增长
  clearToolResultCache();

  // 会话切换锁：挂起流式写入，防止 loadSessions 覆盖流式数据
  switchState.lock = true;

  try {
    // 缓存写入：仅当传入完整消息列表时（非空且非增量更新）
    // 使用第一条消息的 session_id 作为缓存 key
    if (messages.length > 0 && messages[0].session_id) {
      const cacheKey = messages[0].session_id;
      setSessionCache(cacheKey, messages);
    }

    // Phase 1: 收集 tool 角色消息，建立 toolCallId → content 映射
    // 这些工具结果在后端作为独立消息持久化，前端需合并回 assistant 消息的 blocks 中
    // 同时缓存全量结果到缓存，block 中只存截断摘要
    const toolResultsByCallId = new Map<string, string>();
    const filteredMessages: Message[] = [];

    for (const msg of messages) {
      if (msg.role === "tool" && msg.toolCallId) {
        const rawContent = typeof msg.content === "string" ? msg.content : "";
        toolResultsByCallId.set(msg.toolCallId, rawContent);
        // 全量结果存入独立缓存（LRU 淘汰），不在 block 中内联
        cacheToolResult(msg.toolCallId, rawContent);
      } else if (
        Array.isArray(msg.blocks) &&
        msg.blocks.some((b) => b.type === "progress")
      ) {
        // 历史兼容：progress 块是执行中的临时状态（此前 freezeAll 未移除被持久化），
        // 加载时过滤，避免"正在执行工具"等状态文字作为正文显示
        filteredMessages.push({
          ...msg,
          blocks: msg.blocks.filter((b) => b.type !== "progress"),
        });
      } else {
        filteredMessages.push(msg);
      }
    }

    // Phase 1.5（H-FIX-3 2026-08-21）：按消息 ID 去重，拦截磁盘 JSONL 重复写入行。
    // 后端流式异常/多次 flush 时可能把同 id 的消息写多行到 JSONL，
    // 导致 React Virtual 列表 key={message.id} 冲突——虚拟列表的测量缓存和
    // DOM 复用会被污染，整列表渲染错位，产生"第一条 AI 回复包含第二轮内容"
    // 的视觉错觉。保留同一 id 的最后一条（后者通常是最后写入的完整版本）。
    const seenIds = new Set<string>();
    const dedupMessages: Message[] = [];
    for (let i = filteredMessages.length - 1; i >= 0; i--) {
      const msg = filteredMessages[i];
      if (msg.id && seenIds.has(msg.id)) continue;
      if (msg.id) seenIds.add(msg.id);
      dedupMessages.unshift(msg);
    }

    // Phase 2: 合并连续的 assistant 消息
    // 多轮工具调用时，后端将每轮 LLM 回复存为独立 assistant 消息，
    // 导致加载历史后出现多个"🤖 Liri"气泡。此处合并为一条消息，与流式体验一致。
    const mergedMessages: Message[] = [];
    for (const msg of dedupMessages) {
      if (msg.role !== "assistant") {
        mergedMessages.push(msg);
        continue;
      }

      const lastIdx = mergedMessages.length - 1;
      const lastMsg = mergedMessages[lastIdx];
      if (lastMsg && lastMsg.role === "assistant") {
        mergedMessages[lastIdx] = {
          ...lastMsg,
          content: (lastMsg.content || "") + (msg.content || ""),
          timestamp: lastMsg.timestamp || msg.timestamp,
          blocks: [
            ...(lastMsg.blocks || []),
            ...(Array.isArray(msg.blocks) ? msg.blocks : []).map((b) =>
              normalizeLoadedBlock(b),
            ),
          ],
          tool_calls: [
            ...(lastMsg.tool_calls || []),
            ...(msg.tool_calls || []),
          ],
        };
      } else {
        mergedMessages.push({ ...msg });
      }
    }

    // Phase 3: 处理合并后的消息，将工具结果合并到对应 assistant 消息的 tool_call 块中
    const enhancedMessages = mergedMessages.map((msg) => {
      if (msg.role !== "assistant") return msg;

      // H-FIX：只有 blocks 非空且含实际内容块时才走"已有 blocks"分支。
      // 若 blocks 仅含 status/progress（如 compaction 标记），说明流式中状态块被
      // 落盘但正文 text 块缺失，强制走 rebuildBlocksFromContent 从 content 重建。
      if (
        Array.isArray(msg.blocks) &&
        msg.blocks.length > 0 &&
        hasMeaningfulContentBlocks(msg.blocks)
      ) {
        // 先处理已有 blocks：合并工具结果 + 迁移 groupId
        let hasMergedResult = false;
        const mergedBlocks = msg.blocks.map((b) => {
          const block = normalizeLoadedBlock(b);
          if (
            block.type === "tool_call" &&
            block.toolCall?.id &&
            toolResultsByCallId.has(block.toolCall.id)
          ) {
            const fullResult = toolResultsByCallId.get(block.toolCall.id)!;
            hasMergedResult = true;
            // 只注入截断摘要到 block，全量结果通过 getToolResultFull() 按需获取
            block.toolCall = {
              ...block.toolCall,
              result: truncateResult(fullResult),
              _hasFullResult:
                fullResult.length > MAX_INLINE_RESULT_LENGTH || undefined,
            };
          }
          return block;
        });

        if (hasMergedResult) {
          const merged = { ...msg, blocks: mergedBlocks };
          return {
            ...merged,
            blocks: ensureTextBlockFromContent(merged.blocks, merged),
          };
        }

        // 无匹配工具结果时，执行 groupId 迁移（旧 blocks 兼容）
        const oldBlocksHaveGroupId = msg.blocks.some((b) => b.groupId);
        if (oldBlocksHaveGroupId) {
          const migrated = {
            ...msg,
            blocks: msg.blocks.map((b) => normalizeLoadedBlock(b)),
          };
          return {
            ...migrated,
            blocks: ensureTextBlockFromContent(migrated.blocks, migrated),
          };
        }
        const lastToolCallId = findLastToolCallId(msg);
        const enhancedBlocks = msg.blocks.map((b) => {
          if (b.groupId) return normalizeLoadedBlock(b);
          const id =
            b.toolCallId ||
            b.toolCall?.id ||
            lastToolCallId ||
            generateGroupId();
          return { ...normalizeLoadedBlock(b), groupId: "migrate_" + id }; // "migrate_" 前缀标记历史数据，与流式 "grp_" 区分
        });
        const enhanced = { ...msg, blocks: enhancedBlocks };
        return {
          ...enhanced,
          blocks: ensureTextBlockFromContent(enhanced.blocks, enhanced),
        };
      }

      const newBlocks = rebuildBlocksFromContent(msg);
      return { ...msg, blocks: newBlocks, tool_calls: undefined };
    });

    // Phase 4: 从历史消息中的 tool_call 块中提取文件路径（仅同步收集，不做异步路径解析）
    const sessionFilesList: FilePreview[] = [];
    const addedPaths = new Set<string>();

    for (const msg of enhancedMessages) {
      if (msg.role === "assistant" && msg.blocks) {
        addFilePathsFromBlocks(
          msg.blocks,
          (file) => {
            if (!addedPaths.has(file.path)) {
              addedPaths.add(file.path);
              sessionFilesList.push(file);
            }
          },
          () => get().sessionFiles,
          // 不触发异步 setState：文件路径解析留到预览时按需执行
          () => {},
        );
      }
    }

    // 检测是否有待用户回答的 question 块
    const hasQuestion = enhancedMessages.some((m) =>
      m.blocks?.some((b) => b.type === "question"),
    );
    // P2-3: 按会话记录 pending question（setMessages 作用于当前会话）
    const questionSessionId = messages[0]?.session_id ?? "default";
    const pendingQuestion = {
      ...get().hasPendingQuestion,
      [questionSessionId]: hasQuestion,
    };

    // BUG-4 修复：sessionFiles 完全替换为当前会话提取的文件列表。
    // 原实现与 get().sessionFiles 合并，切换会话时旧会话文件残留，
    // 导致 knownFilePaths 混入上一会话路径、代码被错误匹配成 FileLink。
    set({
      messages: enhancedMessages,
      sessionFiles: sessionFilesList,
      hasPendingQuestion: pendingQuestion,
      streamingStatus: "",
      executionPhase: null,
    });

    // 释放会话切换锁后刷新暂存的流式 chunk
    switchState.lock = false;
    if (switchState.pending.length > 0) {
      // 暂存 chunk 的 sessionId 可能与当前会话不一致（跨会话切换），入队到全局 SaveQueue
      const lastChunk = switchState.pending[switchState.pending.length - 1];
      enqueueSaveBlocks(
        lastChunk.sessionId,
        lastChunk.assistantId,
        lastChunk.blocks,
        true, // immediate 保存
      );
      switchState.pending = [];
    }

    // #12：历史加载后从后端恢复 TaskCard 真实状态（fire-and-forget，不阻塞渲染）。
    // 刷新/重连后 planTaskStore 已清空，回退静态快照会永久"执行中"；
    // 后端 Plan 已持久化，扫描 task_decomposition blocks 的 planId 逐个拉取恢复。
    void restorePlanTasks(enhancedMessages);
  } catch (e) {
    // 确保会话切换锁一定释放，防止锁泄漏导致后续流式输出永久阻塞
    switchState.lock = false;
    switchState.pending = [];
    handleClientError(
      e,
      { module: "stores:chat:message", action: "setMessages" },
      "error",
    );
    // 设置空消息列表作为降级，避免界面卡在旧数据上
    set({ messages: [], streamingStatus: "", executionPhase: null });
  }
}
