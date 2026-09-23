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
 * PdcaWorkflowCard — PDCA 自动启动的聊天正文内嵌进度卡片（P2-A，2026-09-17）。
 *
 * 取代原"输入区活动条"（PdcaActivityStrip）的聊天正文呈现：以富块形式内嵌在
 * 助手消息流中，展示「已启动 PDCA 任务规划」快照（decision / stage / status）。
 * 实时阶段进度（plan→execute→review→decide）由 orchestrationStore 订阅
 * pdca:* 事件按 sessionId 刷新当前胶囊；无实时事件时回落持久化快照（pdcaWorkflowData）。
 *
 * 复用：STAGE_META / DECISION_META / FALLBACK_META / textOf / findLatestEvent /
 * PROGRESS_EVENT_TYPES（PdcaActivityStrip 导出，避免逻辑复制）。
 */
import type { ReactNode } from "react";
import { useOrchestrationStore } from "@/stores/orchestrationStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { PdcaWorkflowProgressData } from "@/types/message";
import {
  FALLBACK_META,
  STAGE_META,
  PROGRESS_EVENT_TYPES,
  findLatestEvent,
  textOf,
  type StageMeta,
} from "./PdcaActivityStrip";

/** 决策标签 → 胶囊文案 */
const DECISION_LABEL: Record<PdcaWorkflowProgressData["decision"], string> = {
  pdl: "快速路径（PlanDrivenLoop）",
  "stage-chain": "经典阶段链（复杂/危险任务）",
  research: "研究模式（候选生成 + 对抗评审）",
};

/**
 * 从持久化快照取阶段元信息；快照无 stage 时回落 PDCA 兜底。
 */
function snapshotMetaOf(data: PdcaWorkflowProgressData): StageMeta {
  const stage = data.stage ?? "";
  if (STAGE_META[stage]) return STAGE_META[stage];
  return FALLBACK_META;
}

/**
 * 实时阶段进度覆盖：当前会话仍有活跃 pdca:* 进度事件时，以该事件主导
 * 阶段胶囊与状态文案（与 PdcaActivityStrip 同源逻辑）。
 */
function useLiveProgress(sessionId: string): {
  ev?: Parameters<typeof textOf>[0];
  hasLive: boolean;
} {
  const timeline = useOrchestrationStore((s) => s.timeline);
  const latest = useOrchestrationStore((s) => s.latest);
  const ev = findLatestEvent(timeline, latest, sessionId, PROGRESS_EVENT_TYPES);
  return { ev: ev ?? undefined, hasLive: Boolean(ev) };
}

/** PDCA 内嵌卡片：快照 + 实时进度 */
export default function PdcaWorkflowCard({
  sessionId,
  data,
}: {
  sessionId?: string;
  data?: PdcaWorkflowProgressData;
}): ReactNode {
  const currentSessionId = useSessionStore((s) => s.currentSession?.id);
  const sid = sessionId ?? currentSessionId ?? "";
  const { ev: liveEv, hasLive } = useLiveProgress(sid);

  // 实时事件主导：阶段胶囊 + 状态文案走 PDCA 事件文本（与活动条一致）
  if (hasLive && liveEv) {
    const meta = textOf(liveEv).failed ? FALLBACK_META : undefined;
    return (
      <LivePdcaCard
        evMeta={meta ?? undefined}
        primary={textOf(liveEv).primary}
        statusText={textOf(liveEv).statusText}
        failed={textOf(liveEv).failed}
      />
    );
  }

  // 快照主导：持久化段
  if (!data) return null;
  const meta = snapshotMetaOf(data);
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-white/90 dark:bg-gray-800/90 border border-gray-200/60 dark:border-gray-700/60 shadow-sm">
      <span
        className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${meta.capsule}`}
      >
        <span>{meta.icon}</span>
        <span>{meta.label}</span>
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-gray-700 dark:text-gray-200">
          🔄 已自动创建项目并启动任务规划
        </div>
        <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {DECISION_LABEL[data.decision]}
        </div>
        {data.message && (
          <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
            {data.message}
          </div>
        )}
      </div>
    </div>
  );
}

/** 实时进度卡：内嵌卡片形态的活跃进度展示 */
function LivePdcaCard({
  evMeta,
  primary,
  statusText,
  failed,
}: {
  evMeta?: StageMeta;
  primary: string;
  statusText: string;
  failed: boolean;
}): ReactNode {
  const meta = evMeta ?? FALLBACK_META;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/90 dark:bg-gray-800/90 border border-gray-200/60 dark:border-gray-700/60 shadow-sm">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
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
    </div>
  );
}
