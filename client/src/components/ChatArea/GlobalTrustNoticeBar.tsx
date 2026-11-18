/**
 * GlobalTrustNoticeBar —— PR-3c（2026-10-23）：全局信任级别**一次性提示**。
 *
 * 背景（Q-31 / §9-17）：`--trust-level` 会让**未匹配信任工作区**的所有目录降级
 * （`development` 等价"bash 非 deny 一律 allow"）。后端已要求 `--confirm-global-trust`
 * 二次确认；本提示条让用户在会话里**看得见**这件事，而不是只在启动日志里。
 *
 * 2026-11-19（用户反馈「仅仅是提示信息，没必要一直显示」）：改为**可关闭** ——
 * 关闭后按**当前级别**记入 localStorage（`liri-trust-notice-dismissed-level`）：
 * 同一级别不再出现；`--trust-level` 改成别的级别 ⇒ 重新出现（安全姿态变了要再告知一次）。
 *
 * 数据源：`GET /v1/config/permission` 的 `defaultTrustLevel`（与 `SecurityIntegration`
 * 读取的是同一份配置 ⇒ 不另造状态）。未设置 ⇒ 不渲染（零噪音）。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

// 与 `TrustedWorkspacesPanel` 同源（`httpLegacy` 读同一份 `/v1/config/permission`）
import { httpLegacy as http } from "../../services/httpClient";

interface GlobalTrustNoticeBarProps {
  fluid?: boolean;
}

/** 合法信任级别（与后端同域） */
const LEVELS = ["chat", "work", "development"];

/** 已关闭的级别（关闭即记住；级别变化后自然失效） */
const DISMISSED_LEVEL_KEY = "liri-trust-notice-dismissed-level";

function readDismissedLevel(): string | null {
  try {
    return localStorage.getItem(DISMISSED_LEVEL_KEY);
  } catch {
    // localStorage 不可用（隐私模式等）⇒ 视为未关闭，照常提示
    return null;
  }
}

function GlobalTrustNoticeBar({ fluid }: GlobalTrustNoticeBarProps) {
  const { t } = useTranslation();
  const [level, setLevel] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await http.get<{
          key: string;
          value: { defaultTrustLevel?: string } | null;
        }>("/v1/config/permission");
        const raw = res?.value?.defaultTrustLevel;
        if (!cancelled && raw && LEVELS.includes(raw)) {
          setLevel(raw);
          setDismissed(readDismissedLevel() === raw);
        }
      } catch {
        // 配置不可达 ⇒ 不显示（不臆造状态）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!level || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_LEVEL_KEY, level);
    } catch {
      // 存不下也不影响本次关闭（下次启动会再提示一次）
    }
  };

  return (
    <div className="w-full px-3 pb-1">
      <div className={fluid ? "w-full" : "max-w-3xl mx-auto"}>
        <div className="flex items-start gap-2 px-4 py-2 rounded-xl border text-xs bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400">
          <span className="text-sm shrink-0 leading-5">🔓</span>
          <span className="flex-1 min-w-0 leading-5">
            {t("chat.globalTrustNotice", { level })}
          </span>
          <button
            onClick={dismiss}
            className="shrink-0 opacity-70 hover:opacity-100"
            title={t("common.close")}
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

export default GlobalTrustNoticeBar;
