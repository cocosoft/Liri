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
 * TrajectoryFilter — 事件过滤栏
 *
 * 支持按 category 多选 + 关键字搜索。
 */

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LiriEventCategory, LiriEventType } from "@/types";
import type { TrajectoryFilterState } from "@/stores/chat/trajectoryStore";

const CATEGORY_OPTIONS: Array<{
  value: LiriEventCategory;
  labelKey: string;
  color: string;
}> = [
  {
    value: "conversation",
    labelKey: "trajectory.category.conversation",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  {
    value: "tool",
    labelKey: "trajectory.category.tool",
    color:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  },
  {
    value: "context",
    labelKey: "trajectory.category.context",
    color:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  {
    value: "system",
    labelKey: "trajectory.category.system",
    color: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  },
  {
    value: "channel",
    labelKey: "trajectory.category.channel",
    color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  },
  {
    value: "lifecycle",
    labelKey: "trajectory.category.lifecycle",
    color:
      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  },
];

// P7（2026-08-25）：常用事件类型快捷过滤
const TYPE_OPTIONS: Array<{ value: LiriEventType; label: string }> = [
  { value: "turn/start", label: "turn/start" },
  { value: "turn/end", label: "turn/end" },
  { value: "user/message", label: "user" },
  { value: "assistant/text", label: "text" },
  { value: "assistant/text-batch", label: "text-batch" },
  { value: "assistant/thinking", label: "thinking" },
  { value: "assistant/tool_call", label: "tool_call" },
  { value: "tool/result", label: "result" },
  { value: "tool/canceled", label: "canceled" },
  { value: "assistant/status", label: "status" },
  { value: "assistant/todo", label: "todo" },
  { value: "assistant/question", label: "question" },
  { value: "assistant/doc_workflow", label: "doc_workflow" },
  // P0-1 接入点第二刀 ②b（2026-09-24）：工作流 run 记录
  { value: "assistant/workflow_run_start", label: "workflow_run_start" },
  { value: "assistant/workflow_step_start", label: "workflow_step_start" },
  { value: "assistant/workflow_step_end", label: "workflow_step_end" },
  { value: "assistant/workflow_run_end", label: "workflow_run_end" },
  { value: "assistant/progress", label: "progress" },
  { value: "assistant/truncation", label: "truncation" },
  { value: "context/compaction", label: "compaction" },
  { value: "system/error", label: "error" },
];

// P7（2026-08-25）：来源维度（对标 DSH 按来源查看，由 categorizeEvent 派生）
const SOURCE_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: "llm", labelKey: "trajectory.source.llm" },
  { value: "tool", labelKey: "trajectory.source.tool" },
  { value: "system", labelKey: "trajectory.source.system" },
  { value: "channel", labelKey: "trajectory.source.channel" },
  { value: "user", labelKey: "trajectory.source.user" },
];

interface Props {
  filter: TrajectoryFilterState;
  onChange: (patch: Partial<TrajectoryFilterState>) => void;
}

