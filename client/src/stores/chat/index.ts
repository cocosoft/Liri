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
export { _getCachedMessages, flushSaveBlocks } from "./chat-history.slice";

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
  // AB-22 修复：messages[0] 在列表为空（新会话尚无消息）或首条消息非目标会话时误判；
  // 改用 some() 检查该会话消息是否在 store 中（与 messages:deleted 处理模式一致）
  return useChatStore.getState().messages.some((m) => m.session_id === sid);
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

// 根因 C：后端崩溃恢复把当前会话标记 PAUSED 后的主动通知（SSE 推送）
sseService.on("session:paused", (data: Record<string, unknown>) => {
  const sid = data.sessionId as string | undefined;
  // AB-22 模式统一：some() 判断而非 messages[0]（新会话/首条非目标会话时不误判）
  if (
    !sid ||
    !useChatStore.getState().messages.some((m) => m.session_id === sid)
  )
    return;
  useChatStore.setState({
    streamingStatus: "会话已暂停（检测到异常退出），可恢复后继续对话",
  });
});

// ── P2（08-09）：PlanDrivenLoop TaskCard 实时进度 ──────────────────────────

/** 检查计划事件是否属于当前会话 */
const isPlanEventForCurrentSession = (
  data: Record<string, unknown>,
): boolean => {
  const sid = data.sessionId as string | undefined;
  if (!sid) return false;
  // #4 修复：改用 some()（与 isTaskEventForCurrentSession/AB-22 一致），
  // 原 messages[0] 判断在新会话（无消息）或首条消息非目标会话时误丢 TaskCard 事件
  return useChatStore.getState().messages.some((m) => m.session_id === sid);
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
  // #8 修复：拷贝数组再改首个任务状态，避免直接修改 SSE 事件原始数据（脏副作用）
  if (tasks.length > 0) {
    taskCard.tasks = [
      { ...tasks[0], status: "in_progress" },
      ...tasks.slice(1),
    ];
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

  const newStatus: TaskCardTask["status"] =
    status === "completed" ? "completed" : "failed";

  // T3 修复：删除"task_card 未到时直接 return"的短路——
  // planTaskStore.updateTask 内部已有 pendingUpdates 竞态缓冲（#3），
  // 原实现短路使缓冲形同虚设，step_progress 先于 task_card 到达时事件静默丢失。
  store.updateTask(planId, stepId, {
    status: newStatus,
    ...(durationMs !== undefined ? { durationMs } : {}),
  });

  // 推进后续 pending 步骤需要 tasks 已就绪；task_card 未到时
  // 更新已由 updateTask 缓存，upsert 补发，无需在此处理
  if (!current) return;

  // #7 修复：不再依赖 progress 字段非空——step_progress 事件本身（completed/failed）
  // 即代表一步结束，直接推进下一个 pending 步骤；原实现 progress 为 null 时
  // （步骤完成但 Plan 进度未同步）后续任务全部停在 pending，卡片链断裂。
  // 用更新后的 tasks 查找（current 可能已被 updateTask 更新过）
  const latest = usePlanTaskStore.getState().tasks[planId];
  const nextPending = (latest?.tasks ?? current.tasks).find(
    (t) => t.status === "pending",
  );
  if (nextPending) {
    store.updateTask(planId, nextPending.id, { status: "in_progress" });
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

  const finalCard: TaskCardData = { ...current, status: "done" };
  store.upsert(planId, finalCard);

  // #5/#12：先把最终状态同步进消息块快照，再移除 planTaskStore 条目——
  // 移除后 TaskCard 回退到消息块（已是完成态，不会回退"执行中"）；
  // 刷新后 restorePlanTasks 会从后端重新拉取真实状态，双保险且消除内存泄漏。
  useChatStore.setState({
    messages: useChatStore.getState().messages.map((m) => ({
      ...m,
      blocks: (m.blocks ?? []).map((b) =>
        b.type === "task_decomposition" && b.taskCard?.planId === planId
          ? { ...b, taskCard: { ...finalCard, planId } }
          : b,
      ),
    })),
    streamingStatus: "",
  });
  store.remove(planId);
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
