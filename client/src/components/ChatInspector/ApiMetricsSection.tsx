// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 「请求指标」分区（API 指标展示，2026-09-23 —— 立项见 `.trae/specs/api-metrics-surface.md`）。
 *
 * 位置：轨迹 Tab 内、时间线**之下**、事件列表（滚动容器）**之上**。
 * 数据源：`metric/timing` 事件（与列表/时间线**同一份** `filteredEvents`，口径一致）。
 *
 * FSZ-161（2026-09-23）：自 `ChatInspector.tsx` **逐字迁移**（宿主 898 行 > `lint:size`
 * 800 阈值；按计划"按子块拆分"），仅改为默认导出、补本文件的导入。
 *
 * ## 双态（不拿假值充数）
 * - 无请求级事件 ⇒ 明确提示"暂无请求指标"（**不**显示 0 或 `-`）；
 * - 分位数样本 `n < 2` ⇒ 显示"样本不足"，不编造数值；
 * - 某项无数据（如无延迟类事件）⇒ **不渲染该项**（不留空壳）。
 *
 * ## 刻意不展示的指标（CS01 归一化，避免重复展示）
 * 吞吐 / 模型耗时合计已由上方 `TrajectoryTimeline` header 承担（`modelMs` / `throughputTps`）
 * ⇒ 本分区不重复产出，只做**请求级**（TTFT / TTFB 分位数、缺失计数、token 分桶）。
 */
import { useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { LiriEvent } from "../../types";
import {
  deriveApiMetrics,
  type ApiMetricsPercentiles,
} from "../../stores/chat/deriveApiMetrics";
import { formatDuration } from "../../stores/chat/deriveTrajectoryTimeline";
import { formatTokens } from "../../utils/format";

export default function ApiMetricsSection({ events }: { events: LiriEvent[] }) {
  const { t } = useTranslation();
  const m = useMemo(() => deriveApiMetrics(events), [events]);

  if (m.requestCount === 0) {
    return (
      <div className="px-4 py-1.5 border-b border-gray-100 dark:border-gray-800 text-[10px] text-gray-500 dark:text-gray-400">
        {t("trajectory.apiMetrics.empty")}
      </div>
    );
  }

  /** 分位数文案（复用既有 `formatDuration`，不新写格式化工具） */
  const percentileText = (p: ApiMetricsPercentiles, label: string): string =>
    t("trajectory.apiMetrics.percentile", {
      label,
      p50: formatDuration(p.p50),
      p95: formatDuration(p.p95),
      n: p.n,
    });

  /** 有延迟样本但不足 2 个 ⇒ 如实说"样本不足"；一个都没有 ⇒ 该项整条不渲染 */
  const latencyItem = (
    p: ApiMetricsPercentiles | null,
    label: string,
  ): ReactElement | null =>
    p ? (
      <span>{percentileText(p, label)}</span>
    ) : m.latencyEventCount > 0 ? (
      <span>{t("trajectory.apiMetrics.insufficientSample", { label })}</span>
    ) : null;

  const ttftLabel = t("trajectory.apiMetrics.ttftLabel");
  const ttfbLabel = t("trajectory.apiMetrics.ttfbLabel");

  return (
    <div className="px-4 py-1.5 border-b border-gray-100 dark:border-gray-800 bg-white/50 dark:bg-gray-900/30 text-[10px] text-gray-500 dark:text-gray-400 flex flex-wrap items-center gap-x-3 gap-y-0.5">
      <span className="font-semibold text-gray-600 dark:text-gray-300">
        {t("trajectory.apiMetrics.title")}
      </span>
      <span>
        {t("trajectory.apiMetrics.requestCount", { count: m.requestCount })}
      </span>
      {latencyItem(m.ttft, ttftLabel)}
      {latencyItem(m.ttfb, ttfbLabel)}
      {m.missingTtftCount > 0 && (
        <span>
          {t("trajectory.apiMetrics.missingTtft", {
            count: m.missingTtftCount,
          })}
        </span>
      )}
      {m.tokens && (
        <span>
          {t("trajectory.apiMetrics.tokens", {
            input: formatTokens(m.tokens.input),
            output: formatTokens(m.tokens.output),
            total: formatTokens(m.tokens.total),
          })}
        </span>
      )}
      {m.tokens && (m.tokens.cacheRead > 0 || m.tokens.cacheCreation > 0) && (
        <span>
          {t("trajectory.apiMetrics.cacheTokens", {
            read: formatTokens(m.tokens.cacheRead),
            write: formatTokens(m.tokens.cacheCreation),
          })}
        </span>
      )}
    </div>
  );
}
