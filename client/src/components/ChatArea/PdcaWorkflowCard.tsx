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
 * PdcaWorkflowCard — PDCA 自动启动的聊天正文内嵌卡片（P2-A，2026-09-17）。
 *
 * 取代原"输入区活动条"（PdcaActivityStrip）的聊天正文呈现：以富块形式内嵌在
 * 助手消息流中，展示「已启动 PDCA 任务规划」快照（decision / stage / status）。
 *
 * 批次 14（P2-A，2026-11-24）三处收敛 —— 本卡只做**摘要**，详情一律去抽屉：
 *  1. **不显示进度百分比 / 计数**（硬规则 1：本卡走 SSE、抽屉走 REST，两源同显必漂移）；
 *  2. **实时覆盖只作用于该会话最后一张卡**（历史卡只渲染自己的持久化快照，
 *     原实现用"会话最新事件"覆盖所有卡 ⇒ 老卡跟着最新一轮进度变，串台）；
 *  3. 提供「查看详情」入口 ⇒ 打开抽屉（`usePdcaDrawerStore`，与浮动栏徽标共用同一开合态）。
 *
 * 复用：STAGE_META / DECISION_META / FALLBACK_META / textOf / findLatestEvent /
 * PROGRESS_EVENT_TYPES（PdcaActivityStrip 导出，避免逻辑复制）。
 */
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useOrchestrationStore } from "@/stores/orchestrationStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useChatStore } from "@/stores/chat";
import { usePdcaDrawerStore } from "@/stores/pdcaDrawerStore";
import type { PdcaWorkflowProgressData } from "@/types/message";
import {
  FALLBACK_META,
  STAGE_META,
  PROGRESS_EVENT_TYPES,
  findLatestEvent,
  isTerminalPdcaEvent,
  metaLabel,
  textOf,
  type StageMeta,
} from "./PdcaActivityStrip";

/** 决策标签 → 文案键（渲染处 t()；原中文文案已迁 i18n） */
const DECISION_LABEL_KEYS: Record<
  PdcaWorkflowProgressData["decision"],
  string
> = {
  pdl: "chat.pdcaModePdl",
  "stage-chain": "chat.pdcaModeStageChain",
  research: "chat.pdcaModeResearch",
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
 * 实时阶段进度覆盖：**仅该会话最后一张 PDCA 卡**接受实时事件覆盖。
 *
 * 硬规则 2：历史卡绑定自己的快照时刻 —— 同一会话多轮 PDCA 时，若所有卡都取
 * "会话最新事件"，老卡会跟着最新一轮的进度变（串台）。
 */
function useLiveProgress(
  sessionId: string,
  enabled: boolean,
): {
  ev?: Parameters<typeof textOf>[0];
  hasLive: boolean;
} {
  const timeline = useOrchestrationStore((s) => s.timeline);
  const latest = useOrchestrationStore((s) => s.latest);
  // P2-4（2026-09-27 审计）：原在 hook 体内直调（每次渲染都算）⇒ useMemo 化
  const ev = useMemo(
    () =>
      enabled
        ? findLatestEvent(timeline, latest, sessionId, PROGRESS_EVENT_TYPES)
        : null,
    [timeline, latest, sessionId, enabled],
  );
  return { ev: ev ?? undefined, hasLive: Boolean(ev) };
}

/** 本卡是否为当前会话的**最后一张** PDCA 卡（纯读 chat store；结果稳定为 boolean） */
function useIsLatestPdcaCard(blockId?: string): boolean {
  return useChatStore((s) => {
    if (!blockId) return false;
    for (let i = s.messages.length - 1; i >= 0; i--) {
      const blocks = s.messages[i].blocks ?? [];
      for (let j = blocks.length - 1; j >= 0; j--) {
        if (blocks[j].type === "pdca_workflow") return blocks[j].id === blockId;
      }
    }
    return false;
  });
}

/** 「查看详情」：打开抽屉（唯一详情来源），与浮动栏徽标共用同一开合态 */
function DetailsButton(): ReactNode {
  const { t } = useTranslation();
  const setOpen = usePdcaDrawerStore((s) => s.setOpen);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="shrink-0 text-[10px] text-blue-600 dark:text-blue-400 hover:underline"
    >
      {t("chat.pdcaViewDetails")}
    </button>
  );
}

/** PDCA 内嵌卡片：快照 + 实时进度 */
export default function PdcaWorkflowCard({
  blockId,
  sessionId,
  data,
}: {
  /** 块 ID：用于判定"是否为最后一张卡"（历史卡不接实时事件） */
  blockId?: string;
  sessionId?: string;
  data?: PdcaWorkflowProgressData;
}): ReactNode {
  const { t } = useTranslation();
  const currentSessionId = useSessionStore((s) => s.currentSession?.id);
  const sid = sessionId ?? currentSessionId ?? "";
  const isLatest = useIsLatestPdcaCard(blockId);
  const { ev: liveEv, hasLive } = useLiveProgress(sid, isLatest);

  // 实时事件主导：阶段胶囊 + 状态文案走 PDCA 事件文本（与活动条一致）
  if (hasLive && liveEv) {
    const info = textOf(liveEv);
    const statusText = info.statusKey ? t(info.statusKey) : info.statusLiteral;
    return (
      <LivePdcaCard
        evMeta={info.failed ? FALLBACK_META : undefined}
        primary={info.primary}
        statusText={statusText}
        failed={info.failed}
        // 2026-11-24（批次 5 / C3）：终态事件（complete/fail）不再渲染运行脉冲
        active={!isTerminalPdcaEvent(liveEv)}
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
        <span>{metaLabel(meta, t)}</span>
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-gray-700 dark:text-gray-200">
          🔄 {t("chat.pdcaAutoLaunched")}
        </div>
        <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {t(DECISION_LABEL_KEYS[data.decision])}
        </div>
        {data.message && (
          <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
            {data.message}
          </div>
        )}
      </div>
      {/* 批次 14（P2-A）：详情入口 —— 百分比 / 计数 / 步骤明细只在抽屉 */}
      <DetailsButton />
    </div>
  );
}

/** 实时进度卡：内嵌卡片形态的活跃进度展示 */
function LivePdcaCard({
  evMeta,
  primary,
  statusText,
  failed,
  active,
}: {
  evMeta?: StageMeta;
  primary: string;
  statusText: string;
  failed: boolean;
  /** 编排是否仍在进行（终态事件 ⇒ false：只显示静态点，不再脉冲） */
  active: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const meta = evMeta ?? FALLBACK_META;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/90 dark:bg-gray-800/90 border border-gray-200/60 dark:border-gray-700/60 shadow-sm">
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          active ? "bg-blue-400 animate-pulse" : "bg-gray-400"
        }`}
      />
      <span
        className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${meta.capsule}`}
      >
        <span>{meta.icon}</span>
        <span>{metaLabel(meta, t)}</span>
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
      {/* 批次 14（P2-A）：详情入口 —— 本卡不再显示进度百分比 */}
      <DetailsButton />
    </div>
  );
}
