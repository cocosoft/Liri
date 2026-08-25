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
 * 轨迹调试服务 — 封装 GET /v1/sessions/:id/events
 *
 * M1-7：仅前端调试用，无 Tauri IPC fallback。
 * R-6 修复（2026-08-23）：失败时**抛错**（不再静默返回空）——让调用方
 * （trajectoryStore / streamMessage）区分「加载失败」与「确实无事件」，
 * 避免面板把加载失败误显示为"暂无事件"。所有调用点均已 try/catch。
 */

import type { LiriEvent, LiriEventType } from "../types";
import { http as apiHttp } from "./httpClient";
import { getBackendBaseUrl } from "./backendUrl";
import { createLogger } from "../utils/logger";
import { handleClientError } from "../utils/handleError";
import { getOTelTracing } from "../monitoring/otel";

const logger = createLogger("trajectoryService");

export interface SessionEventsQuery {
  fromSeq?: number;
  toSeq?: number;
  types?: LiriEventType[];
  limit?: number;
}

export interface SessionEventsResponse {
  events: LiriEvent[];
  tailSeq: number;
  hasMore: boolean;
}

/** 事件投影统计（D7，2026-08-24）——后端 EventMessageDeriver.deriveSessionStats 镜像 */
export interface EventSessionStats {
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  toolResultCount: number;
  toolCanceledCount: number;
  toolOrphanCount: number;
  turnCount: number;
  compactionCount: number;
  compactedSourceEventCount: number;
  eventCount: number;
}

export const trajectoryService = {
  /**
   * 获取会话事件流。
   * 失败时抛出错误（调用方区分失败与空）；正常时返回事件流。
   */
  getEvents: (
    sessionId: string,
    query?: SessionEventsQuery,
  ): Promise<SessionEventsResponse> => {
    return getOTelTracing().asyncWrap(
      "services:trajectory:getEvents",
      async () => {
        try {
          const params: Record<string, string> = {};
          if (query?.fromSeq !== undefined)
            params.fromSeq = String(query.fromSeq);
          if (query?.toSeq !== undefined) params.toSeq = String(query.toSeq);
          if (query?.types && query.types.length > 0)
            params.types = query.types.join(",");
          if (query?.limit !== undefined) params.limit = String(query.limit);

          const res = await apiHttp.get<SessionEventsResponse>(
            `/v1/sessions/${sessionId}/events`,
            { params },
          );
          if (res.ok && res.data) {
            return res.data;
          }
          const msg =
            typeof res.error === "string" && res.error
              ? res.error
              : "获取会话事件流失败";
          logger.warn("获取会话事件流失败", { sessionId, error: msg });
          throw new Error(msg);
        } catch (e) {
          handleClientError(e, {
            module: "services:trajectory",
            action: "getEvents",
          });
          throw e;
        }
      },
    );
  },

  /** 获取会话事件投影统计（D7，2026-08-24） */
  getSessionStats: (sessionId: string): Promise<EventSessionStats> => {
    return getOTelTracing().asyncWrap(
      "services:trajectory:getSessionStats",
      async () => {
        try {
          const res = await apiHttp.get<EventSessionStats>(
            `/v1/sessions/${sessionId}/stats`,
          );
          if (res.ok && res.data) {
            return res.data;
          }
          const msg =
            typeof res.error === "string" && res.error
              ? res.error
              : "获取会话统计失败";
          logger.warn("获取会话统计失败", { sessionId, error: msg });
          throw new Error(msg);
        } catch (e) {
          handleClientError(e, {
            module: "services:trajectory",
            action: "getSessionStats",
          });
          throw e;
        }
      },
    );
  },

  /** 导出会话事件（P7，2026-08-25）：下载 jsonl/json 文件 */
  exportEvents: (
    sessionId: string,
    format: "jsonl" | "json" = "jsonl",
  ): void => {
    try {
      const url = `${getBackendBaseUrl()}/v1/sessions/${encodeURIComponent(
        sessionId,
      )}/events/export?format=${format}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = `events-${sessionId}.${format}`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      handleClientError(e, {
        module: "services:trajectory",
        action: "exportEvents",
      });
    }
  },
};
