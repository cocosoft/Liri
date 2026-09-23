// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * TrajectoryRow — 单事件行
 *
 * 显示：seq · 图标 · 类型标签 · 时间 · 预览
 */

import { useTranslation } from "react-i18next";
import type { LiriEvent, LiriEventCategory } from "@/types";
import { categorizeEvent } from "@/types";
// P3-4（2026-09-22）：`metric/timing` 行内展示耗时 / tokens —— 复用既有格式化工具（CS01）
import { formatTokens } from "../../utils/format";
import { formatDuration } from "../../stores/chat/deriveTrajectoryTimeline";

const CATEGORY_ICONS: Record<LiriEventCategory, string> = {
  conversation: "💬",
  tool: "🔧",
  context: "📊",
  system: "⚙️",
  channel: "📡",
  lifecycle: "🔄",
};

const CATEGORY_COLORS: Record<LiriEventCategory, string> = {
  conversation: "text-blue-600 dark:text-blue-400",
  tool: "text-purple-600 dark:text-purple-400",
  context: "text-amber-600 dark:text-amber-400",
  system: "text-gray-600 dark:text-gray-400",
  channel: "text-cyan-600 dark:text-cyan-400",
  lifecycle: "text-green-600 dark:text-green-400",
};

const TYPE_LABEL_KEYS: Record<string, string> = {
  "turn/start": "trajectory.type.turnStart",
  "turn/end": "trajectory.type.turnEnd",
  "user/message": "trajectory.type.userMessage",
  "assistant/thinking": "trajectory.type.thinking",
  "assistant/text": "trajectory.type.reply",
  "assistant/tool_call": "trajectory.type.toolCall",
  "tool/result": "trajectory.type.toolResult",
  "context/compaction": "trajectory.type.contextCompaction",
  "context/summary": "trajectory.type.contextSummary",
  "system/error": "trajectory.type.error",
  "system/warning": "trajectory.type.warning",
  "system/info": "trajectory.type.info",
  "metric/timing": "trajectory.type.metricTiming",
  "channel/connect": "trajectory.type.channelConnect",
  "channel/disconnect": "trajectory.type.channelDisconnect",
  "channel/message": "trajectory.type.channelMessage",
  "session/start": "trajectory.type.sessionStart",
  "session/end": "trajectory.type.sessionEnd",
};

interface Props {
  event: LiriEvent;
  selected: boolean;
  onClick: () => void;
}

export function TrajectoryRow({ event, selected, onClick }: Props) {
  const { t } = useTranslation();
  const category = categorizeEvent(event.type);
  const icon = CATEGORY_ICONS[category];
  const typeLabelKey = TYPE_LABEL_KEYS[event.type];
  const label = typeLabelKey ? t(typeLabelKey) : event.type;
  const time = new Date(event.time).toLocaleTimeString("zh-CN", {
    hour12: false,
  });
  const preview = getEventPreview(event);

  // P3-1（2026-09-22）：原为 `<li>`，但其父级是虚拟滚动 `<div>`（非 `<ul>`）⇒ **HTML 语义非法**。
  // 改 `<div>` 而**不**补 `<ul>` / `role="list"`：该容器是**混合区**（含"向前补页"按钮、turn 头、
  // 事件行），并非纯列表 —— 加 list/grid role 只会制造 ARIA 谎言。
  return (
    <div
      onClick={onClick}
      className={`flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${
        selected ? "bg-blue-50 dark:bg-blue-900/30" : ""
      }`}
    >
      <span className="text-gray-400 dark:text-gray-500 text-xs font-mono w-10 shrink-0 pt-0.5">
        #{event.seq}
      </span>
      <span className="text-base shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-medium ${CATEGORY_COLORS[category]} shrink-0`}
          >
            {label}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {time}
          </span>
        </div>
        {preview && (
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 truncate">
            {preview}
          </div>
        )}
      </div>
    </div>
  );
}

function getEventPreview(event: LiriEvent): string {
  const data = event.data as Record<string, unknown>;
  // P3-4（2026-09-22）：`metric/timing` 行内展示**该事件自带**的耗时 / tokens
  // （回合级有 `duration`、请求级有 `tokens`；**不做跨事件拼接**，缺哪项就不显示哪项）
  if (event.type === "metric/timing") return previewTiming(data);
  if (typeof data.content === "string") {
    return data.content.length > 80
      ? data.content.slice(0, 80) + "…"
      : data.content;
  }
  if (typeof data.name === "string") return `name=${data.name}`;
  if (typeof data.error === "string") {
    return data.error.length > 80 ? data.error.slice(0, 80) + "…" : data.error;
  }
  if (typeof data.message === "string") return data.message;
  if (typeof data.result === "string") {
    return data.result.length > 80
      ? data.result.slice(0, 80) + "…"
      : data.result;
  }
  if (typeof data.turn === "number") return `turn=${data.turn}`;
  if (typeof data.summary === "string") {
    return data.summary.length > 80
      ? data.summary.slice(0, 80) + "…"
      : data.summary;
  }
  return "";
}

/**
 * `metric/timing` 的行内预览（P3-4）—— 只展示**真实存在**的字段：
 * - 回合级（`stage='assistant'`）：`assistant · 1.2 s`
 * - 请求级（`stage='request'`）：`request · 12.3K tok`
 *
 * 刻意不做"tokens ÷ duration"的瞬时吞吐：这两个字段**分属不同事件**
 * （回合级无 tokens、请求级无 duration），拼出来的数不是真实测量值。
 */
function previewTiming(data: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof data.stage === "string" && data.stage) parts.push(data.stage);
  if (typeof data.duration === "number" && Number.isFinite(data.duration)) {
    parts.push(formatDuration(data.duration));
  }
  // 请求延迟：优先 `ttft`（首个内容 token，更贴近用户感知）；缺失时回退 `ttfb`，
  // 并**如实保留标签**（不把首块延迟冒充成首个 token 延迟）
  const ttft = numberOr(data.ttft);
  const ttfb = numberOr(data.ttfb);
  if (ttft !== undefined) parts.push(`ttft ${formatDuration(ttft)}`);
  else if (ttfb !== undefined) parts.push(`ttfb ${formatDuration(ttfb)}`);
  if (typeof data.tokens === "number" && Number.isFinite(data.tokens)) {
    parts.push(`${formatTokens(data.tokens)} tok`);
  }
  return parts.join(" · ");
}

/** 有限数值守卫（非 number / NaN / Infinity ⇒ undefined） */
function numberOr(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
