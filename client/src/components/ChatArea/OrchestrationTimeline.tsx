/**
 * OrchestrationTimeline — 统一编排时间线
 *
 * 汇聚所有编排模块（Council / DAG / Swarm / AgentChain / Plan / SubAgent）
 * 的事件，以统一时间线呈现。
 *
 * 功能：
 * - SSE 实时订阅所有编排事件
 * - 初始加载时通过 REST API 回放历史事件
 * - 基于 eventId 去重（防止历史 + 实时重复）
 * - 按时间线渲染，支持自动滚动到最新
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { getBackendBaseUrl } from "../../services/backendUrl";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:orchTimeline");
import type {
  TimelineEvent,
  SSETimelineEvent,
  TimelineEventType,
  OrchestrationHistoryResponse,
  CouncilStartData,
  CouncilEndData,
  CouncilAgentSpeakingData,
  SwarmDispatchData,
  SwarmAgentStatusData,
  DagTaskStartData,
  DagTaskProgressData,
} from "../../types/orchestration";
import AgentProgressBlock from "./AgentProgressBlock";
import type { AgentExecStatus, ToolCallState } from "./AgentProgressBlock";
import CouncilPanel from "./CouncilPanel";
import type { StatementRecord } from "./CouncilPanel";

// ========== 常量 ==========

/** 历史回放批量拉取条数 */
const HISTORY_BATCH_LIMIT = 200;

/** 自动滚动阈值（px） */
const AUTO_SCROLL_THRESHOLD = 100;

// ========== 类型定义 ==========

/** 时间线条目 */
interface TimelineEntry {
  /** 全局唯一 ID */
  id: string;
  /** 事件类型 */
  type: TimelineEventType | string;
  /** 显示时间 */
  time: Date;
  /** 摘要文本 */
  summary: string;
  /** 完整事件 */
  event: TimelineEvent;
}

/** 时间线分组 */
interface TimelineGroup {
  /** 分组 ID（按模块） */
  module: "council" | "dag" | "plan" | "chain" | "swarm" | "agent";
  /** 分组标题 */
  title: string;
  /** 分组图标 */
  icon: string;
  /** 该分组下的条目 */
  entries: TimelineEntry[];
}

/** OrchestrationTimeline 属性 */
interface OrchestrationTimelineProps {
  /** 工作区 ID */
  workspaceId: string;
  /** 工作项 ID */
  workItemId: string;
  /** 深色模式 */
  isDark: boolean;
}

// ========== 辅助函数 ==========

/** 从完整事件类型中提取模块名 */
function extractModule(eventType: string): TimelineGroup["module"] {
  if (eventType.startsWith("council:")) return "council";
  if (eventType.startsWith("dag:")) return "dag";
  if (eventType.startsWith("plan:")) return "plan";
  if (eventType.startsWith("chain:")) return "chain";
  if (eventType.startsWith("swarm:")) return "swarm";
  if (eventType.startsWith("agent:")) return "agent";
  return "dag";
}

