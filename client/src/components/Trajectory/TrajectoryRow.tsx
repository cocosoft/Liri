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

import type { LiriEvent, LiriEventCategory } from "@/types";
import { categorizeEvent } from "@/types";

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

const TYPE_LABELS: Record<string, string> = {
  "turn/start": "Turn 开始",
  "turn/end": "Turn 结束",
  "user/message": "用户消息",
  "assistant/thinking": "思考",
  "assistant/text": "回复",
  "assistant/tool_call": "工具调用",
  "tool/result": "工具结果",
  "context/compaction": "上下文压缩",
  "context/summary": "上下文摘要",
  "system/error": "错误",
  "system/warning": "警告",
  "system/info": "信息",
  "metric/timing": "性能指标",
  "channel/connect": "通道连接",
  "channel/disconnect": "通道断开",
  "channel/message": "通道消息",
  "session/start": "会话开始",
  "session/end": "会话结束",
};

interface Props {
  event: LiriEvent;
  selected: boolean;
  onClick: () => void;
}

export function TrajectoryRow({ event, selected, onClick }: Props) {
  const category = categorizeEvent(event.type);
  const icon = CATEGORY_ICONS[category];
  const label = TYPE_LABELS[event.type] ?? event.type;
  const time = new Date(event.time).toLocaleTimeString("zh-CN", {
    hour12: false,
  });
  const preview = getEventPreview(event);

  return (
    <li
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
    </li>
  );
}

function getEventPreview(event: LiriEvent): string {
  const data = event.data as Record<string, unknown>;
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
