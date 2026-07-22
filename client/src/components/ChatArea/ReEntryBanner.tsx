/**
 * ReEntryBanner — 回切摘要横幅
 *
 * 当用户切回某个会话且离开超过 30 秒时，在输入框上方显示离开期间的变化摘要。
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../../stores/chatStore";

interface ReEntryBannerProps {
  sessionId: string;
  sessionTitle: string;
  leaveTimestamp: number;
  /** 切走前的消息数量 */
  prevMessageCount: number;
  onScrollToLatest: () => void;
  onDismiss: () => void;
}

export default function ReEntryBanner({
  sessionTitle,
  leaveTimestamp,
  prevMessageCount,
  onScrollToLatest,
  onDismiss,
}: ReEntryBannerProps) {
  const { t } = useTranslation();
  const messages = useChatStore((s) => s.messages);
  const [visible, setVisible] = useState(true);

  const awayMs = Date.now() - leaveTimestamp;
  const awayMinutes = Math.round(awayMs / 60000);
  const newMessageCount = Math.max(0, messages.length - prevMessageCount);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    onDismiss();
  }, [onDismiss]);

  // 30秒内无操作自动消失
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), 30000);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="mx-3 mb-2 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl animate-message-enter">
      <div className="flex items-start gap-3">
        <span className="text-lg mt-0.5 shrink-0" aria-hidden="true">
          📋
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
            {t("chat.reentryBanner", { title: sessionTitle })}
          </p>
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
            {t("chat.reentryAway", { minutes: awayMinutes })}
            {newMessageCount > 0 &&
              ` · ${t("chat.reentryNewMessages", { count: newMessageCount })}`}
          </p>
          <div className="flex items-center gap-3 mt-2">
            {newMessageCount > 0 && (
              <button
                onClick={onScrollToLatest}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 flex items-center gap-1"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 14l-7 7m0 0l-7-7m7 7V3"
                  />
                </svg>
                {t("chat.reentryScrollToLatest")}
              </button>
            )}
            <button
              onClick={handleDismiss}
              className="text-xs text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-200"
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Re-entry utilities
// ============================================================================

/** 模块级存储：记录每个会话的离开时间戳 */
const _sessionLeaveTimes = new Map<string, number>();
/** 模块级存储：记录每个会话切走前的消息数量 */
const _sessionMessageCounts = new Map<string, number>();

/** 切走时调用，记录离开时间 */
export function recordSessionLeave(
  sessionId: string,
  messageCount: number,
): void {
  _sessionLeaveTimes.set(sessionId, Date.now());
  _sessionMessageCounts.set(sessionId, messageCount);
}

/** 切回时调用，返回离开信息；若离开<30秒或首次进入返回 null */
export function getSessionReentry(
  sessionId: string,
): { leaveTimestamp: number; prevMessageCount: number } | null {
  const leaveTs = _sessionLeaveTimes.get(sessionId);
  if (!leaveTs) return null;

  const elapsed = Date.now() - leaveTs;
  if (elapsed < 30000) {
    // 离开不超30秒，不算回切
    _sessionLeaveTimes.delete(sessionId);
    return null;
  }

  const prevCount = _sessionMessageCounts.get(sessionId) ?? 0;
  // 消费后清除
  _sessionLeaveTimes.delete(sessionId);
  _sessionMessageCounts.delete(sessionId);
  return { leaveTimestamp: leaveTs, prevMessageCount: prevCount };
}