/** 从事件数据生成摘要 */
function createSummary(eventType: string, data: unknown): string {
  const d = data as Record<string, unknown>;
  switch (eventType) {
    case "council:start":
      return `Council 辩论开始：${(d as unknown as CouncilStartData)?.topic || ""}`;
    case "council:round:start":
      return `第 ${d.round} 轮辩论开始`;
    case "council:agent:speaking":
      return `${(d as unknown as CouncilAgentSpeakingData)?.agentName} 发言（第 ${d.round} 轮）`;
    case "council:end":
      return `Council 辩论结束：${(d as unknown as CouncilEndData)?.result || ""}`;
    case "council:round":
      return `第 ${d.round} 轮辩论完成`;

    case "dag:start":
      return "DAG 编排开始";
    case "dag:task:start":
      return `任务开始：${(d as unknown as DagTaskStartData)?.taskName || d.taskId}`;
    case "dag:task:progress":
      return `任务进度：${(d as unknown as DagTaskProgressData)?.progress || 0}%`;
    case "dag:task:end":
      return `任务 ${(d as unknown as { success: boolean })?.success ? "完成" : "失败"}`;
    case "dag:end":
      return "DAG 编排结束";

    case "plan:start":
      return "Plan 开始执行";
    case "plan:step:start":
      return `步骤开始：${(d as unknown as { stepName: string })?.stepName || ""}`;
    case "plan:step:completed":
      return `步骤完成：${(d as unknown as { stepName?: string })?.stepName || ""}`;
    case "plan:completed":
      return "Plan 执行完成";

    case "chain:start":
      return "AgentChain 开始";
    case "chain:step":
      return `${(d as unknown as { agentName: string })?.agentName || ""} 执行链步骤`;
    case "chain:end":
      return "AgentChain 完成";

    case "swarm:dispatch":
      return `Swarm 调度：${(d as unknown as SwarmDispatchData)?.description || ""}`;
    case "swarm:agent:status":
      return `${(d as unknown as SwarmAgentStatusData)?.agentName} 状态：${(d as unknown as SwarmAgentStatusData)?.status}`;
    case "swarm:complete":
      return "Swarm 群组完成";

    case "agent:thinking:start":
      return `${(d as unknown as { agentName: string })?.agentName} 开始思考`;
    case "agent:thinking:delta":
      return "思考内容更新...";
    case "agent:thinking:end":
      return `${(d as unknown as { agentName?: string })?.agentName || "Agent"} 思考完成`;
    case "agent:tool_call:start":
      return `${(d as unknown as { agentName?: string })?.agentName || "Agent"} 调用工具：${(d as unknown as { toolName: string })?.toolName}`;
    case "agent:tool_call:end":
      return "工具调用完成";

    default:
      return `事件：${eventType}`;
  }
}

/** 模块配置 */
const MODULE_CONFIG: Record<
  TimelineGroup["module"],
  { title: string; icon: string }
> = {
  council: { title: "理事会辩论", icon: "🏛️" },
  dag: { title: "DAG 编排", icon: "🔀" },
  plan: { title: "Plan 执行", icon: "📋" },
  chain: { title: "Agent 链", icon: "⛓️" },
  swarm: { title: "Swarm 群组", icon: "🐝" },
  agent: { title: "Agent 引擎", icon: "🤖" },
};

/**
 * OrchestrationTimeline 组件
 */
