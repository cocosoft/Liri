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
 * M1-7：仅前端调试用，无 Tauri IPC fallback（CS03：调试面板不可用即返回空，
 * 不影响主流程）。
 */

import type { LiriEvent, LiriEventType } from "../types";
import { http as apiHttp } from "./httpClient";
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

export const trajectoryService = {
  /**
   * 获取会话事件流。
   * 失败时返回空结果（调试场景降级），不抛错。
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
          logger.warn("获取会话事件流失败", {
            sessionId,
            error: res.error,
          });
        } catch (e) {
          handleClientError(e, {
            module: "services:trajectory",
            action: "getEvents",
          });
        }
        // 降级：返回空
        return { events: [], tailSeq: 0, hasMore: false };
      },
    );
  },
};
