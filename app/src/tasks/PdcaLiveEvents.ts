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
 * PdcaLiveEvents — PDCA 独立事件通道（OBS，M1a，2026-09-04）
 *
 * 事件契约 + JSON 安全载荷构造（无 undefined，规避 D1 无损校验教训，见 F2）。
 * 传输复用既有全局 SSE（broadcastEvent → /v1/events `event: <type>`），
 * 前端 orchestrationStore 按命名空间订阅（M1b）。
 *
 * 设计评审：dev_docs/OBS事件通道设计评审-20260904.md §四/§五。
 * 会话消息只落 complete/fail 摘要；phase/tool 心跳不落盘（由调用方保证）。
 */

/** PDCA 独立通道事件类型（命名空间 pdca） */
export type PdcaLiveEventType =
  | 'pdca:stage:start'
  | 'pdca:stage:phase'
  | 'pdca:stage:complete'
  | 'pdca:stage:fail'
  | 'pdca:tool:executed';

/** 归属字段（编排视图按任一过滤；PDL 快速路径无 taskId 时用 planId） */
export interface PdcaLiveCore {
  taskId?: string;
  planId?: string;
  projectId?: string;
  sessionId?: string;
}

/** 进度载荷（M1a 支持字段；后续按需扩展） */
export interface PdcaLiveData {
  stage?: 'plan' | 'execute' | 'review' | 'decide';
  stepId?: string;
  status?: 'started' | 'running' | 'completed' | 'failed' | 'cancelled';
  percent?: number;
  completedSteps?: number;
  totalSteps?: number;
  failedSteps?: number;
  currentStep?: string;
  toolSummary?: string;
  tokenCost?: number;
  durationMs?: number;
  message?: string;
}

/** 省略 undefined 键（浅层，用于保证 JSON 安全） */
function omitUndefined<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * 构造事件载荷（纯函数，可单测）
 */
export function buildPdcaLivePayload(
  type: PdcaLiveEventType,
  time: number,
  core: PdcaLiveCore,
  data: PdcaLiveData
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type,
    time,
    ...omitUndefined(core),
    data: omitUndefined(data),
  };
}

/**
 * 广播 PDCA 独立通道事件（懒加载 broadcastEvent 避免循环依赖；失败不影响任务）
 */
export async function emitPdcaLiveEvent(
  type: PdcaLiveEventType,
  core: PdcaLiveCore,
  data: PdcaLiveData
): Promise<void> {
  try {
    const { broadcastEvent } = await import('@modules/infrastructure');
    broadcastEvent(type, buildPdcaLivePayload(type, Date.now(), core, data));
  } catch {
    // @ignore-catch — 事件广播失败不影响任务执行（CS03）
  }
}
