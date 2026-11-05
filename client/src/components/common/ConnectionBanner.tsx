/**
 * ConnectionBanner — 全局「连接中断」横幅（C7，2026-11-05）
 *
 * 数据源：`connectionMonitor` 的既有状态机（`/health` 连续 3 次失败 ⇒ DISCONNECTED；
 * 浏览器 offline ⇒ OFFLINE）。**不新造第二套检测**（CS01）——横幅只做呈现与手动重试。
 *
 * 为什么挂在应用壳层：断连时用户可能停在任意路由（知识库 / 设置 / 任务面板），
 * 只在聊天页提示会漏掉这些场景。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ConnectionState,
  connectionMonitor,
} from "../../services/connectionMonitor";
import { connectionBannerKind } from "../../utils/connectionBannerState";

export default function ConnectionBanner() {
  const { t } = useTranslation();
  const [state, setState] = useState<ConnectionState>(
    connectionMonitor.getState(),
  );
  const [retrying, setRetrying] = useState(false);

  useEffect(() => connectionMonitor.subscribe((next) => setState(next)), []);

  const kind = connectionBannerKind(state);
  if (!kind) return null;

  async function handleRetry(): Promise<void> {
    setRetrying(true);
    try {
      // 与 10s 周期健康检查同一实现（含状态转移），不另写判定
      await connectionMonitor.recheckNow();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-center justify-between gap-3 px-4 py-1.5 bg-amber-500 text-white text-sm shadow-md"
    >
      <span className="min-w-0 truncate">
        {kind === "offline"
          ? t("common.connectionOffline")
          : t("common.connectionLost")}
      </span>
      {kind === "disconnected" && (
        <button
          onClick={handleRetry}
          disabled={retrying}
          className="shrink-0 px-3 py-1 rounded-lg bg-white text-amber-700 text-xs font-medium hover:bg-amber-50 disabled:opacity-60 transition-colors"
        >
          {retrying
            ? t("common.connectionRetrying")
            : t("common.connectionRetry")}
        </button>
      )}
    </div>
  );
}
