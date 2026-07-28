/**
 * ContextWatermark — 上下文水位指示器
 *
 * 紧凑模式（默认）：小圆点，hover 显示详情
 * 详细模式（hover/点击展开）：显示比例、token 数、压缩历史
 * 压缩完成：5 秒 toast 自动消失
 */

import { useState, useEffect, useCallback } from "react";
import { useContextWatermarkStore } from "../../stores/contextWatermarkStore";

export function ContextWatermark() {
  const { watermark, lastCompaction, cumulative } = useContextWatermarkStore();
  const [showDetail, setShowDetail] = useState(false);
  const [showCompactionToast, setShowCompactionToast] = useState(false);

  // 压缩完成后显示 toast，5 秒后消失
  useEffect(() => {
    if (lastCompaction) {
      setShowCompactionToast(true);
      const timer = setTimeout(() => setShowCompactionToast(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [lastCompaction?.timestamp]);

  const onMouseEnter = useCallback(() => setShowDetail(true), []);
  const onMouseLeave = useCallback(() => setShowDetail(false), []);

  // 刚完成压缩：显示结果 toast
  if (showCompactionToast && lastCompaction) {
    return (
      <div
        className="text-xs px-2 py-1 rounded animate-pulse transition-opacity"
        style={{
          backgroundColor: "rgba(34,197,94,0.15)",
          color: "#16a34a",
          fontSize: "11px",
        }}
      >
        {lastCompaction.message ||
          `上下文已压缩：${lastCompaction.tokensBefore.toLocaleString()} → ${lastCompaction.tokensAfter.toLocaleString()} tokens（节省 ${lastCompaction.savingsPercent}%）`}
      </div>
    );
  }

  if (!watermark || watermark.severity === "normal") return null;

  const pct = Math.round(watermark.ratio * 100);
  const isCritical = watermark.severity === "compact";

  const dotColor = isCritical ? "#ef4444" : "#eab308";
  const bgColor = isCritical ? "rgba(239,68,68,0.1)" : "rgba(234,179,8,0.1)";

  return (
    <div
      className="relative flex items-center justify-center"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ height: 20 }}
    >
      {/* 紧凑模式：小圆点 */}
      <div
        className={`w-2 h-2 rounded-full cursor-pointer ${isCritical ? "animate-pulse" : ""}`}
        style={{ backgroundColor: dotColor }}
        title={`上下文水位: ${pct}%`}
      />

      {/* 详细模式：hover 展开 */}
      {showDetail && (
        <div
          className="absolute bottom-full mb-1 text-xs px-2 py-1 rounded shadow whitespace-nowrap z-50"
          style={{
            backgroundColor: bgColor,
            color: dotColor,
            fontSize: "11px",
            border: `1px solid ${dotColor}20`,
          }}
        >
          {isCritical ? "🔴" : "⚠️"} 上下文 {pct}%
          {watermark.currentTokens > 0 && watermark.contextLimit > 0 && (
            <>
              {" "}
              | {(watermark.currentTokens / 1000).toFixed(0)}K/
              {(watermark.contextLimit / 1000).toFixed(0)}K
            </>
          )}
          {cumulative.totalCompressions > 0 && (
            <>
              {" "}
              | 已压缩 {cumulative.totalCompressions} 次，累计节省{" "}
              {(cumulative.totalTokensSaved / 1000).toFixed(0)}K tokens
            </>
          )}
        </div>
      )}
    </div>
  );
}
