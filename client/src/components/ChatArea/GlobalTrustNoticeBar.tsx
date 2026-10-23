/**
 * GlobalTrustNoticeBar —— PR-3c（2026-10-23）：全局信任级别**常驻提示**。
 *
 * 背景（Q-31 / §9-17）：`--trust-level` 会让**未匹配信任工作区**的所有目录降级
 * （`development` 等价"bash 非 deny 一律 allow"）。后端已要求 `--confirm-global-trust`
 * 二次确认；本提示条让用户在会话里**一直看得见**这件事，而不是只在启动日志里。
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

function GlobalTrustNoticeBar({ fluid }: GlobalTrustNoticeBarProps) {
  const { t } = useTranslation();
  const [level, setLevel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await http.get<{
          key: string;
          value: { defaultTrustLevel?: string } | null;
        }>("/v1/config/permission");
        const raw = res?.value?.defaultTrustLevel;
        if (!cancelled && raw && LEVELS.includes(raw)) setLevel(raw);
      } catch {
        // 配置不可达 ⇒ 不显示（不臆造状态）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!level) return null;

  return (
    <div className="w-full px-3 pb-1">
      <div className={fluid ? "w-full" : "max-w-3xl mx-auto"}>
        <div className="flex items-start gap-2 px-4 py-2 rounded-xl border text-xs bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400">
          <span className="text-sm shrink-0 leading-5">🔓</span>
          <span className="flex-1 min-w-0 leading-5">
            {t("chat.globalTrustNotice", { level })}
          </span>
        </div>
      </div>
    </div>
  );
}

export default GlobalTrustNoticeBar;
