/**
 * Agent 运行态面板（T8）—— 自 `CouncilAgentRolesPage` 抽离。
 *
 * **为什么抽离**：该页在 T8 加入本面板后由 **624 行增至 906 行**，突破
 * `lint:size` 的 **800 行阈值（阻塞合并，R04-001）**。本面板与角色 CRUD
 * **零耦合** —— 只读 `/v1/agents/control` + `/v1/agents/runs` 两个端点、
 * 无写操作、无 i18n 调用（原实现即硬编码中文），是天然的分割线。
 *
 * **数据源互补**：`control` 回答"此刻谁在跑"（内存活跃投影）；
 * `runs` 回答"刚跑完的结果与来源"（磁盘台账，含 O19 落盘的 `descriptorSource`）。
 */

import { useState, useEffect, useCallback } from "react";
import { httpLegacy as http } from "../../../services/httpClient";

interface ActiveAgentItem {
  id: string;
  name: string;
  type: string;
  status: string;
  startTime: number;
}

interface AgentControlInfo {
  spawn: { paused: boolean; reason?: string | null; changedAt?: number | null };
  agents: ActiveAgentItem[];
}

interface AgentRunItem {
  toolCallId: string;
  agentId: string;
  name: string;
  agentType: string;
  status: string;
  /** 描述符来源（O19 落盘）：role-store / registry / builtin / default；未指定类型时为空 */
  descriptorSource: string | null;
  batchId: string | null;
  taskKey: string | null;
  startedAt: number | null;
  endedAt: number | null;
  error: string | null;
  /**
   * 失败归因（接线期③ ③-A 落盘）：**仅未完成 run** 且有可归因对象时存在。
   * 前端只消费 `failedNodeId` 与 `candidates`（`graph` 快照是审计用，不在面板渲染）。
   */
  attribution: AgentRunAttribution | null;
}

/** 归因载荷（与后端 `AgentRunAttribution` 的只读子集对齐） */
interface AgentRunAttribution {
  /** 归因起点（图中节点 id，如 `step:tu_1` / `run:...`） */
  failedNodeId: string;
  /** 根因候选（按因果强度降序） */
  candidates: Array<{
    nodeId: string;
    kind: string;
    distance: number;
    score: number;
    pathEvidenceRefs: string[];
  }>;
}

/** 来源 → 中文标签（与解析链的四级回退同源） */
const DESCRIPTOR_SOURCE_LABELS: Record<string, string> = {
  "role-store": "Agent 配置",
  registry: "运行时注册",
  builtin: "内置",
  default: "默认",
};

/** 运行状态 → 图标（`unknown` = 陈旧自愈：无法证明结果，故用问号） */
function statusIcon(status: string): string {
  switch (status) {
    case "running":
      return "🔄";
    case "cancel_requested":
      return "🕓";
    case "completed":
      return "✅";
    case "unknown":
      return "❔";
    case "failed":
      return "❌";
    default:
      return "•";
  }
}

/** 时间戳 → 本地时间（缺省显示占位符） */
function formatTime(ts: number | null): string {
  return ts ? new Date(ts).toLocaleTimeString() : "—";
}

/**
 * 归因行文案（接线期③ ③-A）：候选按因果强度降序列出 `nodeId(score)`。
 *
 * 无候选 ⇒ 显式写"无上游候选"（失败点没有已声明的上游），**不编造**结论（CS06）。
 */
function formatAttribution(attribution: AgentRunAttribution): string {
  const list =
    attribution.candidates.length === 0
      ? "无上游候选"
      : attribution.candidates
          .map((c) => `${c.nodeId}(${c.score.toFixed(2)})`)
          .join(" → ");
  return `归因（起点 ${attribution.failedNodeId}）：${list}`;
}

/** 归因行悬浮明细：逐候选给出距离与证据引用，便于独立复核 */
function attributionTooltip(attribution: AgentRunAttribution): string {
  if (attribution.candidates.length === 0) {
    return "失败点没有已声明的上游（无可归因对象）";
  }
  return attribution.candidates
    .map(
      (c) =>
        `${c.nodeId}（${c.kind}，距失败点 ${c.distance}，证据 ${c.pathEvidenceRefs.join("、") || "—"}）`,
    )
    .join("\n");
}

interface AgentRuntimePanelProps {
  /** 主题（由父组件传入，避免在本组件重复订阅 configStore） */
  isDark: boolean;
}

