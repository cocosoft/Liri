/**
 * YieldNoticeBar —— N-45（2026-09-20）：会话级"已让出但未能恢复"提示条。
 *
 * 数据来自 `GET /v1/sessions/:id/streaming` 的 `yieldState`（后端**读时派生**）。
 *
 * **为什么是会话级而不是挂在消息上**（两轮 UI 实测结论）：真实让出轮次的派生消息只有
 * `[user, tool]`（该轮无正文 ⇒ 不产出助手条目），而前端 store 会把"没有 assistant 可回填的
 * tool 消息"整体丢弃 ⇒ 任何挂在消息上的状态都会随消息一起消失（详见台账 N-48）。
 *
 * 2026-09-27（等待态可见性 Spec `wait-state-visibility.md` D5）——**职责收敛**：
 * - `waiting`（正在等）**迁入浮动栏**：既有 UI-1 口径是"零碎信息统一到浮动栏显示"，
 *   且原实现在 `[sessionId, isStreaming]` 变化时才拉一次、此后**不再刷新** ⇒ 一旦进入
 *   `waiting` 就永久冻结（用户实测现象）。现由 `ChatArea` 的 `useWaitState`（含低频轮询）
 *   统一提供，浮动栏承担"等待中"文案。
 * - 本组件**只保留 `unresolved`**：那是"已让出但未能自动恢复（应用重启 / 结算丢失）"，
 *   需要**用户介入**的明确告警，与"正在等待"是两回事，保留独立提示条。
 *
 * 数据经 props 传入（单一拉取点），本组件**不再自行请求**。
 */
import { useTranslation } from "react-i18next";

interface YieldNoticeBarProps {
  fluid?: boolean;
  /** 已让出但未能自动恢复 ⇒ 需用户介入（由 `ChatArea` 的 `useWaitState` 提供） */
  unresolved: boolean;
}

function YieldNoticeBar({ fluid, unresolved }: YieldNoticeBarProps) {
  const { t } = useTranslation();

  if (!unresolved) return null;

  return (
    <div className="w-full px-3 pb-1">
      <div className={fluid ? "w-full" : "max-w-3xl mx-auto"}>
        <div className="flex items-start gap-2 px-4 py-2 rounded-xl border text-xs bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400">
          <span className="text-sm shrink-0 leading-5">⚠️</span>
          <span className="flex-1 min-w-0 leading-5">
            {t("chat.yieldUnresolved")}
          </span>
        </div>
      </div>
    </div>
  );
}

export default YieldNoticeBar;
