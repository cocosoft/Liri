/**
 * LogTab — 会话日志面板（Session Log）
 *
 * 右侧面板核心视图：展示 AI 思考过程 / 工具调用 / 系统事件的时间轴流。
 * - 详情默认全展开（日志心智：摊开看），长内容 200px 限高 + 「显示全部」
 * - 事件流虚拟滚动（@tanstack/react-virtual，复用现有依赖）
 * - 失败工具：整行浅红背景 + 结果不截断 + 重试
 * - streaming 稳定：事件 key 稳定，状态切换只更新该行不重排
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useChatStore } from "../../stores/chat";
import { useChatInspectorStore } from "../../stores/chatInspectorStore";
import { useModelSwitchStore } from "../../stores/modelSwitchStore";
import { getToolDisplayName } from "../../utils/toolHumanSummary";
import { getToolResultFull } from "../../stores/chat/chat-message.slice";
import { useSessionStore } from "../../stores/sessionStore";
import { useTrajectoryStore } from "../../stores/chat/trajectoryStore";
import {
  buildLogEventsFromEvents,
  extractError,
  summarizeResult,
  type LogEvent,
} from "../../utils/sessionLog";

// ─── 常量 ─────────────────────────────────────────

/** 详情块统一限高（thinking / 参数 / 结果一视同仁） */
const DETAIL_MAX_HEIGHT = 200;
/** 判定"内容过长需截断"的启发式阈值 */
const LONG_TEXT_CHARS = 600;
const LONG_TEXT_LINES = 12;

type LogView = "all" | "thinking" | "tool" | "system" | "failed";

// ─── 工具函数 ─────────────────────────────────────