export function AgentRuntimePanel({ isDark }: AgentRuntimePanelProps) {
  const [control, setControl] = useState<AgentControlInfo | null>(null);
  const [runs, setRuns] = useState<AgentRunItem[]>([]);
  const [runtimeLoading, setRuntimeLoading] = useState(false);

  /**
   * 加载运行态（活跃投影）+ 最近运行台账（含"来源"列）。
   *
   * 两个数据源互补：`control` 回答"此刻谁在跑"（内存），`runs` 回答"刚跑完的结果与来源"（磁盘）。
   */
  const loadRuntime = useCallback(async () => {
    setRuntimeLoading(true);
    try {
      const [controlInfo, runsInfo] = await Promise.all([
        http.get<AgentControlInfo>("/v1/agents/control"),
        http.get<{ total: number; runs: AgentRunItem[] }>(
          "/v1/agents/runs?limit=20",
        ),
      ]);
      setControl(controlInfo);
      setRuns(runsInfo?.runs ?? []);
    } catch {
      // 运行态查询失败不覆盖角色列表的错误态：置空即可（面板显示"暂无"）
      setControl(null);
      setRuns([]);
    } finally {
      setRuntimeLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRuntime();
  }, [loadRuntime]);

  /**
   * N-70（2026-09-25）：面板打开期间**自动刷新**运行态。
   *
   * 后端已把 `subagent_status`（子代理心跳，由 `SubAgentEventPump` 发布）接入编排 SSE 流；
   * 本面板用**轮询**消费（复用既有 HTTP 拉取 — 不为此新建前端 SSE 客户端，因为该通道
   * 此前在前端整体未被消费，单独接一条连接成本高于收益）。有活跃子代理时 5s 一次，
   * 无活跃时 15s（省请求）。
   */
  useEffect(() => {
    const hasActive = (control?.agents?.length ?? 0) > 0;
    const intervalMs = hasActive ? 5000 : 15000;
    const timer = setInterval(() => {
      void loadRuntime();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [loadRuntime, control?.agents?.length]);

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h3
          className={`text-sm font-semibold ${isDark ? "text-gray-300" : "text-gray-700"}`}
        >
          运行态{control?.spawn.paused ? "（已暂停新委派）" : ""}
        </h3>
        <button
          onClick={loadRuntime}
          disabled={runtimeLoading}
          className={`px-2 py-1 text-xs rounded transition-colors disabled:opacity-50 ${
            isDark
              ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          {runtimeLoading ? "刷新中..." : "刷新"}
        </button>
      </div>

      {/* 活跃代理（内存投影；`/v1/agents/control`） */}
      <div
        className={`text-xs mb-3 ${isDark ? "text-gray-400" : "text-gray-500"}`}
      >
        活跃: {control?.agents.length ?? 0}
        {control && control.agents.length > 0 && (
          <span className="ml-2">
            {control.agents
              .map((a) => `${statusIcon(a.status)} ${a.type}`)
              .join("  ")}
          </span>
        )}
      </div>

      {/* 最近运行（磁盘台账；`/v1/agents/runs`） */}
      {runs.length === 0 ? (
        <div
          className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
        >
          暂无运行记录。
        </div>
      ) : (
        <div
          className={`rounded border divide-y ${
            isDark
              ? "border-gray-700 divide-gray-700"
              : "border-gray-200 divide-gray-100"
          }`}
        >
          {runs.map((run) => (
            <div key={run.toolCallId} className="px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span>{statusIcon(run.status)}</span>
                  <span
                    className={`font-medium ${isDark ? "text-gray-200" : "text-gray-700"}`}
                  >
                    {run.agentType}
                  </span>
                  <span
                    className={`truncate ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    {run.name}
                  </span>
                  {run.batchId && (
                    <span
                      className={`px-1.5 py-0.5 rounded ${
                        isDark
                          ? "bg-gray-700 text-gray-400"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      批次任务 {run.taskKey ?? "-"}
                    </span>
                  )}
                </div>
                <div
                  className={`flex items-center gap-3 flex-shrink-0 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  <span title="描述符来源：Agent 配置 / 运行时注册 / 内置 / 默认">
                    {run.descriptorSource
                      ? (DESCRIPTOR_SOURCE_LABELS[run.descriptorSource] ??
                        run.descriptorSource)
                      : "—"}
                  </span>
                  <span>{formatTime(run.startedAt)}</span>
                </div>
              </div>
              {/* 失败归因（接线期③ ③-A）：仅未完成 run 且可归因时出现 */}
              {run.attribution && (
                <div
                  className={`mt-1 truncate ${isDark ? "text-amber-300" : "text-amber-700"}`}
                  title={attributionTooltip(run.attribution)}
                >
                  {formatAttribution(run.attribution)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
