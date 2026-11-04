/**
 * U-06-5（2026-10-19）：工具卡片「就地审批」操作条。
 *
 * 背景：`tool_call.pendingApproval` 此前只有「⏳ 等待审批」徽标，用户必须
 * 另找会话内的 Inbox 卡片才能批准。后端现已在 `awaiting_approval` 结果中回传
 * `inboxId`，本组件据此直接 POST `/v1/inbox/:id/reply`。
 *
 * PR-2（2026-10-23）：改为**四档**（允许本次 / 本会话都允许 / 始终允许 / 拒绝）。
 * 档位由后端在 Inbox 项 `options` 上声明（外部副作用类不给永久放行），
 * 组件挂载时读取 `GET /v1/inbox/:id` 过滤按钮 —— 不自行放宽可选档位。
 *
 * 续跑责任仍在后端（inbox-handlers fire-and-forget + `session:continued` 广播），
 * 这里只做「提交审批 + 反馈」；刷新由 useNotificationSSE 统一处理。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { http } from "../../services/httpClient";
import { useToastStore } from "../../stores/toastStore";
import {
  inboxReplyNotAppliedReason,
  isInboxReplyApplied,
} from "./inboxReplyResult";

interface Props {
  inboxId: string;
}

/** 档位顺序（与后端 options 取值一致；后端未声明 ⇒ 只回退到 approve/deny） */
const TIER_ORDER = [
  "approve",
  "approve_session",
  // P2（2026-11-04，§3.3）：本任务都允许（后端只在长程任务进行中下发该选项）
  "approve_task",
  "allowlist_call",
  "allowlist_command",
  "allowlist_tool",
  "deny",
  "reject",
] as const;

type TierReply = (typeof TIER_ORDER)[number];

const TIER_LABEL_KEYS: Record<TierReply, string> = {
  approve: "chat.inboxReplyApprove",
  approve_session: "chat.inboxReplyApproveSession",
  approve_task: "chat.inboxReplyApproveTask",
  allowlist_call: "chat.inboxReplyAllowAlways",
  allowlist_command: "chat.inboxReplyAllowCommand",
  allowlist_tool: "chat.inboxReplyAllowTool",
  deny: "chat.inboxReplyReject",
  reject: "chat.inboxReplyReject",
};

const DEFAULT_TIERS: TierReply[] = ["approve", "deny"];

function isTierReply(value: string): value is TierReply {
  return (TIER_ORDER as readonly string[]).includes(value);
}

export default function InlineApprovalActions({ inboxId }: Props) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<TierReply | null>(null);
  const [tiers, setTiers] = useState<TierReply[]>(DEFAULT_TIERS);

  // 档位以后端声明为准（读取失败 ⇒ 保持 approve/deny 兜底，不擅自增加档位）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await http.get<{ options?: unknown }>(
          `/v1/inbox/${inboxId}`,
        );
        if (cancelled || !res.ok) return;
        const raw = res.data?.options;
        if (!Array.isArray(raw)) return;
        const offered = raw.filter(
          (v): v is TierReply => typeof v === "string" && isTierReply(v),
        );
        if (offered.length > 0) setTiers(offered);
      } catch {
        // 读取档位失败不影响「本次批准/拒绝」主路径
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inboxId]);

  const reply = async (value: TierReply) => {
    if (busy || done) return;
    setBusy(true);
    try {
      const res = await http.post<unknown>(`/v1/inbox/${inboxId}/reply`, {
        reply: value,
      });
      // P0-1（2026-11-04）：HTTP 200 不等于生效（过期/已处理/并发冲突同样是 200），
      // 否则会出现「界面显示已处理、后端什么都没做」的假成功。
      if (!res.ok || !isInboxReplyApplied(res.data)) {
        addToast(
          "error",
          (!res.ok ? String(res.error || "") : "") ||
            inboxReplyNotAppliedReason(res.ok ? res.data : undefined) ||
            t("common.failed"),
        );
        return;
      }
      setDone(value);
      addToast("success", t(TIER_LABEL_KEYS[value]));
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-green-500">
        {done === "approve" ||
        done === "approve_session" ||
        done === "approve_task" ||
        done.startsWith("allowlist_")
          ? `✅ ${t("chat.inboxHandled")}`
          : `✕ ${t("chat.inboxReplyReject")}`}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {tiers.map((tier) => {
        const danger = tier === "deny" || tier === "reject";
        const className = danger
          ? "px-2 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 disabled:opacity-50 transition-colors"
          : tier === "approve"
            ? "px-2 py-0.5 rounded text-[10px] font-medium bg-green-500/15 text-green-400 hover:bg-green-500/25 disabled:opacity-50 transition-colors"
            : "px-2 py-0.5 rounded text-[10px] font-medium bg-gray-500/15 text-gray-300 hover:bg-gray-500/25 disabled:opacity-50 transition-colors";
        return (
          <button
            key={tier}
            type="button"
            onClick={() => void reply(tier)}
            disabled={busy}
            title={
              tier === "allowlist_call"
                ? t("chat.inboxReplyAllowAlwaysHint")
                : undefined
            }
            className={className}
          >
            {t(TIER_LABEL_KEYS[tier])}
          </button>
        );
      })}
    </span>
  );
}
