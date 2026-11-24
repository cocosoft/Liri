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
import { sseService } from "../../services/sseService";
import { useToastStore } from "../../stores/toastStore";
import { useChatStore } from "../../stores/chat";
import { collectApprovalInboxIds } from "../../stores/chat/chat-message-shared";
import {
  inboxReplyNotAppliedReason,
  isInboxReplyApplied,
} from "./inboxReplyResult";

interface Props {
  data: InboxBlockData;
  sessionId?: string;
  onResolved?: () => void;
}

/** B8：「逐条勾选」列表里的一条待审批卡（只取渲染需要的字段） */
interface PendingApprovalOption {
  id: string;
  title: string;
  toolName?: string;
}

/** `/v1/inbox` 列表返回的最小项结构（只声明本组件用到的字段） */
interface PendingInboxItem {
  id?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

/** 类型标签 i18n 键（未登记的类型回退后端原值显示，CS06） */
const TYPE_LABEL_KEYS: Record<string, string> = {
  approval: "chat.inboxTypeApproval",
  question: "chat.inboxTypeQuestion",
  authorization: "chat.inboxTypeAuthorization",
};

/** 按钮文案 i18n 键（未登记的 reply 回退后端 label，CS06） */
const REPLY_LABEL_KEYS: Record<string, string> = {
  approve: "chat.inboxReplyApprove",
  approve_session: "chat.inboxReplyApproveSession",
  // P2（2026-11-04，§3.3）：本任务都允许（仅长程任务进行中出现）
  approve_task: "chat.inboxReplyApproveTask",
  allowlist_call: "chat.inboxReplyAllowAlways",
  allowlist_tool: "chat.inboxReplyAllowTool",
  // 2026-11-24：本会话内「该工具都允许」（不落持久化规则，会话结束失效）
  allowlist_tool_session: "chat.inboxReplyAllowToolSession",
  allowlist_command: "chat.inboxReplyAllowCommand",
  allowlist_workspace_command: "chat.inboxReplyAllowWorkspaceCommand",
  reject: "chat.inboxReplyReject",
  deny: "chat.inboxReplyReject",
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
  // P1-1（2026-11-06）：本会话待审批卡数量 —— 决定是否显示批量入口
  const [pendingApprovals, setPendingApprovals] = useState(0);
  // B8（2026-11-18）：批量入口改为「默认展开的逐条勾选」——这里存候选与选中集合
  const [pendingOptions, setPendingOptions] = useState<PendingApprovalOption[]>(
    [],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchReplying, setBatchReplying] = useState(false);

  // P1-1（2026-11-06）：**外部状态同步** —— 同会话其它卡片被批量批准后，服务端回填
  // `inboxData.status='replied'`，但本组件的 `status` 是挂载时的初值 ⇒ 卡片会一直停在
  // "待批"（真机：一键批准 2 张后，另一张仍显示批准按钮）。只接受**终态**回填，
  // 避免乐观置 `replied` 后被一次过期重取翻回 `pending`。
  useEffect(() => {
    if (data.status !== "pending") setStatus(data.status);
  }, [data.status]);

  // P1-1：同轮多工具（如 3 个 mkdir）会各生成一张卡；>1 时给批量入口。
  // B8（2026-11-18）：入口改成「默认展开 + 逐条勾选」⇒ 这里同时取候选清单
  //（`items`），默认全选。取数失败静默（点击时后端仍会告知实际落地数量）。
  useEffect(() => {
    if (data.status !== "pending" || data.type !== "approval" || !sessionId) {
      return;
    }
    let cancelled = false;
    http
      .get<{ total?: number; items?: PendingInboxItem[] }>(
        `/v1/inbox?sessionId=${encodeURIComponent(sessionId)}&status=pending&type=approval&limit=50`,
      )
      .then((res) => {
        if (cancelled || !res.ok) return;
        const payload = res.data as
          { total?: number; items?: PendingInboxItem[] } | undefined;
        const total = payload?.total;
        if (typeof total === "number") setPendingApprovals(total);
        const options = (payload?.items ?? [])
          .filter(
            (item): item is PendingInboxItem & { id: string } =>
              typeof item.id === "string" && item.id !== "",
          )
          .map((item) => ({
            id: item.id,
            title: item.title ?? item.id,
            ...(typeof item.metadata?.toolName === "string"
              ? { toolName: item.metadata.toolName }
              : {}),
          }));
        setPendingOptions(options);
        setSelectedIds(options.map((item) => item.id));
      })
      .catch(() => {
        /* 计数/清单仅用于批量入口，失败静默 */
      });
    return () => {
      cancelled = true;
    };
  }, [data.status, data.type, sessionId]);

  /** B8：勾选/取消一条待审批卡 */
  const toggleSelected = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  /** P1-1 + B8：一次批准**选中**的待审批卡（服务端只触发一次续跑） */
  const handleApproveSelected = async () => {
    if (batchReplying || status !== "pending" || !sessionId) return;
    if (selectedIds.length === 0) return;
    setBatchReplying(true);
    try {
      const res = await http.post<{
        applied?: boolean;
        resolved?: string[];
      }>("/v1/inbox/approve-all", {
        sessionId,
        reply: "approve",
        ids: selectedIds,
      });
      const applied =
        res.ok &&
        (res.data as { applied?: boolean } | undefined)?.applied === true;
      if (!applied) {
        addToast("error", t("chat.inboxApproveAllNone"));
        return;
      }
      const count = (res.data as { resolved?: string[] }).resolved?.length ?? 0;
      setStatus("replied");
      // 2026-11-24：批量审批已落定 ⇒ 逐条在本地纠正等待态（不等 SSE 回刷）
      for (const resolvedId of (res.data as { resolved?: string[] }).resolved ??
        []) {
        useChatStore.getState().markApprovalResolved(resolvedId);
      }
      addToast("success", t("chat.inboxApproveAllToast", { count }));
      onResolved?.();
      // 续跑完成由后端 `session:continued` 驱动刷新（与单卡批准同源）
      setResuming(true);
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBatchReplying(false);
    }
  };

  const handleAction = async (reply: string) => {
    if (replying || status !== "pending") return;
    setReplying(true);

    try {
      const res = await http.post<unknown>(`/v1/inbox/${data.inboxId}/reply`, {
        reply,
      });
      // P0-1（2026-11-04）：HTTP 200 不等于生效 —— 过期/已处理/并发冲突同样是 200。
      // 只按 `res.ok` 判定会弹「已批准」但后端什么都没做（实测工作区目录因此始终没加根）。
      if (!res.ok || !isInboxReplyApplied(res.data)) {
        setStatus("expired");
        addToast(
          "error",
          (!res.ok ? String(res.error || "") : "") ||
            inboxReplyNotAppliedReason(res.ok ? res.data : undefined) ||
            t("common.failed"),
        );
        return;
      }
      setStatus("replied");
      // 2026-11-24：审批已落定 ⇒ 立即在本地纠正等待态（不等 SSE 回刷）
      useChatStore.getState().markApprovalResolved(data.inboxId);
      const label = REPLY_LABEL_KEYS[reply]
        ? t(REPLY_LABEL_KEYS[reply])
        : t("chat.reply");
      addToast("success", t("chat.inboxRepliedToast", { label }));
      onResolved?.();

      // P2-1 + P2-4 → M2-T2.1（2026-08-31）：批准类 reply 的续跑责任收敛到后端——
      // inbox-handlers 已 fire-and-forget 触发续跑（checkpoint/resume 优先，无检查点
      // 时从 events.jsonl 尾部重建未完成 turn）。前端只做"触发 + 展示"：
      // 不再查询检查点、不再轮询、不再降级 sendMessage 重发。
      const isApproveLike =
        reply === "approve" ||
        reply === "approve_session" ||
        reply === "approve_task" ||
        reply === "allowlist_call" ||
        reply === "allowlist_tool" ||
        reply === "allowlist_tool_session" ||
        reply === "allowlist_command" ||
        reply === "allowlist_workspace_command";
      // U-06-4（2026-10-19）：续跑完成由后端广播 `session:continued`，
      // 刷新由 useNotificationSSE 统一处理；此处只维护"续跑中"提示，
      // 不再固定 sleep 3s 后全量重拉（绕过游标且与真实完成时间无关）。
      if (isApproveLike && sessionId) setResuming(true);
    } catch (e) {
      addToast("error", e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setReplying(false);
    }
  };

  // U-06-4（2026-10-19）：以 `session:continued` 作为"续跑结束"的事实来源。
  // 60s 看门狗只清提示（后端未广播/无检查点时不留永久转圈）。
  useEffect(() => {
    if (!resuming || !sessionId) return;
    const onContinued = (payload: unknown): void => {
      const d = payload as { id?: string } | null;
      if (d?.id && d.id !== sessionId) return;
      setResuming(false);
    };
    sseService.on("session:continued", onContinued);
    const timer = setTimeout(() => setResuming(false), 60_000);
    return () => {
      sseService.off("session:continued", onContinued);
      clearTimeout(timer);
    };
  }, [resuming, sessionId]);

  const isPending = status === "pending";
  const isExpired = status === "expired";
  const isUrgent = data.priority === "urgent";
  /**
   * 2026-11-24（用户实测「审批后还是显示待审批」）：这张待处理卡是不是**又一次**新请求。
   *
   * 批准后旧卡会立刻变「已处理」，但模型紧接着换一条命令又会新建一张卡；两张卡标题相同、
   * 状态栏文案也相同 ⇒ 看起来像"批准没生效"。这里按已落定的审批数给新卡打标，
   * 让用户一眼看出"上一张已处理，这是新的请求"。
   * 说明：选用**原始值** selector（number），避免流式 chunk 期间无谓重渲染。
   */
  const priorResolvedApprovalCount = useChatStore(
    (s) => collectApprovalInboxIds(s.messages).resolved.size,
  );
  // P0-1（2026-11-04）：同一指纹的审批请求被合并了几次（后端回填，仅 >1 时显示 `×N`）
  const mergedCount =
    typeof data.dedupCount === "number" && data.dedupCount > 1
      ? data.dedupCount
      : 1;

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
        {/* 2026-11-24：继已处理审批之后的**新**请求（避免误读成"上一张没生效"） */}
        {isPending && priorResolvedApprovalCount > 0 && (
          <span
            className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
            title={t("chat.inboxNewApprovalRequestHint", {
              count: priorResolvedApprovalCount,
            })}
          >
            {t("chat.inboxNewApprovalRequest")}
          </span>
        )}
        <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
          {data.title}
        </span>
        {mergedCount > 1 && (
          <span
            className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300"
            title={t("chat.inboxMergedCountHint", { count: mergedCount })}
          >
            ×{mergedCount}
          </span>
        )}
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

      {/* 操作按钮（2026-11-24：档位增至 6 个 ⇒ 允许换行，避免窄卡片横向溢出） */}
      <div className="flex flex-wrap items-center gap-2">
        {isPending &&
          data.actions.map((action) => {
            const s = ACTION_STYLE[action.style] || ACTION_STYLE.secondary;
            const label = REPLY_LABEL_KEYS[action.reply]
              ? t(REPLY_LABEL_KEYS[action.reply])
              : action.label;
            return (
              <button
                key={action.reply}
                onClick={() => handleAction(action.reply)}
                disabled={replying}
                title={
                  action.reply === "allowlist_call"
                    ? t("chat.inboxReplyAllowAlwaysHint")
                    : undefined
                }
                className={`rounded-lg px-3 py-1 text-xs font-medium text-white transition-colors disabled:opacity-50 ${s.bg} ${s.hover} ${s.darkBg} ${s.darkHover}`}
              >
                {replying ? "..." : label}
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
      {/* B8（2026-11-18）：同会话多张待审批卡 ⇒ **默认展开**的逐条勾选面板。
          动机：原「全部批准（N 项）」一次点击会把整轮所有同类调用一起放行，
          用户看不到具体批了哪几条；改为默认全选的清单，可逐条取消后再批准选中项。 */}
      {isPending && data.type === "approval" && pendingApprovals > 1 && (
        <details
          open
          className="mt-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700"
        >
          <summary className="cursor-pointer text-xs font-medium text-gray-700 dark:text-gray-300">
            {t("chat.inboxBatchTitle", { count: pendingApprovals })}
          </summary>
          <ul className="mt-2 space-y-1">
            {pendingOptions.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-start gap-2 text-xs text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => toggleSelected(item.id)}
                    disabled={batchReplying}
                  />
                  <span className="break-all">
                    {item.toolName ? `${item.toolName}: ` : ""}
                    {item.title}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={handleApproveSelected}
              disabled={replying || batchReplying || selectedIds.length === 0}
              title={t("chat.inboxApproveSelectedHint")}
              className="rounded-lg border border-green-500 px-3 py-1 text-xs font-medium text-green-600 transition-colors hover:bg-green-50 disabled:opacity-50 dark:border-green-600 dark:text-green-400 dark:hover:bg-green-900/20"
            >
              {batchReplying
                ? "..."
                : t("chat.inboxApproveSelected", {
                    count: selectedIds.length,
                  })}
            </button>
          </div>
        </details>
      )}
      {/* P0（2026-11-07）：出现 allowlist 档时标出规则落点（设置 › 自定义规则 › 工具放行） */}
      {isPending &&
        data.actions.some((a) => a.reply.startsWith("allowlist_")) && (
          <p className="mt-2 text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
            {t("chat.inboxAllowlistHint")}
          </p>
        )}
      {/* 2026-11-12：待审批时就地说明"批准后自动继续"——原先写进助手正文，
          处理完会残留一句"等待你的审批"与实际状态矛盾，故改由卡片承载（仅在 pending 时显示） */}
      {isPending && data.type === "approval" && (
        <p className="mt-2 text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
          {t("chat.inboxApprovalAutoContinueHint")}
        </p>
      )}
    </div>
  );
}
