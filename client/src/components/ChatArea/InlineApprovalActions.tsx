/**
 * U-06-5（2026-10-19）：工具卡片「就地审批」操作条。
 *
 * 背景：`tool_call.pendingApproval` 此前只有「⏳ 等待审批」徽标，用户必须
 * 另找会话内的 Inbox 卡片才能批准。后端现已在 `awaiting_approval` 结果中回传
 * `inboxId`，本组件据此直接 POST `/v1/inbox/:id/reply`。
 *
 * 续跑责任仍在后端（inbox-handlers fire-and-forget + `session:continued` 广播），
 * 这里只做「提交审批 + 反馈」；刷新由 useNotificationSSE 统一处理。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { http } from "../../services/httpClient";
import { useToastStore } from "../../stores/toastStore";

interface Props {
  inboxId: string;
}

export default function InlineApprovalActions({ inboxId }: Props) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"approve" | "deny" | null>(null);

  const reply = async (value: "approve" | "deny") => {
    if (busy || done) return;
    setBusy(true);
    try {
      const res = await http.post<unknown>(`/v1/inbox/${inboxId}/reply`, {
        reply: value,
      });
      if (!res.ok) {
        addToast("error", String(res.error || t("common.failed")));
        return;
      }
      setDone(value);
      addToast(
        "success",
        t(
          value === "approve"
            ? "chat.inboxReplyApprove"
            : "chat.inboxReplyReject",
        ),
      );
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-green-500">
        {done === "approve"
          ? `✅ ${t("chat.inboxHandled")}`
          : `✕ ${t("chat.inboxReplyReject")}`}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => void reply("approve")}
        disabled={busy}
        className="px-2 py-0.5 rounded text-[10px] font-medium bg-green-500/15 text-green-400 hover:bg-green-500/25 disabled:opacity-50 transition-colors"
      >
        {t("chat.inboxReplyApprove")}
      </button>
      <button
        type="button"
        onClick={() => void reply("deny")}
        disabled={busy}
        className="px-2 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 disabled:opacity-50 transition-colors"
      >
        {t("chat.inboxReplyReject")}
      </button>
    </span>
  );
}
