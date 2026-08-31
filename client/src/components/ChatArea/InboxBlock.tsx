/**
 * InboxBlock — 聊天消息中的 Inbox 审批交互卡片
 *
 * 在 AI 回复消息中渲染为可交互的审批卡片，用户可直接点击按钮操作，
 * 无需离开聊天页面。支持 pending / replied / expired 三种状态。
 */
import { useState } from "react";
import type { InboxBlockData } from "../../types";
import { http } from "../../services/httpClient";
import { useToastStore } from "../../stores/toastStore";

interface Props {
  data: InboxBlockData;
  sessionId?: string;
  onResolved?: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  approval: "审批",
  question: "提问",
  authorization: "授权",
};

/** 按钮样式映射 */
const ACTION_STYLE: Record<
  string,
  { bg: string; hover: string; darkBg: string; darkHover: string }
> = {
  primary: {
    bg: "bg-green-500",
    hover: "hover:bg-green-600",
    darkBg: "dark:bg-green-600",
    darkHover: "dark:hover:bg-green-700",
  },
  danger: {
    bg: "bg-red-500",
    hover: "hover:bg-red-600",
    darkBg: "dark:bg-red-600",
    darkHover: "dark:hover:bg-red-700",
  },
  secondary: {
    bg: "bg-gray-400",
    hover: "hover:bg-gray-500",
    darkBg: "dark:bg-gray-500",
    darkHover: "dark:hover:bg-gray-600",
  },
};

export default function InboxBlock({ data, sessionId, onResolved }: Props) {
  const [status, setStatus] = useState(data.status);
  const [replying, setReplying] = useState(false);
  const [resuming, setResuming] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  const handleAction = async (reply: string) => {
    if (replying || status !== "pending") return;
    setReplying(true);

    try {
      const res = await http.post<any>(`/v1/inbox/${data.inboxId}/reply`, {
        reply,
      });
      if (res.ok) {
        setStatus("replied");
        const label =
          reply === "approve"
            ? "批准"
            : reply === "reject"
              ? "拒绝"
              : reply === "allowlist_tool"
                ? "加入工具白名单"
                : reply === "allowlist_command"
                  ? "加入命令白名单"
                  : "回复";
        addToast("success", `已${label}`);
        onResolved?.();

        // P2-1 + P2-4 → M2-T2.1（2026-08-31）：批准类 reply 的续跑责任收敛到后端——
        // inbox-handlers 已 fire-and-forget 触发续跑（checkpoint/resume 优先，无检查点
        // 时从 events.jsonl 尾部重建未完成 turn）。前端只做"触发 + 展示"：
        // 不再查询检查点、不再轮询、不再降级 sendMessage 重发。
        const isApproveLike =
          reply === "approve" ||
          reply === "allowlist_tool" ||
          reply === "allowlist_command";
        if (isApproveLike && sessionId) {
          setResuming(true);
          try {
            // 后端续跑落盘需要时间：延迟刷新一次消息展示结果（SSE 无消息级事件）
            const { sessionService } = await import(
              "../../services/sessionService"
            );
            const { useChatStore } = await import("../../stores/chat");
            await new Promise((r) => setTimeout(r, 3000));
            const messages = await sessionService.getMessages(sessionId);
            useChatStore.getState().setMessages(messages);
          } catch {
            // 刷新失败不阻塞审批状态（用户可手动切换会话查看续跑结果）
          } finally {
            setResuming(false);
          }
        }
      } else {
        addToast("error", String(res.error || "操作失败"));
      }
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : "操作失败");
    } finally {
      setReplying(false);
    }
  };

  const isPending = status === "pending";
  const isExpired = status === "expired";
  const isUrgent = data.priority === "urgent";

  return (
    <div
      className={`my-2 rounded-xl border bg-white p-3 shadow-sm dark:bg-gray-800
      ${
        isUrgent
          ? "border-red-300 dark:border-red-700 bg-red-50/30 dark:bg-red-950/20"
          : "border-gray-200 dark:border-gray-700"
      }`}
    >
      {/* 头部：类型标签 + 优先级 + 标题 */}
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
          📋 {TYPE_LABELS[data.type] || data.type}
        </span>
        {isUrgent && (
          <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-900/30 dark:text-red-400">
            紧急
          </span>
        )}
        <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
          {data.title}
        </span>
        {isPending && data.expiresAt && (
          <span className="ml-auto shrink-0 text-[10px] text-gray-400">
            {Math.max(0, Math.ceil((data.expiresAt - Date.now()) / 60000))}{" "}
            分钟后过期
          </span>
        )}
      </div>

      {/* 内容 */}
      {data.content && (
        <p className="mb-3 text-xs text-gray-600 dark:text-gray-400">
          {data.content}
        </p>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center gap-2">
        {isPending &&
          data.actions.map((action) => {
            const s = ACTION_STYLE[action.style] || ACTION_STYLE.secondary;
            return (
              <button
                key={action.reply}
                onClick={() => handleAction(action.reply)}
                disabled={replying}
                className={`rounded-lg px-3 py-1 text-xs font-medium text-white transition-colors disabled:opacity-50 ${s.bg} ${s.hover} ${s.darkBg} ${s.darkHover}`}
              >
                {replying ? "..." : action.label}
              </button>
            );
          })}

        {/* P2-1: 批准后自动续跑中 —— 避免用户感知空转 */}
        {resuming && (
          <span className="text-xs font-medium text-green-600 dark:text-green-400">
            ✅ 已批准，正在执行…
          </span>
        )}

        {/* 已处理状态 */}
        {!isPending && !isExpired && !resuming && (
          <span className="text-xs text-green-600 dark:text-green-400">
            ✅ 已处理
          </span>
        )}

        {/* 已过期状态 */}
        {isExpired && (
          <span className="text-xs text-gray-400">⏰ 已超时过期</span>
        )}

        {/* 来源渠道 */}
        {data.channelSource && (
          <span className="ml-auto text-[10px] text-gray-400">
            💬 {data.channelSource}
          </span>
        )}
      </div>
    </div>
  );
}
