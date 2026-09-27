/**
 * InboxBlock — 聊天消息中的 Inbox 审批交互卡片
 *
 * 在 AI 回复消息中渲染为可交互的审批卡片，用户可直接点击按钮操作，
 * 无需离开聊天页面。支持 pending / replied / expired 三种状态。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { InboxBlockData } from "../../types";
import { http } from "../../services/httpClient";
import { useToastStore } from "../../stores/toastStore";

interface Props {
  data: InboxBlockData;
  sessionId?: string;
  onResolved?: () => void;
}

/** 类型标签 i18n 键（未登记的类型回退后端原值显示，CS06） */
const TYPE_LABEL_KEYS: Record<string, string> = {
  approval: "chat.inboxTypeApproval",
  question: "chat.inboxTypeQuestion",
  authorization: "chat.inboxTypeAuthorization",
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
  const { t } = useTranslation();

  const handleAction = async (reply: string) => {
    if (replying || status !== "pending") return;
    setReplying(true);

    try {
      const res = await http.post<unknown>(`/v1/inbox/${data.inboxId}/reply`, {
        reply,
      });
      if (res.ok) {
        setStatus("replied");
        const label =
          reply === "approve"
            ? t("chat.inboxReplyApprove")
            : reply === "reject"
              ? t("chat.inboxReplyReject")
              : reply === "allowlist_tool"
                ? t("chat.inboxReplyAllowTool")
                : reply === "allowlist_command"
                  ? t("chat.inboxReplyAllowCommand")
                  : t("chat.reply");
        addToast("success", t("chat.inboxRepliedToast", { label }));
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
            const { sessionService } =
              await import("../../services/sessionService");
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
        addToast("error", String(res.error || t("common.failed")));
      }
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setReplying(false);
    }
  };

  const isPending = status === "pending";
  const isExpired = status === "expired";
  const isUrgent = data.priority === "urgent";

  // P2-8：过期倒计时原为渲染期一次性快照（`Date.now()` 只在重渲染时取一次）
  // ⇒ 卡片长时间停留在页面上时"X 分钟后过期"会冻结在首次渲染的值。
  // 以 30s 心跳驱动重算；仅在确实有待过期项时运行。
  const [, setClockTick] = useState(0);
  useEffect(() => {
    if (!(isPending && data.expiresAt)) return;
    const timer = setInterval(() => setClockTick((v) => v + 1), 30_000);
    return () => clearInterval(timer);
  }, [isPending, data.expiresAt]);

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
          📋{" "}
          {(TYPE_LABEL_KEYS[data.type] && t(TYPE_LABEL_KEYS[data.type])) ||
            data.type}
        </span>
        {isUrgent && (
          <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-900/30 dark:text-red-400">
            {t("chat.urgent")}
          </span>
        )}
        <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
          {data.title}
        </span>
        {isPending && data.expiresAt && (
          <span className="ml-auto shrink-0 text-[10px] text-gray-400">
            {t("chat.expiresInMinutes", {
              count: Math.max(
                0,
                Math.ceil((data.expiresAt - Date.now()) / 60000),
              ),
            })}
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
            ✅ {t("chat.inboxResuming")}
          </span>
        )}

        {/* 已处理状态 */}
        {!isPending && !isExpired && !resuming && (
          <span className="text-xs text-green-600 dark:text-green-400">
            ✅ {t("chat.inboxHandled")}
          </span>
        )}

        {/* 已过期状态 */}
        {isExpired && (
          <span className="text-xs text-gray-400">
            ⏰ {t("chat.inboxExpired")}
          </span>
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
