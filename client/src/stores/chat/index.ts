/**
 * Chat Store — 消息流、文件管理、工具调用
 *
 * 使用 Zustand StateCreator 模式组合多个 slice。
 */
import { create } from "zustand";
import { createMessageSlice, type MessageSlice } from "./chat-message.slice";
import { createFileSlice, type FileSlice } from "./chat-file.slice";
import { withStoreLogging } from "../../utils/storeLogger";
import { sseService } from "../../services/sseService";
import { usePlanTaskStore } from "../planTaskStore";
import type { TaskCardData, TaskCardTask, Message } from "@/types";
import { generateBlockId } from "./chat-toolcall.slice";
import { createLogger } from "../../utils/logger";

const planLogger = createLogger("chat:planEvents");

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

// 跨 Tab 同步：监听其他 Tab 的消息删除/回退事件
sseService.on("messages:deleted", (data: Record<string, unknown>) => {
  const { sessionId, messageIds } = data as {
    sessionId?: string;
    messageIds?: string[];
  };
  if (!messageIds || messageIds.length === 0) return;

  const state = useChatStore.getState();
  // 从消息中推断当前会话（消息携带 session_id）
  const hasMessagesFromSession =
    sessionId != null && state.messages.some((m) => m.session_id === sessionId);
  if (!hasMessagesFromSession) return;

  const deletedSet = new Set(messageIds);
  useChatStore.setState({
    messages: state.messages.filter((m) => !deletedSet.has(m.id)),
  });
});

// §5 P2: 长程任务进度/完成实时提示（仅当前会话显示；任务消息由后端写回会话，
// 此处仅提供"任务运行中"的即时反馈）
const isTaskEventForCurrentSession = (
  data: Record<string, unknown>,
): boolean => {
  const sid = data.sessionId as string | undefined;
  if (!sid) return false;
  const msg = useChatStore.getState().messages[0];
  return msg?.session_id === sid;
};

sseService.on("task:progress", (data: Record<string, unknown>) => {
  if (!isTaskEventForCurrentSession(data)) return;
  const stepDesc = String(data.stepDesc ?? "");
  useChatStore.setState({ streamingStatus: `任务执行中: ${stepDesc}` });
});

sseService.on("task:completed", (data: Record<string, unknown>) => {
  if (!isTaskEventForCurrentSession(data)) return;
  useChatStore.setState({ streamingStatus: "" });
});

// ── P2（08-09）：PlanDrivenLoop TaskCard 实时进度 ──────────────────────────

/** 检查计划事件是否属于当前会话 */
const isPlanEventForCurrentSession = (
  data: Record<string, unknown>,
): boolean => {
  const sid = data.sessionId as string | undefined;
  if (!sid) return false;
  const msg = useChatStore.getState().messages[0];
  return msg?.session_id === sid;
};

/** 生成唯一消息 ID */
let _planMsgCounter = 0;
function nextPlanMsgId(): string {
  return `plan_msg_${Date.now().toString(36)}_${++_planMsgCounter}`;
}

sseService.on("plan:task_card", (data: Record<string, unknown>) => {
  const sessionMatch = isPlanEventForCurrentSession(data);
  planLogger.debug(
    `[plan:task_card] planId=${data.planId} sessionId=${data.sessionId} sessionMatch=${sessionMatch} title=${data.title} tasks=${(data.tasks as Array<unknown>)?.length ?? 0}`,
  );
  if (!sessionMatch) return;

  const planId = data.planId as string;
  const title = (data.title as string) || "任务分解";
  const tasks = (data.tasks as TaskCardTask[]) || [];
  const status = (data.status as TaskCardData["status"]) || "executing";

  const taskCard: TaskCardData = { title, tasks, status };
  // 标记第一个任务为 in_progress（plan 创建后立即开始执行）
  if (tasks.length > 0) {
    tasks[0] = { ...tasks[0], status: "in_progress" };
  }
  usePlanTaskStore.getState().upsert(planId, taskCard);

  // 在聊天流中插入 task_decomposition 消息
  const planMsg: Message = {
    id: nextPlanMsgId(),
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    session_id: data.sessionId as string,
    blocks: [
      {
        id: generateBlockId(),
        type: "task_decomposition",
        content: "",
        taskCard: { ...taskCard, planId },
      },
    ],
  };
  useChatStore.getState().addMessage(planMsg);
});

sseService.on("plan:step_progress", (data: Record<string, unknown>) => {
  const sessionMatch = isPlanEventForCurrentSession(data);
  planLogger.debug(
    `[plan:step_progress] planId=${data.planId} sessionId=${data.sessionId} sessionMatch=${sessionMatch} stepId=${data.stepId} status=${data.status} durationMs=${data.durationMs}`,
  );
  if (!sessionMatch) return;

  const planId = data.planId as string;
  const stepId = data.stepId as string;
  const status = data.status as "completed" | "failed";
  const durationMs = data.durationMs as number | undefined;

  const store = usePlanTaskStore.getState();
  const current = store.tasks[planId];
  if (!current) return;

  const newStatus: TaskCardTask["status"] =
    status === "completed" ? "completed" : "failed";

  store.updateTask(planId, stepId, {
    status: newStatus,
    ...(durationMs !== undefined ? { durationMs } : {}),
  });

  // 更新进度信息
  const progress = data.progress as
    | { total: number; completed: number; failed: number; percent: number }
    | undefined;
  if (progress) {
    // 更新尚未开始的下一个步骤为 in_progress
    const nextPending = current.tasks.find((t) => t.status === "pending");
    if (nextPending) {
      store.updateTask(planId, nextPending.id, { status: "in_progress" });
    }
  }
});

sseService.on("plan:completed", (data: Record<string, unknown>) => {
  const sessionMatch = isPlanEventForCurrentSession(data);
  planLogger.debug(
    `[plan:completed] planId=${data.planId} sessionId=${data.sessionId} sessionMatch=${sessionMatch}`,
  );
  if (!sessionMatch) return;

  const planId = data.planId as string;
  const store = usePlanTaskStore.getState();
  const current = store.tasks[planId];
  if (!current) return;

  store.upsert(planId, {
    ...current,
    status: "done",
  });

  useChatStore.setState({ streamingStatus: "" });
});

// ── 状态变更日志（仅开发环境，忽略流式高频字段避免日志洪流） ──
withStoreLogging(useChatStore, "chatStore", [
  "messages",
  "isStreaming",
  "streamingStatus",
  "executionPhase",
  "streamControllers",
  "rollbackSnapshot",
  "sessionFiles",
]);
