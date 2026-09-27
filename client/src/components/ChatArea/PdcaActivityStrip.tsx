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
 * PdcaActivityStrip — PDCA 共享辅助（事件白名单 / 阶段胶囊元信息 / 会话匹配判定）
 *
 * ## 历史与现状（2026-09-27，P2-3 死代码清理）
 *
 * 原文件同时承载「输入区上方 PDCA 实时活动条」组件（P0-3，C1/C2，2026-09-06）。
 * 该组件已被 `PdcaWorkflowCard`（聊天正文内富块）取代，**组件本体零引用**，
 * 清理时一并删除其专属子组件 `AutoLaunchedBanner` 与 `useState`/`useMemo`/store 订阅。
 *
 * 现本文件**只保留被 4 处复用的具名导出**（`PdcaWorkflowCard` / `usePdcaEntry` /
 * `usePdcaAutoAppend` / `ChatPdcaDrawer`）：
 *  - `PROGRESS_EVENT_TYPES` / `AUTO_LAUNCHED_TYPE`：事件类型白名单（镜像后端 PdcaLiveEvents）
 *  - `STAGE_META` / `DECISION_META` / `FALLBACK_META` / `stageMetaOf`：阶段胶囊元信息
 *  - `findLatestEvent`：timeline 倒序 + latest 兜底的会话匹配判定
 *  - `textOf`：主文本 + 状态文案
 *
 * 数据源仅 orchestrationStore（纯读真实 store）；无匹配返回 null。
 * ⚠️ 文件名为历史遗留（已无组件）：如需可另行重命名为 `pdcaLive.ts`（本轮未改，避免无谓 churn）。
 */

import type { PdcaLiveEventPayload } from "@/stores/orchestrationStore";

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

/** 阶段胶囊元信息结构（PdcaWorkflowCard 复用，P2-A）
 *  `label` 为语言中立字面量（Plan/Do/Check/Act、PDCA）；需翻译的文案走 `labelKey`，
 *  由渲染处经 `metaLabel` 解析（i18n 残留收尾）。 */
export type StageMeta = {
  icon: string;
  label?: string;
  labelKey?: string;
  capsule: string;
};

/** 阶段胶囊元信息：data.stage → Plan→Do→Check→Act
 *  导出：PdcaWorkflowCard 复用（P2-A，移私有为导出，避免复制） */
export const STAGE_META: Record<string, StageMeta> = {
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

export const DECISION_META: StageMeta = {
  icon: "⚖",
  labelKey: "chat.pdcaDecision",
  capsule:
    "bg-amber-100/80 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

export const FALLBACK_META: StageMeta = {
  icon: "🧩",
  label: "PDCA",
  capsule: "bg-gray-100/80 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};

/** 胶囊文案解析：`labelKey` 优先（需渲染处提供 t），否则用语言中立字面量 */
export function metaLabel(meta: StageMeta, t: (key: string) => string): string {
  return meta.labelKey ? t(meta.labelKey) : (meta.label ?? "");
}

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

export function stageMetaOf(ev: PdcaLiveEventPayload): StageMeta {
  const stage = (ev.data?.stage as string | undefined) ?? "";
  if (STAGE_META[stage]) return STAGE_META[stage];
  if (ev.type === "pdca:decision") return DECISION_META;
  return FALLBACK_META;
}

/** 主文本：当前步骤 > 工具摘要 > message；状态文案（含 percent），失败标红
 *  导出：PdcaWorkflowCard 复用
 *  状态文案返回**文案键** `statusKey`（由渲染处 t()），未登记状态回退后端原值
 *  `statusLiteral`（CS06，不臆造映射）。 */
export function textOf(ev: PdcaLiveEventPayload): {
  primary: string;
  statusKey: string;
  statusLiteral: string;
  percent: string;
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
  let statusKey = "";
  if (ev.type === "pdca:stage:start") {
    statusKey =
      status === "completed" ? "chat.completed" : "chat.pdcaStageStarted";
  } else if (ev.type === "pdca:stage:phase") {
    statusKey =
      status === "failed"
        ? "chat.failed"
        : status === "completed"
          ? "chat.pdcaStageDone"
          : "chat.executing";
  } else if (ev.type === "pdca:stage:complete") {
    statusKey = "chat.completed";
  } else if (ev.type === "pdca:stage:fail") {
    statusKey = "chat.failed";
  } else if (ev.type === "pdca:decision") {
    statusKey = "chat.pdcaDecisionRouted";
  }
  return {
    primary,
    statusKey,
    statusLiteral: statusKey ? "" : status,
    percent,
    failed,
  };
}
