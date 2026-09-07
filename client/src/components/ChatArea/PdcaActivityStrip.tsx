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
 * PdcaActivityStrip — 输入区上方的 PDCA 实时活动条（P0-3，C1/C2，2026-09-06）
 *
 * C1：订阅 orchestrationStore（pdca:* 独立事件通道，后端 PdcaLiveEvents 广播），
 *     筛选 sessionId === 当前会话 id 的活跃事件（pdca:stage:start/phase/complete/fail、
 *     pdca:decision），渲染紧凑横条：
 *     阶段胶囊（data.stage：plan/execute/review/decide → Plan/Do/Check/Act）
 *     + 当前步骤/工具（data.currentStep / data.toolSummary）+ 状态文案；可折叠。
 * C2：收到 pdca:auto_launched 且 sessionId 匹配当前会话时，显示一次性提示条
 *     「🔄 已自动创建项目并启动任务规划（PDCA 分步执行中）」，可手动关闭。
 *
 * 数据源仅 orchestrationStore + sessionStore（纯读真实 store）；无匹配返回 null。
 * 不新增网络/状态通道、不扩展 store 字段（折叠/关闭态仅存组件内 useState，
 * 跨刷新不持久化）。
 */
import { useState, type ReactNode } from "react";
import { useOrchestrationStore } from "@/stores/orchestrationStore";
import type { PdcaLiveEventPayload } from "@/stores/orchestrationStore";
import { useSessionStore } from "@/stores/sessionStore";

/** C1 活跃进度事件类型（镜像后端 PdcaLiveEvents.ts；auto_launched 由 C2 banner 单独呈现）。
 *  导出：ChatPdcaDrawer（C3）复用同一会话匹配判定，避免两份逻辑漂移 */
export const PROGRESS_EVENT_TYPES: string[] = [
  "pdca:stage:start",
  "pdca:stage:phase",
  "pdca:stage:complete",
  "pdca:stage:fail",
  "pdca:decision",
];

export const AUTO_LAUNCHED_TYPE = "pdca:auto_launched";

/** 阶段胶囊元信息：data.stage → Plan→Do→Check→Act */
const STAGE_META: Record<
  string,
  { icon: string; label: string; capsule: string }
