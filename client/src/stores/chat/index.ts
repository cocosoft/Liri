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
  hasMeaningfulContentBlocks,
  ensureTextBlockFromContent,
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
  const messages = useChatStore.getState().messages;
  // BUG-6 修复（2026-08-23）：新会话（messages 为空）时放行——原 messages.some
  // 永远 false，导致第一个 plan:task_card 被丢弃、任务分解卡片整个不出现。
  if (messages.length === 0) return true;
  // #4 修复：改用 some()（与 isTaskEventForCurrentSession/AB-22 一致），
  // 原 messages[0] 判断在新会话（无消息）或首条消息非目标会话时误丢 TaskCard 事件
  return messages.some((m) => m.session_id === sid);
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
  // #8 修复：拷贝数组，避免直接修改 SSE 事件原始数据（脏副作用）
  // BUG-5 修复（2026-08-23）：尊重后端各任务自带的 status，不再无条件把第一步
  // 强制置为 in_progress——恢复/重放场景下后端已完成的第一步会被错误回退。
  if (tasks.length > 0) {
    taskCard.tasks = tasks.map((t) => ({ ...t }));
  }
  usePlanTaskStore.getState().upsert(planId, taskCard);

  // P0-1 修复（2026-08-25）：按 planId 去重——已存在同 planId 的 task_decomposition 块
  // 则仅更新该块快照，不再 addMessage 插入新消息。后端 _broadcastTaskCard 可能
  // 多轮/重复广播（_launchImplicitPdca 无去重），原实现每次 addMessage → 重复卡片。
  const existingPlanMsg = useChatStore
    .getState()
    .messages.find((m) =>
      m.blocks?.some(
        (b) => b.type === "task_decomposition" && b.taskCard?.planId === planId,
      ),
    );
  if (existingPlanMsg) {
    useChatStore.setState({
      messages: useChatStore.getState().messages.map((m) =>
        m.id === existingPlanMsg.id
          ? {
              ...m,
              blocks: (m.blocks ?? []).map((b) =>
                b.type === "task_decomposition" && b.taskCard?.planId === planId
                  ? { ...b, taskCard: { ...taskCard, planId } }
                  : b,
              ),
            }
          : m,
      ),
    });
    planLogger.debug(
      `[plan:task_card] planId=${planId} 已存在，更新块快照去重`,
    );
    return;
  }

  // 在聊天流中插入 task_decomposition 消息
  // L4 修复（2026-08-23）：plan_msg 分配 lastEventSeq（当前消息最大 seq）——
  // 原无该字段，历史加载时 setMessages 排序兜底 0 使 plan_msg 跳至会话最前（顺序错位）。
  const lastEventSeq = useChatStore
    .getState()
    .messages.reduce(
      (max, m) =>
        typeof m.lastEventSeq === "number" && m.lastEventSeq > max
          ? m.lastEventSeq
          : max,
      0,
    );
  const planMsg: Message = {
    id: nextPlanMsgId(),
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    lastEventSeq,
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
  const status = data.status as
    "completed" | "failed" | "cancelled" | "in_progress";
  const durationMs = data.durationMs as number | undefined;

  // S3/BUG-4 修复（2026-08-23）：直接采用后端广播状态（completed/failed/cancelled/
  // in_progress），删除"每收一步完成就推进下一个 pending 为 in_progress"的猜状态
  // 逻辑——执行中状态一律以后端广播为准（markStepRunning 已补发 in_progress）。
  usePlanTaskStore.getState().updateTask(planId, stepId, {
    status,
    ...(durationMs !== undefined ? { durationMs } : {}),
  });
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
  // F8（2026-08-25）：planTaskStore 缺失条目（SSE 断连窗口）时不再直接 return——
  // 回退扫描消息块按 planId 置 done，避免任务卡永久"执行中"
  const finalCard: TaskCardData =
    current === undefined
      ? { planId, status: "done", title: "", tasks: [] }
      : { ...current, status: "done" };
  if (current) {
    store.upsert(planId, finalCard);
  }

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
