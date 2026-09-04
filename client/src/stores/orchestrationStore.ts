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
 * OrchestrationStore — PDCA 独立事件通道订阅器（OBS，M1b，2026-09-04）
 *
 * 后端经全局 SSE 广播 `pdca:*` 事件（PdcaLiveEvents），本 store 订阅并维护
 * 「task/plan → 最近事件」映射，供编排视图（任意页面）渲染实时进度。
 * REST（pdca list/status）仍是状态事实源；本 store 只承载实时增量与心跳。
 */
import { create } from "zustand";
import { sseService } from "@/services/sseService";

/** 后端契约镜像（PdcaLiveEvents.ts） */
export interface PdcaLiveEventPayload {
  schemaVersion: number;
  type: string;
  time: number;
  taskId?: string;
  planId?: string;
  projectId?: string;
  sessionId?: string;
  data?: Record<string, unknown>;
}

/** 按 task/plan 归一后的最近事件快照 */
export interface OrchestrationEntry {
  key: string; // taskId || planId
  event: PdcaLiveEventPayload;
}

interface OrchestrationState {
  /** key(taskId||planId) → 最近一次 pdca:* 事件（含开始/进度/终态） */
  latest: Record<string, PdcaLiveEventPayload>;
  /** 最近事件时间线（仅保留尾部 200 条，供调试/审计面板） */
  timeline: PdcaLiveEventPayload[];
  ingest: (event: PdcaLiveEventPayload) => void;
  /** REST 快照回放（断线重连后先拉一次状态源补齐缺口） */
  replay: (events: PdcaLiveEventPayload[]) => void;
  clear: () => void;
}

const MAX_TIMELINE = 200;

const PDCA_EVENT_NAMES = [
  "pdca:stage:start",
  "pdca:stage:phase",
  "pdca:stage:complete",
  "pdca:stage:fail",
  "pdca:tool:executed",
  "pdca:decision",
];

function keyOf(event: PdcaLiveEventPayload): string {
  return event.taskId || event.planId || `evt-${event.time}`;
}

export const useOrchestrationStore = create<OrchestrationState>((set, get) => ({
  latest: {},
  timeline: [],

  ingest: (event) => {
    const key = keyOf(event);
    const timeline = [...get().timeline, event].slice(-MAX_TIMELINE);
    set({
      latest: { ...get().latest, [key]: event },
      timeline,
    });
  },

  replay: (events) => {
    const latest = { ...get().latest };
    for (const ev of events) {
      latest[keyOf(ev)] = ev;
    }
    set({ latest });
  },

  clear: () => set({ latest: {}, timeline: [] }),
}));

/** 幂等注册：一次性挂接 5 类 pdca:* SSE 事件（useInitApp 调用） */
export function initOrchestrationStore(): void {
  for (const name of PDCA_EVENT_NAMES) {
    sseService.on(name, (data: Record<string, unknown>) => {
      const raw = { ...(data as unknown as Record<string, unknown>) };
      // 后端广播载荷已在顶层带 type/time；缺失 type 时用事件名兜底
      const event: PdcaLiveEventPayload = {
        schemaVersion: Number(raw.schemaVersion ?? 1),
        type: (raw.type as string) ?? name,
        time: Number(raw.time ?? Date.now()),
        taskId: raw.taskId as string | undefined,
        planId: raw.planId as string | undefined,
        projectId: raw.projectId as string | undefined,
        sessionId: raw.sessionId as string | undefined,
        data: (raw.data as Record<string, unknown> | undefined) ?? {},
      };
      useOrchestrationStore.getState().ingest(event);
    });
  }
}