export function TrajectoryFilter({ filter, onChange }: Props) {
  const { t } = useTranslation();
  const keywordId = useId();

  /** 已启用的筛选维度数（折叠状态下作为摘要；TB-1） */
  const activeCount =
    (filter.keyword.trim() ? 1 : 0) +
    (filter.categories.length > 0 ? 1 : 0) +
    (filter.types.length > 0 ? 1 : 0) +
    (filter.sources.length > 0 ? 1 : 0) +
    (filter.minSeq !== undefined || filter.maxSeq !== undefined ? 1 : 0) +
    (filter.fromTime !== undefined || filter.toTime !== undefined ? 1 : 0);
  /** TB-1：默认折叠；有筛选条件时初值展开（此后由用户控制） */
  const [expanded, setExpanded] = useState(activeCount > 0);

  const toggleCategory = (cat: LiriEventCategory) => {
    const set = new Set(filter.categories);
    if (set.has(cat)) set.delete(cat);
    else set.add(cat);
    onChange({ categories: Array.from(set) });
  };

  const toggleType = (type: LiriEventType) => {
    const set = new Set(filter.types);
    if (set.has(type)) set.delete(type);
    else set.add(type);
    onChange({ types: Array.from(set) });
  };

  const toggleSource = (source: string) => {
    const set = new Set(filter.sources);
    if (set.has(source)) set.delete(source);
    else set.add(source);
    onChange({ sources: Array.from(set) });
  };

  const hasAdvancedFilter =
    filter.keyword.trim() !== "" ||
    filter.categories.length > 0 ||
    filter.types.length > 0 ||
    filter.sources.length > 0 ||
    filter.minSeq !== undefined ||
    filter.maxSeq !== undefined ||
    filter.fromTime !== undefined ||
    filter.toTime !== undefined;

  return (
    // TB-1（2026-09-23）：**默认折叠**。实测 1280×720 下本面板占 **265px（面板的 42%）**，
    // 而事件列表（主内容）仅剩 66px（见 预存问题 §TB-1）⇒ 折叠后列表可回到 ~280px。
    // 有筛选条件时**初值**为展开（不随筛选变化自动展开，避免与用户手动折叠打架）。
    <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
      >
        <span>{t("trajectory.filter.title")}</span>
        {activeCount > 0 && (
          <span className="text-blue-600 dark:text-blue-400">
            {t("trajectory.filter.activeCount", { count: activeCount })}
          </span>
        )}
        <span className="ml-auto">
          {expanded
            ? t("trajectory.filter.collapse")
            : t("trajectory.filter.expand")}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1">
            {CATEGORY_OPTIONS.map((opt) => {
              const active = filter.categories.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  onClick={() => toggleCategory(opt.value)}
                  className={`px-2 py-0.5 text-xs rounded transition ${
                    active
                      ? opt.color
                      : "bg-gray-50 text-gray-500 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                  }`}
                >
                  {t(opt.labelKey)}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <label
              htmlFor={keywordId}
              className="text-xs text-gray-500 dark:text-gray-400 shrink-0"
            >
              {t("trajectory.filter.search")}
            </label>
            <input
              id={keywordId}
              type="text"
              value={filter.keyword}
              onChange={(e) => onChange({ keyword: e.target.value })}
              placeholder="content / name / error / result / toolCallId"
              className="flex-1 px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {hasAdvancedFilter && (
              <button
                onClick={() =>
                  onChange({
                    keyword: "",
                    categories: [],
                    types: [],
                    sources: [],
                    minSeq: undefined,
                    maxSeq: undefined,
                    fromTime: undefined,
                    toTime: undefined,
                  })
                }
                className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                {t("trajectory.filter.clear")}
              </button>
            )}
          </div>
          {/* P7：来源维度（对标 DSH 按来源查看） */}
          <div className="flex flex-wrap gap-1">
            {SOURCE_OPTIONS.map((opt) => {
              const active = filter.sources.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  onClick={() => toggleSource(opt.value)}
                  className={`px-1.5 py-0.5 rounded text-[10px] transition ${
                    active
                      ? "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300"
                      : "bg-gray-50 text-gray-500 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                  }`}
                >
                  {t(opt.labelKey)}
                </button>
              );
            })}
          </div>
          {/* P7：类型多选（低垂果实，store 已有 types 字段） */}
          <div className="flex flex-wrap gap-1">
            {TYPE_OPTIONS.map((opt) => {
              const active = filter.types.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  onClick={() => toggleType(opt.value)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition ${
                    active
                      ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                      : "bg-gray-50 text-gray-500 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {/* P7：seq / 时间区间 */}
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
            <span className="shrink-0">seq</span>
            <input
              type="number"
              value={filter.minSeq ?? ""}
              onChange={(e) =>
                onChange({
                  minSeq:
                    e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
              placeholder="min"
              className="w-16 px-1.5 py-0.5 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
            <span>~</span>
            <input
              type="number"
              value={filter.maxSeq ?? ""}
              onChange={(e) =>
                onChange({
                  maxSeq:
                    e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
              placeholder="max"
              className="w-16 px-1.5 py-0.5 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
            <span className="shrink-0 ml-2">{t("trajectory.filter.time")}</span>
            <input
              type="datetime-local"
              value={
                filter.fromTime !== undefined
                  ? new Date(filter.fromTime).toISOString().slice(0, 16)
                  : ""
              }
              onChange={(e) =>
                onChange({
                  fromTime: e.target.value
                    ? new Date(e.target.value).getTime()
                    : undefined,
                })
              }
              className="px-1.5 py-0.5 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
            <span>~</span>
            <input
              type="datetime-local"
              value={
                filter.toTime !== undefined
                  ? new Date(filter.toTime).toISOString().slice(0, 16)
                  : ""
              }
              onChange={(e) =>
                onChange({
                  toTime: e.target.value
                    ? new Date(e.target.value).getTime()
                    : undefined,
                })
              }
              className="px-1.5 py-0.5 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
          </div>
        </div>
      )}
    </div>
  );
}
