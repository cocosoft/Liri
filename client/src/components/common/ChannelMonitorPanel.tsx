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
 * ChannelMonitorPanel — 渠道实时监控面板
 *
 * 数据源：GET /v1/channels/monitor/stream（SSE，ChannelRealtimeMonitor）
 * 展示：五态机实时状态、探测延迟、重连计数、错误尾部快照；
 *       支持强制重连兜底（POST /v1/channels/monitor/force-reconnect）。
 * SSE 断线指数退避重连（3s → 30s，对齐 useNotificationSSE 模式）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { channelService } from "../../services/channelService";
import { getBackendBaseUrl } from "../../services/backendUrl";
import { handleClientError } from "../../utils/handleError";
import { createLogger } from "../../utils/logger";
import type {
  ChannelRuntimeStatus,
  ChannelRuntimeStatusInfo,
  MessageTrace,
} from "../../types";

const logger = createLogger("ChannelMonitorPanel");

/** 五态徽章样式（对齐 SystemHealthStatus 的绿/黄/红语义） */
const STATUS_BADGE: Record<
  ChannelRuntimeStatus,
  { label: string; className: string }
> = {
  connected: {
    label: "已连接",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  },
  connecting: {
    label: "连接中",
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  reconnecting: {
    label: "重连等待",
    className:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  },
  error: {
    label: "异常",
    className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  },
  disconnected: {
    label: "未连接",
    className:
      "bg-gray-100 text-gray-500 dark:bg-gray-700/50 dark:text-gray-400",
  },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(0)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export function ChannelMonitorPanel() {
  const [channels, setChannels] = useState<ChannelRuntimeStatusInfo[]>([]);
  const [connected, setConnected] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reconnectingIds, setReconnectingIds] = useState<Set<string>>(
    new Set(),
  );

  // ── 消息链路视图（方案 A）──
  const [tab, setTab] = useState<"status" | "traces">("status");
  const [traces, setTraces] = useState<MessageTrace[]>([]);
  const [tracesLoading, setTracesLoading] = useState(false);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const stoppedRef = useRef(false);

  /** SSE 单事件 → 更新对应渠道状态（status_change 带全量字段时直接替换） */
  const applyEvent = useCallback(
    (event: {
      type: string;
      channelId: string;
      data?: Record<string, unknown>;
    }) => {
      setChannels((prev) => {
        const idx = prev.findIndex(
          (c) => c.channelId === event.channelId,
        );
        if (idx === -1) return prev;
        const next = [...prev];
        const current = next[idx];
        if (
          event.type === "status_change" &&
          typeof event.data?.current === "string"
        ) {
          next[idx] = {
            ...current,
            status: event.data.current as ChannelRuntimeStatus,
          };
        } else if (event.type === "reconnecting") {
          next[idx] = {
            ...current,
            status: "reconnecting",
            reconnectCount:
              typeof event.data?.attempt === "number"
                ? event.data.attempt
                : current.reconnectCount,
          };
        } else if (event.type === "recovered") {
          next[idx] = {
            ...current,
            status: "connected",
            healthy: true,
            reconnectCount: 0,
            lastError: null,
          };
        } else if (event.type === "probe_failed") {
          next[idx] = { ...current, healthy: false };
        }
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    stoppedRef.current = false;

    function connect(): void {
      if (stoppedRef.current) return;

      // SSE 直连本地后端（EventSource 原生，不经 httpClient 代理层）
      const url = `${getBackendBaseUrl()}/v1/channels/monitor/stream`;
      logger.info("SSE 连接发起", { url });
      const es = new EventSource(url);

      // 连接即推全量快照
      es.addEventListener("snapshot", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as {
            channels: ChannelRuntimeStatusInfo[];
          };
          setChannels(data.channels ?? []);
          setConnected(true);
          logger.info("SSE 初始快照已接收", {
            channelCount: data.channels?.length ?? 0,
          });
        } catch (error) {
          logger.warn("SSE 快照解析失败", {
            error: String(error),
            rawData: typeof e.data === "string" ? e.data.slice(0, 200) : e.data,
          });
        }
      });

      for (const type of [
        "status_change",
        "reconnecting",
        "recovered",
        "probe_failed",
      ]) {
        es.addEventListener(type, (e: MessageEvent) => {
          try {
            const event = JSON.parse(e.data);
            logger.debug("SSE 事件接收", { type, channelId: event.channelId });
            applyEvent(event);
          } catch (error) {
            logger.warn("SSE 事件解析失败", {
              type,
              error: String(error),
              rawData: typeof e.data === "string" ? e.data.slice(0, 200) : e.data,
            });
          }
        });
      }

      es.onopen = () => {
        // 首连或断线恢复（attempt>0 说明经历过重连）
        const wasReconnecting = reconnectAttemptRef.current > 0;
        logger.info("SSE 连接已建立", {
          wasReconnecting,
          previousAttempts: reconnectAttemptRef.current,
        });
        reconnectAttemptRef.current = 0;
        setConnected(true);
      };

      es.onerror = () => {
        es.close();
        setConnected(false);
        logger.warn("SSE 连接断开，进入重连调度", {
          attempt: reconnectAttemptRef.current + 1,
        });
        if (!stoppedRef.current) {
          // 指数退避重连（3s → 6s → 12s → ... 上限 30s）
          const delay = Math.min(
            3000 * Math.pow(2, reconnectAttemptRef.current),
            30_000,
          );
          reconnectAttemptRef.current++;
          reconnectTimerRef.current = setTimeout(connect, delay);
          logger.info("SSE 重连已调度", {
            nextAttempt: reconnectAttemptRef.current,
            delayMs: delay,
          });
        } else {
          logger.info("SSE 断开且组件已停止，不再重连");
        }
      };

      esRef.current = es;
    }

    connect();

    return () => {
      stoppedRef.current = true;
      esRef.current?.close();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        logger.info("SSE 清理：组件卸载，关闭连接并取消待执行重连", {
          pendingAttempt: reconnectAttemptRef.current,
        });
      }
    };
  }, [applyEvent]);

  const handleForceReconnect = useCallback(
    async (channelId: string) => {
      const t0 = Date.now();
      logger.info("强制重连请求发起", { channelId });
      setReconnectingIds((prev) => new Set(prev).add(channelId));
      try {
        const result = await channelService.forceReconnect(channelId);
        logger.info("强制重连请求完成", {
          channelId,
          recovered: result.recovered,
          error: result.error ?? null,
          elapsedMs: Date.now() - t0,
        });
        if (!result.recovered) {
          handleClientError(
            new Error(result.error ?? "强制重连后探测仍不健康"),
            { module: "ChannelMonitorPanel", action: "forceReconnect" },
          );
        }
        // 成功/失败状态由 SSE status_change/recovered 事件驱动刷新
      } catch (error) {
        logger.warn("强制重连请求异常", {
          channelId,
          error: String(error),
          elapsedMs: Date.now() - t0,
        });
        handleClientError(error, {
          module: "ChannelMonitorPanel",
          action: "forceReconnect",
        });
      } finally {
        setReconnectingIds((prev) => {
          const next = new Set(prev);
          next.delete(channelId);
          return next;
        });
      }
    },
    [],
  );

  /** 拉取最近消息链路（方案 A） */
  const loadTraces = useCallback(async () => {
    setTracesLoading(true);
    try {
      const resp = await channelService.getMessageTraces(50);
      logger.info("消息链路查询成功", { count: resp.traces.length });
      setTraces(resp.traces);
    } catch (error) {
      logger.warn("消息链路查询失败", { error: String(error) });
      handleClientError(error, {
        module: "ChannelMonitorPanel",
        action: "loadTraces",
      });
    } finally {
      setTracesLoading(false);
    }
  }, []);

  // 链路 Tab 激活时拉取 + 10s 轮询（inflight 消息可通过轮询看到终态收敛）
  useEffect(() => {
    if (tab !== "traces") return;
    void loadTraces();
    const timer = setInterval(() => void loadTraces(), 10_000);
    return () => clearInterval(timer);
  }, [tab, loadTraces]);

  if (channels.length === 0) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">📡</span>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          渠道实时监控
        </h3>
        {/* Tab 切换：通道状态 | 消息链路 */}
        <div className="ml-2 flex gap-1">
          {(
            [
              ["status", "通道状态"],
              ["traces", "消息链路"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`text-[11px] px-2 py-0.5 rounded ${
                tab === key
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                  : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span
          className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
            connected
              ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
              : "bg-gray-100 text-gray-500 dark:bg-gray-700/50 dark:text-gray-400"
          }`}
        >
          {tab === "traces"
            ? tracesLoading
              ? "加载中…"
              : `${traces.length} 条`
            : connected
              ? "实时"
              : "离线"}
        </span>
      </div>

      {tab === "traces" ? (
        <MessageTracesView
          traces={traces}
          expandedTrace={expandedTrace}
          onToggle={(id) =>
            setExpandedTrace(expandedTrace === id ? null : id)
          }
          onRefresh={() => void loadTraces()}
        />
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
        {channels.map((ch) => {
          const badge = STATUS_BADGE[ch.status] ?? STATUS_BADGE.disconnected;
          const busy = reconnectingIds.has(ch.channelId);
          return (
            <div
              key={ch.channelId}
              className="flex items-center gap-2 text-xs py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700/40"
            >
              <span className="font-medium text-gray-700 dark:text-gray-200 w-24 truncate">
                {ch.channelId}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[11px] ${badge.className}`}
              >
                {badge.label}
              </span>
              {ch.latencyMs !== null && (
                <span className="text-gray-500 dark:text-gray-400">
                  {ch.latencyMs}ms
                </span>
              )}
              {ch.reconnectCount > 0 && (
                <span className="text-yellow-600 dark:text-yellow-400">
                  重连×{ch.reconnectCount}
                </span>
              )}
              {ch.uptimeMs > 0 && (
                <span className="text-gray-400 dark:text-gray-500">
                  {formatDuration(ch.uptimeMs)}
                </span>
              )}
              {ch.lastError && (
                <button
                  type="button"
                  onClick={() =>
                    setExpanded(
                      expanded === ch.channelId ? null : ch.channelId,
                    )
                  }
                  className="text-red-500 hover:underline truncate max-w-40 text-left"
                  title={ch.lastError}
                >
                  {ch.lastError}
                </button>
              )}
              <button
                type="button"
                disabled={busy || !ch.enabled}
                onClick={() => void handleForceReconnect(ch.channelId)}
                className="ml-auto text-[11px] px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? "重连中…" : "强制重连"}
              </button>

              {expanded === ch.channelId && ch.lastErrorSnapshot && (
                <pre className="w-full mt-1 p-2 rounded bg-gray-50 dark:bg-gray-900/60 text-[10px] text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                  {ch.lastErrorSnapshot}
                </pre>
              )}
            </div>
          );
        })}
        </div>
      )}
    </div>
  );
}

/** 消息整体状态徽章 */
const TRACE_STATUS_BADGE: Record<
  MessageTrace["status"],
  { label: string; className: string }
> = {
  ok: {
    label: "完成",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  },
  inflight: {
    label: "处理中",
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  fail: {
    label: "失败",
    className:
      "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  },
  rejected: {
    label: "被拒",
    className:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  },
};

/** 阶段状态点 */
const STAGE_DOT: Record<string, string> = {
  ok: "bg-green-500",
  fail: "bg-red-500",
  skip: "bg-gray-400",
};

/** 阶段中文名 */
const STAGE_LABEL: Record<string, string> = {
  frame_check: "帧验证",
  dm_auth: "授权",
  dedup: "去重",
  rate_limit: "限流",
  shared_session: "共享会话",
  session: "会话",
  llm: "LLM",
  outbound: "出站",
};

/**
 * 消息链路视图（方案 A）：最近消息列表 + 展开阶段时间线
 * 直接回答"这条消息卡在哪一步、各阶段耗时多少"
 */
function MessageTracesView({
  traces,
  expandedTrace,
  onToggle,
  onRefresh,
}: {
  traces: MessageTrace[];
  expandedTrace: string | null;
  onToggle: (traceId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-end mb-1.5">
        <button
          type="button"
          onClick={onRefresh}
          className="text-[11px] px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          刷新
        </button>
      </div>
      {traces.length === 0 ? (
        <div className="text-xs text-gray-400 dark:text-gray-500 py-6 text-center">
          暂无消息链路记录（等待渠道消息入站）
        </div>
      ) : (
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {traces.map((trace) => {
            const badge =
              TRACE_STATUS_BADGE[trace.status] ?? TRACE_STATUS_BADGE.fail;
            const failedStage = trace.stages.find((s) => s.status === "fail");
            return (
              <div key={trace.traceId}>
                <button
                  type="button"
                  onClick={() => onToggle(trace.traceId)}
                  className="w-full flex items-center gap-2 text-xs py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700/40 text-left"
                >
                  <span className="font-medium text-gray-700 dark:text-gray-200 w-16 truncate">
                    {trace.channelName}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[11px] shrink-0 ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                  {trace.totalMs !== undefined && (
                    <span className="text-gray-500 dark:text-gray-400 shrink-0">
                      {trace.totalMs}ms
                    </span>
                  )}
                  <span className="text-gray-400 dark:text-gray-500 truncate">
                    {trace.contentPreview || "(空)"}
                  </span>
                  {(failedStage || trace.error) && (
                    <span className="text-red-500 dark:text-red-400 truncate max-w-48">
                      {failedStage
                        ? `${STAGE_LABEL[failedStage.name] ?? failedStage.name}失败`
                        : trace.error}
                    </span>
                  )}
                  <span className="ml-auto text-gray-300 dark:text-gray-600 shrink-0">
                    {expandedTrace === trace.traceId ? "▲" : "▼"}
                  </span>
                </button>

                {expandedTrace === trace.traceId && (
                  <div className="mx-2 mb-1.5 p-2 rounded bg-gray-50 dark:bg-gray-900/60">
                    <div className="text-[10px] text-gray-400 dark:text-gray-500 mb-1 break-all">
                      traceId: {trace.traceId}
                      {trace.error && (
                        <span className="text-red-500 dark:text-red-400">
                          {" "}
                          | {trace.error}
                        </span>
                      )}
                    </div>
                    <div className="space-y-0.5">
                      {trace.stages.map((stage, i) => (
                        <div
                          key={`${trace.traceId}-${stage.name}-${i}`}
                          className="flex items-center gap-2 text-[11px]"
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              STAGE_DOT[stage.status] ?? "bg-gray-400"
                            }`}
                          />
                          <span className="text-gray-600 dark:text-gray-300 w-16 shrink-0">
                            {STAGE_LABEL[stage.name] ?? stage.name}
                          </span>
                          {stage.durationMs !== undefined && (
                            <span className="text-gray-500 dark:text-gray-400">
                              {stage.durationMs}ms
                            </span>
                          )}
                          {stage.detail && (
                            <span className="text-gray-400 dark:text-gray-500 truncate">
                              {stage.detail}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