function OrchestrationTimeline({
  workspaceId,
  workItemId,
  isDark,
}: OrchestrationTimelineProps) {
  // ── 状态 ──

  /** 所有时间线条目 */
  const [entries, setEntries] = useState<TimelineEntry[]>([]);

  /** SSE 连接状态 */
  const [connected, setConnected] = useState(false);

  /** 历史回放加载中 */
  const [historyLoading, setHistoryLoading] = useState(true);

  /** 错误信息 */
  const [error, setError] = useState<string | null>(null);

  /** 已处理的 eventId 集合（用于去重） */
  const seenEventIds = useRef(new Set<string>());

  /** EventSource 引用 */
  const eventSourceRef = useRef<EventSource | null>(null);

  /** 容器 ref */
  const containerRef = useRef<HTMLDivElement>(null);

  /** 是否锁定自动滚动 */
  const [autoScroll, setAutoScroll] = useState(true);

  /** Agent 状态映射（agentId -> 状态） */
  const [agentStates, setAgentStates] = useState<
    Record<
      string,
      {
        agentId: string;
        agentName: string;
        status: AgentExecStatus;
        thinkingContent?: string;
        delta?: string;
        currentToolCall?: ToolCallState;
        output?: string;
        durationMs?: number;
      }
    >
  >({});

  /** Council 状态 */
  const [councilState, setCouncilState] = useState<{
    startData?: CouncilStartData;
    currentRound: number;
    maxRounds: number;
    statements: StatementRecord[];
    speakingAgentId?: string;
    streamingDeltas?: Record<string, string>;
    endData?: CouncilEndData;
  }>({ currentRound: 0, maxRounds: 0, statements: [] });

  // ── 添加时间线条目 ──

  const addEntry = useCallback((event: TimelineEvent) => {
    // 去重
    if (seenEventIds.current.has(event.eventId)) return;
    seenEventIds.current.add(event.eventId);

    const entry: TimelineEntry = {
      id: event.eventId,
      type: event.type,
      time: new Date(event.timestamp),
      summary: createSummary(event.type, event.data),
      event,
    };

    setEntries((prev) => [...prev, entry]);
  }, []);

  // ── 处理 SSE 事件 ──

  const handleSSEEvent = useCallback(
    (eventType: string, rawData: SSETimelineEvent) => {
      const data = rawData.data as Record<string, unknown>;
      const eventId = `live_${eventType}_${rawData.timestamp}_${Math.random().toString(36).slice(2, 8)}`;

      // 统一时间线条目
      const timelineEvent: TimelineEvent = {
        eventId,
        type: eventType,
        data: rawData.data,
        timestamp: rawData.timestamp,
        source: "live",
      };
      addEntry(timelineEvent);

      // ── 更新 Agent 状态 ──
      if (eventType.startsWith("agent:")) {
        // 从 data 中提取 agent 信息（可能嵌套在 data.event 的 data 里或者直接在顶层）
        const agentData = data as Record<string, unknown>;
        const agentId = (agentData.agentId as string) || "unknown";
        const agentName = (agentData.agentName as string) || agentId;

        switch (eventType) {
          case "agent:thinking:start":
            setAgentStates((prev) => ({
              ...prev,
              [agentId]: {
                ...prev[agentId],
                agentId,
                agentName,
                status: "thinking",
                thinkingContent: "",
                delta: "",
              },
            }));
            break;
          case "agent:thinking:delta":
            setAgentStates((prev) => {
              const current = prev[agentId];
              const newDelta = (agentData.delta as string) || "";
              return {
                ...prev,
                [agentId]: {
                  ...current,
                  delta: (current?.delta || "") + newDelta,
                },
              };
            });
            break;
          case "agent:thinking:end":
            setAgentStates((prev) => ({
              ...prev,
              [agentId]: {
                ...prev[agentId],
                status: "completed",
                output: (agentData.content as string) || prev[agentId]?.delta,
                durationMs: (agentData.durationMs as number) || undefined,
                delta: undefined,
              },
            }));
            break;
          case "agent:tool_call:start":
            setAgentStates((prev) => ({
              ...prev,
              [agentId]: {
                ...prev[agentId],
                status: "tool_call",
                currentToolCall: {
                  toolName: (agentData.toolName as string) || "",
                  args: (agentData.args as Record<string, unknown>) || {},
                  startTime: rawData.timestamp,
                  status: "running",
                },
              },
            }));
            break;
          case "agent:tool_call:end":
            setAgentStates((prev) => {
              const current = prev[agentId];
              if (!current?.currentToolCall) return prev;
              return {
                ...prev,
                [agentId]: {
                  ...current,
                  status: "thinking",
                  currentToolCall: {
                    ...current.currentToolCall,
                    result: (agentData.result as string) || "",
                    endTime: rawData.timestamp,
                    status: "completed",
                  },
                },
              };
            });
            break;
        }
      }

      // ── 更新 Council 状态 ──
      if (eventType.startsWith("council:")) {
        switch (eventType) {
          case "council:start": {
            const d = rawData.data as unknown as CouncilStartData;
            setCouncilState((prev) => ({
              ...prev,
              startData: d,
              maxRounds: d.maxRounds,
            }));
            break;
          }
          case "council:agent:speaking": {
            const d = rawData.data as unknown as CouncilAgentSpeakingData;
            const statement: StatementRecord = {
              id: `stmt_${d.agentId}_${d.round}_${d.statementType}_${rawData.timestamp}`,
              agentId: d.agentId,
              agentName: d.agentName,
              round: d.round,
              type: d.statementType,
              content: d.content,
              keyPoints: d.keyPoints || [],
              timestamp: rawData.timestamp,
            };
            setCouncilState((prev) => ({
              ...prev,
              currentRound: d.round,
              speakingAgentId: d.agentId,
              statements: [...prev.statements, statement],
            }));
            break;
          }
          case "council:agent:delta": {
            const d = rawData.data as Record<string, unknown>;
            const agentId = d.agentId as string;
            const delta = d.delta as string;
            setCouncilState((prev) => ({
              ...prev,
              speakingAgentId: agentId,
              streamingDeltas: {
                ...prev.streamingDeltas,
                [agentId]: (prev.streamingDeltas?.[agentId] || "") + delta,
              },
            }));
            break;
          }
          case "council:round":
            setCouncilState((prev) => ({
              ...prev,
              currentRound: (rawData.data as Record<string, unknown>)
                .round as number,
              speakingAgentId: undefined,
              streamingDeltas: undefined,
            }));
            break;
          case "council:end": {
            const d = rawData.data as unknown as CouncilEndData;
            setCouncilState((prev) => ({
              ...prev,
              endData: d,
              speakingAgentId: undefined,
              streamingDeltas: undefined,
            }));
            break;
          }
        }
      }
    },
    [addEntry],
  );

  // ── 加载历史回放 ──

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const baseUrl = getBackendBaseUrl();
      const url = `${baseUrl}/v1/workspaces/${workspaceId}/items/${workItemId}/orchestration/history?limit=${HISTORY_BATCH_LIMIT}`;
      const res = await fetch(url);
      if (!res.ok) {
        // 404 表示尚无历史记录，不是错误
        if (res.status === 404) return;
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const result: OrchestrationHistoryResponse = await res.json();

      for (const record of result.events) {
        const eventType = record.eventType.replace(/^orch:/, "");
        const timelineEvent: TimelineEvent = {
          eventId: record.eventId,
          type: eventType,
          data: record.payload,
          timestamp: record.timestamp,
          source: "history",
        };
        addEntry(timelineEvent);

        // 对历史中的 Council 和 Agent 事件也更新状态
        const data = record.payload as Record<string, unknown>;

        // Council 历史回放
        if (eventType.startsWith("council:")) {
          switch (eventType) {
            case "council:start":
              setCouncilState((prev) => ({
                ...prev,
                startData: record.payload as unknown as CouncilStartData,
                maxRounds: (record.payload as unknown as CouncilStartData)
                  .maxRounds,
              }));
              break;
            case "council:agent:speaking": {
              const d = record.payload as unknown as CouncilAgentSpeakingData;
              setCouncilState((prev) => ({
                ...prev,
                currentRound: d.round,
                statements: [
                  ...prev.statements,
                  {
                    id: `history_${d.agentId}_${d.round}_${d.statementType}_${record.timestamp}`,
                    agentId: d.agentId,
                    agentName: d.agentName,
                    round: d.round,
                    type: d.statementType,
                    content: d.content,
                    keyPoints: d.keyPoints || [],
                    timestamp: record.timestamp,
                  },
                ],
              }));
              break;
            }
            case "council:end":
              setCouncilState((prev) => ({
                ...prev,
                endData: record.payload as unknown as CouncilEndData,
              }));
              break;
          }
        }

        // Agent 历史回放
        if (eventType.startsWith("agent:")) {
          const agentId = (data.agentId as string) || "unknown";
          const agentName = (data.agentName as string) || agentId;
          switch (eventType) {
            case "agent:thinking:start":
              setAgentStates((prev) => ({
                ...prev,
                [agentId]: { agentId, agentName, status: "thinking" },
              }));
              break;
            case "agent:thinking:end":
              setAgentStates((prev) => ({
                ...prev,
                [agentId]: {
                  ...prev[agentId],
                  status: "completed",
                  output: data.content as string,
                  durationMs: data.durationMs as number,
                },
              }));
              break;
          }
        }
      }
    } catch (err) {
      // 静默处理历史加载失败（不影响实时流）
      logger.warn("编排历史加载失败", err);
    } finally {
      setHistoryLoading(false);
    }
  }, [workspaceId, workItemId, addEntry]);

  // ── 自动滚动 ──

  const scrollToBottom = useCallback(() => {
    if (!autoScroll || !containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [autoScroll]);

  // ── 初始化 ──

  useEffect(() => {
    // 1. 加载历史
    loadHistory();

    // 2. 连接 SSE
    const baseUrl = getBackendBaseUrl();
    const url = `${baseUrl}/v1/workspaces/${workspaceId}/items/${workItemId}/orchestration/stream`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener("connected", () => {
      setConnected(true);
      setError(null);
    });

    // 处理所有编排事件
    const eventTypes = [
      "council:start",
      "council:round:start",
      "council:agent:speaking",
      "council:agent:delta",
      "council:round",
      "council:end",
      "council:detail",
      "dag:start",
      "dag:task:start",
      "dag:task:progress",
      "dag:task:end",
      "dag:end",
      "plan:start",
      "plan:step:start",
      "plan:step:completed",
      "plan:progress",
      "plan:completed",
      "chain:start",
      "chain:step",
      "chain:end",
      "swarm:dispatch",
      "swarm:agent:status",
      "swarm:complete",
      "agent:thinking:start",
      "agent:thinking:delta",
      "agent:thinking:end",
      "agent:tool_call:start",
      "agent:tool_call:delta",
      "agent:tool_call:end",
    ];

    for (const et of eventTypes) {
      es.addEventListener(et, (e: Event) => {
        const msg = e as MessageEvent;
        try {
          const data = JSON.parse(msg.data) as SSETimelineEvent;
          handleSSEEvent(et, data);
        } catch {
          // 跳过无法解析的事件
        }
      });
    }

    es.addEventListener("snapshot", () => {
      // 快照事件由历史回放处理，SSE 流中的快照主要用于初始状态同步
    });

    es.addEventListener("heartbeat", () => {
      // 心跳
    });

    es.addEventListener("connected", () => {
      setConnected(true);
      setError(null);
    });

    es.onerror = () => {
      setConnected(false);
      setError("连接中断，正在重连...");
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [workspaceId, workItemId, loadHistory, handleSSEEvent]);

  // 新条目到达时自动滚动
  useEffect(() => {
    scrollToBottom();
  }, [entries, scrollToBottom]);

  // ── 按模块分组 ──

  const groups = useCallback(() => {
    const map = new Map<TimelineGroup["module"], TimelineEntry[]>();
    for (const entry of entries) {
      const mod = extractModule(entry.type);
      const list = map.get(mod) || [];
      list.push(entry);
      map.set(mod, list);
    }
    return Array.from(map.entries()).map(([mod, modEntries]) => ({
      ...MODULE_CONFIG[mod],
      module: mod,
      entries: modEntries,
    }));
  }, [entries]);

  const timelineGroups = groups();

  return (
    <div
      className={`rounded-lg border ${isDark ? "border-gray-700" : "border-gray-200"}`}
    >
      {/* 头部 */}
      <div
        className={`flex items-center justify-between p-3 border-b ${
          isDark ? "border-gray-700 bg-gray-800" : "border-gray-200 bg-gray-50"
        }`}
      >
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">编排时间线</h3>
          <span
            className={`w-2 h-2 rounded-full ${
              connected ? "bg-green-500" : "bg-red-500"
            }`}
            title={connected ? "已连接" : "已断开"}
          />
        </div>
        <div className="flex items-center gap-3">
          {historyLoading && (
            <span className="text-xs text-gray-500">加载历史中...</span>
          )}
          <span className="text-xs text-gray-500">{entries.length} 个事件</span>
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`text-xs px-2 py-0.5 rounded ${
              autoScroll
                ? isDark
                  ? "bg-blue-900 text-blue-300"
                  : "bg-blue-100 text-blue-700"
                : isDark
                  ? "bg-gray-700 text-gray-400"
                  : "bg-gray-200 text-gray-500"
            }`}
          >
            {autoScroll ? "自动滚动" : "手动"}
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div
        ref={containerRef}
        className="overflow-y-auto"
        style={{ maxHeight: "600px" }}
        onScroll={() => {
          if (!containerRef.current) return;
          const { scrollTop, scrollHeight, clientHeight } =
            containerRef.current;
          setAutoScroll(
            scrollHeight - scrollTop - clientHeight < AUTO_SCROLL_THRESHOLD,
          );
        }}
      >
        {/* Agent 进度面板 */}
        {Object.keys(agentStates).length > 0 && (
          <div
            className={`p-3 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
          >
            <div className="text-xs text-gray-500 mb-2 font-medium">
              Agent 进度
            </div>
            <div className="space-y-2">
              {Object.values(agentStates).map((as) => (
                <AgentProgressBlock
                  key={as.agentId}
                  agentId={as.agentId}
                  agentName={as.agentName}
                  status={as.status}
                  thinkingContent={as.thinkingContent}
                  delta={as.delta}
                  currentToolCall={as.currentToolCall}
                  output={as.output}
                  durationMs={as.durationMs}
                  isDark={isDark}
                />
              ))}
            </div>
          </div>
        )}

        {/* Council 面板 */}
        {councilState.startData && (
          <div
            className={`p-3 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}
          >
            <CouncilPanel
              startData={councilState.startData}
              currentRound={councilState.currentRound}
              maxRounds={councilState.maxRounds}
              statements={councilState.statements}
              speakingAgentId={councilState.speakingAgentId}
              streamingDeltas={councilState.streamingDeltas}
              endData={councilState.endData}
              isDark={isDark}
            />
          </div>
        )}

        {/* 时间线列表 */}
        {timelineGroups.length > 0 ? (
          <div className="p-3 space-y-4">
            {timelineGroups.map((group) => (
              <div key={group.module}>
                {/* 模块标题 */}
                <div className="flex items-center gap-1 mb-2">
                  <span className="text-sm">{group.icon}</span>
                  <span className="text-xs font-medium text-gray-500">
                    {group.title}
                  </span>
                  <span className="text-xs text-gray-400">
                    ({group.entries.length})
                  </span>
                </div>

                {/* 时间线条目 */}
                <div className="space-y-1">
                  {group.entries.map((entry, i) => (
                    <div
                      key={entry.id}
                      className={`flex items-start gap-2 text-xs p-1.5 rounded ${
                        isDark ? "hover:bg-gray-800" : "hover:bg-gray-50"
                      }`}
                    >
                      {/* 时间线圆点 */}
                      <div className="flex flex-col items-center mt-1">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            entry.event.source === "history"
                              ? "bg-gray-400"
                              : "bg-blue-500"
                          }`}
                        />
                        {i < group.entries.length - 1 && (
                          <div
                            className={`w-0.5 h-4 ${isDark ? "bg-gray-700" : "bg-gray-200"}`}
                          />
                        )}
                      </div>

                      {/* 内容 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-800 dark:text-gray-200 truncate">
                            {entry.summary}
                          </span>
                          <span className="text-gray-400 shrink-0">
                            {entry.time.toLocaleTimeString()}
                          </span>
                          {entry.event.source === "history" && (
                            <span className="text-gray-400 shrink-0">
                              [历史]
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          !historyLoading && (
            <div
              className={`p-6 text-center text-sm ${
                isDark ? "text-gray-500" : "text-gray-400"
              }`}
            >
              {connected ? "等待编排事件..." : "正在连接..."}
            </div>
          )
        )}

        {error && (
          <div className="m-3 p-2 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded">
            {error}
          </div>
        )}
      </div>

      {/* 回到底部按钮 */}
      {!autoScroll && entries.length > 0 && (
        <div
          className={`p-2 text-center border-t ${
            isDark ? "border-gray-700" : "border-gray-200"
          }`}
        >
          <button
            onClick={() => {
              setAutoScroll(true);
              scrollToBottom();
            }}
            className="text-xs text-blue-500 hover:text-blue-600"
          >
            ↓ 回到最新
          </button>
        </div>
      )}
    </div>
  );
}

export default OrchestrationTimeline;
export type { TimelineEntry, TimelineGroup, OrchestrationTimelineProps };
