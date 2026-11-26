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
 * P0（2026-11-07，权限与沙箱拉通方案 §2.2）：档位收敛为**三档 + 拒绝**
 * （仅这次执行 / 以后这个命令免审批 / 以后整个工具免审批），按钮文案自带作用域，
 * 并在出现 allowlist 档时显式标出「写入设置 › 自定义规则 › 工具放行，可撤销」——
 * 用户此前无法判断"加入命令白名单 / 加入工具白名单"到底落到哪一层。
 *
 * 续跑责任仍在后端（inbox-handlers fire-and-forget + `session:continued` 广播），
 * 这里只做「提交审批 + 反馈」；刷新由 useNotificationSSE 统一处理。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { http } from "../../services/httpClient";
import { useToastStore } from "../../stores/toastStore";
import { useChatStore } from "../../stores/chat";
import {
  inboxReplyNotAppliedReason,
  isInboxReplyApplied,
} from "./inboxReplyResult";
// 2026-11-24（批次 5 / C1）：档位文案与分类的唯一事实源（与 `InboxBlock` 共用）
import {
  INBOX_REPLY_DANGER,
  INBOX_REPLY_LABEL_KEYS,
  isInboxReplyApproveLike,
} from "./inboxReplyTiers";

interface Props {
  inboxId: string;
}

/**
 * 展示顺序（仅用于排序；**不是**可选项白名单）。
 * 后端 `options` 才是档位唯一来源，清单外的新档位照样渲染（回退后端值/原值）。
 */
const TIER_ORDER = [
  "approve",
  "approve_session",
  // P2（2026-11-04，§3.3）：本任务都允许（后端只在长程任务进行中下发该选项）
  "approve_task",
  "allowlist_call",
  "allowlist_command",
  // G3（2026-11-14）：本工作区永久信任（精确命令 + 工作区作用域）
  "allowlist_workspace_command",
  // 2026-11-24：本会话内「该工具都允许」（内存放行，会话结束失效）
  "allowlist_tool_session",
  // 2026-11-26（用户裁定）：本会话内整个工具全部命令都允许（含危险命令，高风险）
  "allowlist_tool_session_all",
  "allowlist_tool",
  "deny",
  "reject",
];

const DEFAULT_TIERS = ["approve", "deny"];

/** 按已知顺序排序（未登记的新档位排在末尾，保持后端给出的相对顺序） */
function orderTiers(tiers: string[]): string[] {
  const rank = (v: string): number => {
    const idx = TIER_ORDER.indexOf(v);
    return idx < 0 ? TIER_ORDER.length : idx;
  };
  return [...tiers].sort((a, b) => rank(a) - rank(b));
}

export default function InlineApprovalActions({ inboxId }: Props) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [tiers, setTiers] = useState<string[]>(DEFAULT_TIERS);

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
        // 批次 5 / C1：**不再按前端白名单过滤** —— 后端新增档位时，就地入口与审批卡
        // 同时出现（此前清单外的档位在此处被静默丢弃）。
        const offered = raw.filter(
          (v): v is string => typeof v === "string" && v.length > 0,
        );
        if (offered.length > 0) setTiers(orderTiers(offered));
      } catch {
        // 读取档位失败不影响「本次批准/拒绝」主路径
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inboxId]);

  const reply = async (value: string) => {
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
      // 2026-11-24：审批已落定 ⇒ 立即在本地纠正卡/工具卡的等待态（不等 SSE 回刷）
      useChatStore.getState().markApprovalResolved(inboxId);
      const labelKey = INBOX_REPLY_LABEL_KEYS[value];
      addToast("success", labelKey ? t(labelKey) : value);
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-green-500">
        {isInboxReplyApproveLike(done)
          ? `✅ ${t("chat.inboxHandled")}`
          : `✕ ${t("chat.inboxReplyReject")}`}
      </span>
    );
  }

  const hasAllowlist = tiers.some((tier) => tier.startsWith("allowlist_"));

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {tiers.map((tier) => {
          const danger = INBOX_REPLY_DANGER.has(tier);
          const className = danger
            ? "px-2 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 disabled:opacity-50 transition-colors"
            : tier === "approve"
              ? "px-2 py-0.5 rounded text-[10px] font-medium bg-green-500/15 text-green-400 hover:bg-green-500/25 disabled:opacity-50 transition-colors"
              : "px-2 py-0.5 rounded text-[10px] font-medium bg-gray-500/15 text-gray-300 hover:bg-gray-500/25 disabled:opacity-50 transition-colors";
          const labelKey = INBOX_REPLY_LABEL_KEYS[tier];
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
              {/* 未登记的新档位：如实显示后端值（不静默丢弃，CS06） */}
              {labelKey ? t(labelKey) : tier}
            </button>
          );
        })}
      </span>
      {hasAllowlist && (
        <p className="mt-1 text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
          {t("chat.inboxAllowlistHint")}
        </p>
      )}
    </>
  );
}