> = {
  plan: {
    icon: "📋",
    label: "Plan",
    capsule:
      "bg-blue-100/80 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  execute: {
    icon: "🏗",
    label: "Do",
    capsule:
      "bg-orange-100/80 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  },
  review: {
    icon: "🔍",
    label: "Check",
    capsule:
      "bg-purple-100/80 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  },
  decide: {
    icon: "✅",
    label: "Act",
    capsule:
      "bg-green-100/80 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  },
};

const DECISION_META = {
  icon: "⚖",
  label: "决策",
  capsule:
    "bg-amber-100/80 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

const FALLBACK_META = {
  icon: "🧩",
  label: "PDCA",
  capsule: "bg-gray-100/80 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};

/** 从 timeline（有序尾部 200 条）倒序取最新匹配；replay 只写 latest 时以 latest 兜底
 *  导出：ChatPdcaDrawer（C3）复用 */
export function findLatestEvent(
  timeline: PdcaLiveEventPayload[],
  latest: Record<string, PdcaLiveEventPayload>,
  sessionId: string,
  types: string[],
): PdcaLiveEventPayload | null {
  const isMatch = (ev: PdcaLiveEventPayload): boolean =>
    ev.sessionId === sessionId && types.includes(ev.type);
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (isMatch(timeline[i])) return timeline[i];
  }
  const candidates = Object.values(latest).filter(isMatch);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.time - a.time);
  return candidates[0];
}

function stageMetaOf(ev: PdcaLiveEventPayload): {
  icon: string;
  label: string;
  capsule: string;
} {
  const stage = (ev.data?.stage as string | undefined) ?? "";
  if (STAGE_META[stage]) return STAGE_META[stage];
  if (ev.type === "pdca:decision") return DECISION_META;
  return FALLBACK_META;
}

/** 主文本：当前步骤 > 工具摘要 > message；状态文案（含 percent），失败标红 */
function textOf(ev: PdcaLiveEventPayload): {
  primary: string;
  statusText: string;
  failed: boolean;
} {
  const d = ev.data ?? {};
  const status = (d.status as string | undefined) ?? "";
  const percent = typeof d.percent === "number" ? `${d.percent}%` : "";
  const primary =
    (d.currentStep as string | undefined) ??
    (d.toolSummary as string | undefined) ??
    (d.message as string | undefined) ??
    "";

  const failed = ev.type === "pdca:stage:fail" || status === "failed";
  let statusLabel = "";
  if (ev.type === "pdca:stage:start") {
    statusLabel = status === "completed" ? "已完成" : "已启动";
  } else if (ev.type === "pdca:stage:phase") {
    statusLabel =
      status === "failed" ? "失败" : status === "completed" ? "完成" : "执行中";
  } else if (ev.type === "pdca:stage:complete") {
    statusLabel = "已完成";
  } else if (ev.type === "pdca:stage:fail") {
    statusLabel = "失败";
  } else if (ev.type === "pdca:decision") {
    statusLabel = "分流决策";
  } else {
    statusLabel = status;
  }
  return {
    primary,
    statusText: [statusLabel, percent].filter(Boolean).join(" · "),
    failed,
  };
}

/**
 * C2 banner：pdca:auto_launched 一次性提示（可关闭；关闭态仅存组件内，不持久化）
 */
function AutoLaunchedBanner({
  onDismiss,
}: {
  onDismiss: () => void;
}): ReactNode {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50/90 dark:bg-amber-900/20 border border-amber-200/70 dark:border-amber-700/40">
      <span className="flex-1 min-w-0 truncate text-xs text-amber-800 dark:text-amber-200">
        🔄 已自动创建项目并启动任务规划（PDCA 分步执行中）
      </span>
      <button
        onClick={onDismiss}
        className="shrink-0 text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
        title="关闭"
        aria-label="关闭"
      >
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}

/** 输入区上方 PDCA 活动条：auto_launched 一次性提示（C2）+ 活跃进度横条（C1） */
export default function PdcaActivityStrip({
  fluid = false,
}: {
  fluid?: boolean;
}) {
  const timeline = useOrchestrationStore((s) => s.timeline);
  const latest = useOrchestrationStore((s) => s.latest);
  const currentSessionId = useSessionStore((s) => s.currentSession?.id);
  const [collapsed, setCollapsed] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  if (!currentSessionId) return null;

  const autoEvent = findLatestEvent(timeline, latest, currentSessionId, [
    AUTO_LAUNCHED_TYPE,
  ]);
  const progressEvent = findLatestEvent(
    timeline,
    latest,
    currentSessionId,
    PROGRESS_EVENT_TYPES,
  );
  if (!autoEvent && !progressEvent) return null;

  const content: ReactNode[] = [];
  if (autoEvent && !bannerDismissed) {
    content.push(
      <div className="px-3 pt-1.5" key="banner">
        <AutoLaunchedBanner onDismiss={() => setBannerDismissed(true)} />
      </div>,
    );
  }

  if (progressEvent) {
    const meta = stageMetaOf(progressEvent);
    const { primary, statusText, failed } = textOf(progressEvent);
    content.push(
      <div className="px-3 pt-1.5" key="strip">
        {collapsed ? (
          <button
            onClick={() => setCollapsed(false)}
            className="w-full flex items-center gap-2 px-3 py-1 text-left hover:bg-white/70 dark:hover:bg-gray-800/70 transition-colors"
            title="展开 PDCA 进度"
            aria-label="展开 PDCA 进度"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
            <span className="flex-1 min-w-0 truncate text-[11px] text-gray-500 dark:text-gray-400">
              PDCA 分步执行中 · {meta.icon} {meta.label}
            </span>
            <svg
              className="w-3 h-3 text-gray-400 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 15l7-7 7 7"
              />
            </svg>
          </button>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/90 dark:bg-gray-800/90 border border-gray-200/60 dark:border-gray-700/60 shadow-sm">
            <span
              className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${meta.capsule}`}
            >
              <span>{meta.icon}</span>
              <span>{meta.label}</span>
            </span>
            <span className="flex-1 min-w-0 truncate text-xs text-gray-600 dark:text-gray-300">
              {primary}
            </span>
            {statusText && (
              <span
                className={`shrink-0 text-[10px] ${
                  failed
                    ? "text-red-500 dark:text-red-400"
                    : "text-gray-400 dark:text-gray-500"
                }`}
              >
                {statusText}
              </span>
            )}
            <button
              onClick={() => setCollapsed(true)}
              className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              title="收起"
              aria-label="收起"
            >
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          </div>
        )}
      </div>,
    );
  }

  if (content.length === 0) return null;

  return (
    <div className="w-full">
      <div className={fluid ? "w-full" : "max-w-3xl mx-auto"}>{content}</div>
    </div>
  );
}
