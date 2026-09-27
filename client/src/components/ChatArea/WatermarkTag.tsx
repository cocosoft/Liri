/**
 * WatermarkTag — ChatArea 中「上下文水位」的紧凑标签（收缩展示）
 *
 * 上下文水位 status 块在 ChatArea 中从「边框卡片」收缩为一行紧凑小标签，
 * 仅保留关键信息（百分比 + 临界标记），完整详情在右侧「会话日志」面板查看。
 *
 * 识别依据（CS02）：**结构化标记** `block.status === "watermark"`（chat-stream-chunk 写入）。
 * 数据来源：`block.watermark` 结构化字段（P1-3）。
 * 禁止再按 `content` 文本解析判定 —— 判据必须落在持久化标记上（CS02）。
 */

import { useTranslation } from "react-i18next";

interface WatermarkTagProps {
  /** 结构化水位数据（status === "watermark" 时必存在，CS02：判据为标记而非文案） */
  watermark: { pct: number; severity: "warn" | "compact" };
}

function WatermarkTag({ watermark }: WatermarkTagProps) {
  const { t } = useTranslation();
  const pct = String(watermark.pct);
  const isCritical = watermark.severity === "compact";

  return (
    <div className="my-0.5 flex">
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] leading-none border ${
          isCritical
            ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-500 dark:text-red-400"
            : "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400"
        }`}
      >
        <span>{isCritical ? "🔴" : "⚠️"}</span>
        <span>{t("chat.watermarkContext", { pct })}</span>
        {isCritical && <span>{t("chat.needCompression")}</span>}
      </span>
    </div>
  );
}

export default WatermarkTag;
