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
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:inboxBlock");

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

        // P2-1 + P2-4: 批准类 reply（含两个白名单按钮）后自动续跑 ——
        // 优先后端 checkpoint/resume（不依赖 LLM 自发重发）。
        // 可恢复：显示"已批准，正在执行…"，轮询刷新消息看到后端续跑落盘结果；
        // 不可恢复：降级为原 sendMessage 触发 LLM 重发（放行缓存命中直接执行）。
        const isApproveLike =
          reply === "approve" ||
          reply === "allowlist_tool" ||
          reply === "allowlist_command";
        if (isApproveLike && sessionId) {
          setResuming(true);
          try {
            const resumed = await tryResumeAfterApproval(sessionId);
            if (!resumed) {
              const { useChatStore } = await import("../../stores/chat");
              const send = useChatStore.getState().sendMessage;
              await send(
                `[审批已批准] ${data.title}\n${data.content || ""}\n我已批准该操作，请继续执行。`,
                sessionId,
              );
            }
          } catch {
            // 触发续跑失败不阻塞审批状态（用户可手动继续对话）
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

  /**
   * P2-1: 尝试后端自动续跑 —— 查最新检查点是否可恢复；可恢复则轮询刷新消息，
   * 等待后端 resumeStream 重放 pendingApproval 工具并把结果落盘。
   * @returns 是否已通过后端续跑（false 时调用方需降级触发）
   */
  async function tryResumeAfterApproval(sid: string): Promise<boolean> {
    let checkpointAvailable = false;
    try {
      // W6 收尾（2026-08-31）：改走统一 http 客户端（Tauri 下 Rust 代理注入密钥）
      const { http } = await import("../../services/httpClient");
      const latestResp = await http.get<{ checkpointAvailable?: boolean }>(
        `/v1/sessions/${sid}/checkpoints/latest`,
      );
      if (!latestResp.ok) return false;
      checkpointAvailable = !!latestResp.data?.checkpointAvailable;
    } catch (e) {
      // 检查点查询失败（后端未就绪/网络异常）→ 返回 false 让调用方降级 sendMessage 续跑，
      // 不抛异常（此前 fetch 异常直接上抛被 handleAction catch 吞掉，降级分支被跳过）
      logger.warn("检查点查询失败，降级 sendMessage 续跑", {
        sessionId: sid,
        error: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
    if (!checkpointAvailable) return false;

    const { sessionService } = await import("../../services/sessionService");
    const { useChatStore } = await import("../../stores/chat");
    // 轮询 4 次 × 2s：后端续跑（工具重放 + LLM）落盘后前端刷新可见
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const messages = await sessionService.getMessages(sid);
        useChatStore.getState().setMessages(messages);
      } catch {
        // 单次刷新失败继续等待
      }
    }
    return true;
  }

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
