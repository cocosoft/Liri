import { create } from "zustand";

/**
 * outputGuardStore — 输出护栏结果的**前端可见状态**（PC-1，2026-10-07）
 *
 * 数据源：后端全局 SSE `system:output_guard`（`useNotificationSSE` 订阅）。
 * 用途：让用户知道**本轮回复被安全护栏打码/阻断** —— 后端命中护栏后会以安全文本
 * **替换**已流出正文（`updateMessageBlocks`），此前前端只见"内容被换过"（静默改写）。
 *
 * 状态口径（与后端 `OutputGuardNoticeAction` 对齐，CS02：结构化字段，非文案匹配）：
 * - `blocked`：正文被替换为安全提示；
 * - `redacted`：正文中的敏感信息被自动打码。
 *
 * 按 **messageId** 索引 ⇒ 标注落在**具体消息**上（不是会话级横幅）。
 */

export type OutputGuardAction = "blocked" | "redacted";

export interface OutputGuardNotice {
  messageId: string;
  action: OutputGuardAction;
  /** 事件到达时间 */
  at: number;
}

interface OutputGuardState {
  /** 按消息 id 记录护栏处置 */
  notices: Record<string, OutputGuardNotice>;
  /** 应用一条后端事件（字段做防御性解析；非法载荷忽略） */
  applyEvent: (raw: unknown) => void;
}

export const useOutputGuardStore = create<OutputGuardState>((set, get) => ({
  notices: {},

  applyEvent: (raw) => {
    const event = (raw ?? {}) as { messageId?: unknown; action?: unknown };
    const messageId =
      typeof event.messageId === "string" ? event.messageId : "";
    if (!messageId) return;

    const action = event.action;
    if (action !== "blocked" && action !== "redacted") return;

    set({
      notices: {
        ...get().notices,
        [messageId]: { messageId, action, at: Date.now() },
      },
    });
  },
}));