function formatTime(ts: number): string {
  if (!ts) return "--:--";
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function isLongText(text: string): boolean {
  return (
    text.length > LONG_TEXT_CHARS ||
    (text.match(/\n/g)?.length ?? 0) > LONG_TEXT_LINES
  );
}

// ─── 子组件：限高正文块 ───────────────────────────

function ClampedBody({
  text,
  label,
  noClamp,
}: {
  text: string;
  label?: string;
  noClamp?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const long = isLongText(text);
  const clamped = !noClamp && !showAll;

  return (
    <div className="mt-1">
      <div
        className={`relative overflow-hidden rounded bg-gray-50 dark:bg-gray-800 ${
          clamped ? "max-h-[200px]" : ""
        }`}
        style={clamped ? { maxHeight: DETAIL_MAX_HEIGHT } : undefined}
      >
        <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-all text-gray-600 dark:text-gray-300 p-1.5">
          {text}
        </pre>
        {clamped && long && (
          <div className="absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-gray-50 dark:from-gray-800 to-transparent pointer-events-none" />
        )}
      </div>
      {!noClamp && long && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="text-[10px] text-blue-500 mt-0.5 hover:underline"
        >
          {showAll ? "收起 ▲" : "显示全部 ▼"}
        </button>
      )}
      {label && (
        <span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">
          {label}
        </span>
      )}
    </div>
  );
}

// ─── 子组件：单条事件 ─────────────────────────────

function ToolRowImpl({
  event,
  isStreaming,
}: {
  event: LogEvent;
  isStreaming: boolean;
}) {
  const record = event.record!;
  const displayName = getToolDisplayName(record.name);
  const hasArgs = record.arguments && Object.keys(record.arguments).length > 0;
  const hasResult = record.result !== undefined && record.result !== null;
  const isFailed = record.status === "failed";
  // 全链路修复①（2026-08-23）：提问工具（ask_user_question）无 result 是"等待回答"
  // 语义（协议契约，非执行中）——不显示"进行中"，避免误导为挂起的运行任务
  const isWaitingAnswer =
    record.name === "ask_user_question" && record.status === "running";
  // 全链路修复②（2026-08-23）：无 result 的工具调用是"已中断"（非"进行中"）——
  // canceled 事件终态（B-3）或历史回放中无完成事件（running 且非流式）
  const isInterrupted =
    record.status === "canceled" ||
    (record.status === "running" && !isWaitingAnswer && !isStreaming);
  const errorText = extractError(record);
  const icon = isWaitingAnswer
    ? "🗣"
    : isInterrupted
      ? "⏸"
      : record.status === "running"
        ? "🔄"
        : isFailed
          ? "❌"
          : "✅";

  const handleCopy = useCallback(() => {
    let text: string;
    if (record._hasFullResult) {
      const full = getToolResultFull(record.id);
      text = typeof full === "string" ? full : JSON.stringify(full, null, 2);
    } else {
      text =
        typeof record.result === "string"
          ? record.result
          : JSON.stringify(record.result, null, 2);
    }
    navigator.clipboard.writeText(text).catch(() => {});
  }, [record]);

  return (
    <div
      className={`py-1.5 px-3 ${
        isFailed ? "bg-red-50 dark:bg-red-950/30" : ""
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-gray-400 dark:text-gray-500 font-mono text-[10px] shrink-0">
          {formatTime(event.time)}
        </span>
        <span className="shrink-0">{icon}</span>
        <span className="font-medium text-gray-700 dark:text-gray-300 break-all">
          {displayName}
        </span>
        {record.status === "running" && !isWaitingAnswer && !isInterrupted && (
          <span className="ml-auto text-blue-500 animate-pulse shrink-0 text-[10px]">
            进行中
          </span>
        )}
        {isWaitingAnswer && (
          <span className="ml-auto text-amber-500 shrink-0 text-[10px]">
            等待回答
          </span>
        )}
        {isInterrupted && (
          <span className="ml-auto text-gray-500 shrink-0 text-[10px]">
            已中断
          </span>
        )}
      </div>
      {event.title && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {event.title}
        </p>
      )}
      {hasArgs && (
        <ClampedBody
          label="参数"
          text={JSON.stringify(record.arguments, null, 2)}
        />
      )}
      {record.status === "completed" && hasResult && (
        <ClampedBody
          label="结果"
          text={summarizeResult(record.result)}
          noClamp={isFailed}
        />
      )}
      {record.status === "completed" && !hasResult && (
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
          该工具已执行完成（无文本结果）
        </p>
      )}
      {errorText && (
        <div className="mt-1 text-red-500 dark:text-red-400 text-xs whitespace-pre-wrap break-all">
          {errorText}
        </div>
      )}
      <div className="flex gap-1 mt-1">
        {record.status === "completed" && hasResult && (
          <button
            onClick={handleCopy}
            className="px-1.5 py-0.5 rounded text-[10px] text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            title="复制结果"
          >
            复制
          </button>
        )}
        {isFailed && (
          <button
            className="px-1.5 py-0.5 rounded text-[10px] text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
            title="重试该工具调用"
          >
            重试
          </button>
        )}
      </div>
    </div>
  );
}
const ToolRow = React.memo(ToolRowImpl);

function LogRowImpl({
  event,
  isStreaming,
}: {
  event: LogEvent;
  isStreaming: boolean;
}) {
  if (event.kind === "tool" && event.record) {
    return <ToolRow event={event} isStreaming={isStreaming} />;
  }
  const isSystem = event.kind === "system";
  return (
    <div className="py-1.5 px-3">
      <div className="flex items-start gap-1.5 text-xs">
        <span className="text-gray-400 dark:text-gray-500 font-mono text-[10px] mt-0.5 shrink-0">
          {formatTime(event.time)}
        </span>
        <span className="shrink-0">{isSystem ? "⚠️" : "💭"}</span>
        <span className="font-medium text-gray-700 dark:text-gray-300 break-all">
          {event.title}
        </span>
      </div>
      {event.content && <ClampedBody text={event.content} />}
    </div>
  );
}
const LogRow = React.memo(LogRowImpl);

// ─── 主组件 ───────────────────────────────────────

function LogTab() {
  const isStreaming = useChatStore((s) => s.isStreaming);
  const setActiveToolCount = useChatInspectorStore((s) => s.setActiveToolCount);
  const currentModelName = useModelSwitchStore((s) => s.currentModelName);
  // R-3（2026-08-23）：LogTab 改从事件流构建日志（事件 seq 精确序 + 流式实时），
  // 不再从 messages 投影重建（buildLogEvents）——与轨迹 Tab 共用 trajectoryStore 事件源
  const currentSessionId = useSessionStore((s) => s.currentSession?.id);
  const trajEvents = useTrajectoryStore((s) => s.events);
  const trajLoading = useTrajectoryStore((s) => s.loading);
  const trajError = useTrajectoryStore((s) => s.error);
  const loadEvents = useTrajectoryStore((s) => s.loadEvents);

  useEffect(() => {
    if (currentSessionId) void loadEvents(currentSessionId);
  }, [currentSessionId, loadEvents]);

  const events = useMemo(
    () => buildLogEventsFromEvents(trajEvents),
    [trajEvents],
  );

  const [view, setView] = useState<LogView>("all");

  // 收起态角标：进行中工具数（历史回放无"进行中"——无 result 的工具已归为"已中断"）
  const runningCount = useMemo(
    () =>
      isStreaming ? events.filter((e) => e.status === "running").length : 0,
    [events, isStreaming],
  );
  useEffect(() => {
    setActiveToolCount(runningCount);
  }, [runningCount, setActiveToolCount]);

  // 状态概览计数：仅统计工具事件（思考/系统事件无进行中/完成/失败语义）
  const completedCount = useMemo(
    () =>
      events.filter((e) => e.kind === "tool" && e.status === "completed")
        .length,
    [events],
  );

  const filtered = useMemo(() => {
    switch (view) {
      case "thinking":
        return events.filter((e) => e.kind === "thinking");
      case "tool":
        return events.filter((e) => e.kind === "tool");
      case "system":
        return events.filter((e) => e.kind === "system");
      case "failed":
        return events.filter((e) => e.status === "failed");
      default:
        return events;
    }
  }, [events, view]);

  const countOf = useCallback(
    (kind: LogView) =>
      kind === "failed"
        ? events.filter((e) => e.status === "failed").length
        : kind === "all"
          ? events.length
          : events.filter((e) => e.kind === kind).length,
    [events],
  );

  // 模型切换合成事件（前端监听，不等后端）
  const prevModelRef = useRef<string | null>(null);
  const [lastModelSwitch, setLastModelSwitch] = useState<{
    time: number;
    from: string;
    to: string;
  } | null>(null);
  useEffect(() => {
    const prev = prevModelRef.current;
    if (prev !== null && currentModelName && currentModelName !== prev) {
      setLastModelSwitch({
        time: Date.now(),
        from: prev,
        to: currentModelName,
      });
    }
    if (currentModelName) prevModelRef.current = currentModelName;
  }, [currentModelName]);

  // 虚拟滚动
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 8,
    getItemKey: (index) => filtered[index]?.key ?? index,
  });

  const FILTERS: { id: LogView; label: string }[] = [
    { id: "all", label: "全部" },
    { id: "tool", label: "工具" },
    { id: "thinking", label: "思考" },
    { id: "system", label: "系统" },
  ];
  const failedCount = countOf("failed");

  return (
    <div className="flex flex-col h-full">
      {/* 面板说明 */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
          会话日志
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
          展示 AI 的思考过程、工具调用与系统事件，是 AI
          背后做了什么的时间轴记录。
        </p>
      </div>

      {/* 状态概览 + 失败告警条 */}
      <div className="px-3 pb-1 shrink-0">
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            进行中 {runningCount}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            完成 {completedCount}
          </span>
        </div>
        {failedCount > 0 && (
          <button
            onClick={() => setView(view === "failed" ? "all" : "failed")}
            className={`mt-1.5 w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-red-600 dark:text-red-400 border transition-colors ${
              view === "failed"
                ? "bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700"
                : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40"
            }`}
          >
            <span>✗</span>
            <span>{failedCount} 个工具失败，点击查看</span>
          </button>
        )}
      </div>

      {/* 过滤标签 */}
      <div className="px-3 py-1.5 flex items-center gap-1 shrink-0">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setView(f.id)}
            className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
              view === f.id
                ? "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300"
                : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            }`}
          >
            {f.label} {countOf(f.id)}
          </button>
        ))}
      </div>

      {/* 模型切换合成事件 */}
      {lastModelSwitch && (
        <div className="mx-3 mb-1 px-2 py-1 rounded text-[11px] bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 shrink-0">
          ⚙️ 模型已切换：{lastModelSwitch.from} → {lastModelSwitch.to}
        </div>
      )}

      {/* 事件流（虚拟滚动） */}
      <div ref={parentRef} className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            {events.length === 0 ? (
              trajLoading ? (
                <p className="text-xs mt-1">正在加载会话日志...</p>
              ) : trajError ? (
                <p className="text-xs mt-1">加载失败：{trajError}</p>
              ) : (
                <>
                  <p>暂无会话日志</p>
                  <p className="text-xs mt-1">
                    {isStreaming
                      ? "AI 正在生成回复..."
                      : "AI 思考、工具调用与系统事件会实时出现在这里"}
                  </p>
                </>
              )
            ) : (
              <p>当前筛选下没有事件</p>
            )}
          </div>
        ) : (
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vi) => (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <LogRow event={filtered[vi.index]} isStreaming={isStreaming} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(LogTab);
