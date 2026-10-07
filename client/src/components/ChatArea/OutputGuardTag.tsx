/**
 * OutputGuardTag — 消息级「已打码 / 已阻断」标注（PC-1，2026-10-07）
 *
 * 数据源：后端全局 SSE `system:output_guard`（经 `outputGuardStore`，按 `messageId` 索引）。
 *
 * 为什么需要：后端命中输出护栏后会用安全文本**替换**已流出正文，若不标注，用户只会看到
 * "内容被换过"而不知原因（静默改写）——本标签即 `.trae/specs/guardrails-dual-side.md`
 * §9.2④ **P3 前置**的前端落点。
 *
 * 文案（PC-5）：**去技术化**，不暴露 `blockReason` 原文与护栏标识符（那些留在日志）。
 */
import { useTranslation } from "react-i18next";
import { useOutputGuardStore } from "../../stores/outputGuardStore";

interface OutputGuardTagProps {
  /** 消息 id（与后端 `assistantMessage.id` 一致） */
  messageId: string;
}

function OutputGuardTag({ messageId }: OutputGuardTagProps) {
  const { t } = useTranslation();
  const notice = useOutputGuardStore((s) => s.notices[messageId]);

  if (!notice) return null;

  const blocked = notice.action === "blocked";

  return (
    <div className="my-0.5 flex">
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] leading-none border ${
          blocked
            ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-500 dark:text-red-400"
            : "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400"
        }`}
        title={
          blocked ? t("chat.outputGuardBlocked") : t("chat.outputGuardRedacted")
        }
      >
        <span>🛡️</span>
        <span>
          {blocked
            ? t("chat.outputGuardBlocked")
            : t("chat.outputGuardRedacted")}
        </span>
      </span>
    </div>
  );
}

export default OutputGuardTag;
