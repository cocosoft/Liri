/**
 * ResourceGovernanceNoticeBar — 会话级"被抢占 / 排队中"提示条（PC-2，2026-10-07）
 *
 * 数据来自后端全局 SSE `system:resource_governor`（经 `resourceGovernorStore`）。
 *
 * **为什么是会话级**：事件带 `sessionId`，只对**当前打开的会话**有意义（与
 * `YieldNoticeBar` 同一形态 —— 挂在会话区而非全局顶栏）。
 *
 * 文案去技术化（PC-5）：不暴露 `blockReason`/优先级等术语，只讲用户能理解的结果与下一步。
 */
import { useTranslation } from "react-i18next";
import { useResourceGovernorStore } from "../../stores/resourceGovernorStore";

interface ResourceGovernanceNoticeBarProps {
  fluid?: boolean;
  /** 当前打开的会话 id；缺省 ⇒ 不渲染 */
  sessionId?: string;
}

function ResourceGovernanceNoticeBar({
  fluid,
  sessionId,
}: ResourceGovernanceNoticeBarProps) {
  const { t } = useTranslation();
  const notice = useResourceGovernorStore((s) =>
    sessionId ? s.notices[sessionId] : undefined,
  );
  const clear = useResourceGovernorStore((s) => s.clear);

  if (!notice || !sessionId) return null;

  const preempted = notice.state === "preempted";
  const tone = preempted
    ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400"
    : "bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300";

  return (
    <div className="w-full px-3 pb-1">
      <div className={fluid ? "w-full" : "max-w-3xl mx-auto"}>
        <div
          className={`flex items-start gap-2 px-4 py-2 rounded-xl border text-xs ${tone}`}
        >
          <span className="text-sm shrink-0 leading-5">
            {preempted ? "⚡" : "⏳"}
          </span>
          <span className="flex-1 min-w-0 leading-5">
            {preempted ? t("chat.preemptedNotice") : t("chat.queuedNotice")}
          </span>
          {preempted && (
            <button
              onClick={() => clear(sessionId)}
              className="shrink-0 opacity-70 hover:opacity-100"
              title={t("common.close")}
              aria-label={t("common.close")}
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ResourceGovernanceNoticeBar;
