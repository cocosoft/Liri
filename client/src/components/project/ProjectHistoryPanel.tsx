/**
 * 项目讨论记录面板 — 右侧「讨论记录」区
 *
 * 两级展开：
 *   L1: 按 session 分组折叠，显示摘要 + 条目数 + 日期
 *   L2: 展开 session 后逐条显示（内部轨迹 internal=true 需二次展开）
 */

import React, { useState, useEffect } from "react";
import {
  MessageCircle,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  fetchProjectHistory,
  type HistoryGroup,
  type HistoryEntry,
} from "@/services/projectArtifactService";
import {
  fetchSummaries,
  type ProjectSummary,
} from "@/services/projectArtifactService";

interface Props {
  projectId: string;
  refreshKey?: number;
}

const TYPE_CONFIG: Record<string, { icon: string; label: string }> = {
  message: { icon: "💬", label: "消息" },
  decision: { icon: "✅", label: "决策" },
  tool_call: { icon: "🔧", label: "工具" },
  pdca_phase: { icon: "🔄", label: "PDCA" },
  context_change: { icon: "📋", label: "资料" },
};

export const ProjectHistoryPanel: React.FC<Props> = ({
  projectId,
  refreshKey,
}) => {
  const [groups, setGroups] = useState<HistoryGroup[]>([]);
  const [summaries, setSummaries] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(
    new Set(),
  );
  const [showInternal, setShowInternal] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    Promise.all([
      fetchProjectHistory(projectId).catch(() => [] as HistoryGroup[]),
      fetchSummaries(projectId).catch(() => [] as ProjectSummary[]),
    ])
      .then(([h, s]) => {
        setGroups(h);
        setSummaries(s);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId, refreshKey]);

  const decisions = summaries.filter((s) => s.decision).slice(-3);
  const phaseSummaries = summaries.filter((s) => s.phaseSummary).slice(-2);
  const sessionSummaries = summaries.filter((s) => !s.phaseSummary).slice(-5);

  const toggleSession = (sessionId: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const toggleInternal = (sessionId: string) => {
    setShowInternal((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="p-4 text-sm text-gray-400 text-center animate-pulse">
        加载中...
      </div>
    );
  }

  if (groups.length === 0 && summaries.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-400 text-center">
        暂无讨论记录。
        <br />
        <span className="text-xs">对话开始后自动生成</span>
      </div>
    );
  }

  const renderEntry = (entry: HistoryEntry, _sessionId: string) => {
    const cfg = TYPE_CONFIG[entry.type] || { icon: "📝", label: entry.type };
    const isInternal = entry.internal;
    const showInternalEntries = showInternal.has(_sessionId);

    if (isInternal && !showInternalEntries) return null;

    return (
      <div
        key={entry.ts + entry.summary}
        className={`text-xs border-l-2 pl-2 py-0.5 ${
          isInternal
            ? "border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-900/10"
            : "border-gray-200 dark:border-gray-700"
        }`}
      >
        <div className="flex items-center gap-1 text-gray-400">
          <span>{cfg.icon}</span>
          <span>{cfg.label}</span>
          <span className="ml-auto text-[10px]">{entry.ts.slice(11, 16)}</span>
        </div>
        <div className="text-gray-600 dark:text-gray-400 mt-0.5 line-clamp-2">
          {entry.detail || entry.summary}
        </div>
      </div>
    );
  };

  return (
    <div className="p-2 space-y-2">
      {/* AI 沉淀摘要区 */}
      {summaries.length > 0 && (
        <div className="space-y-1.5 mb-3 pb-2 border-b border-gray-100 dark:border-gray-800">
          <div className="text-[10px] text-gray-400 px-1 font-medium uppercase tracking-wide">
            AI 摘要
          </div>

          {decisions.map((d, i) => (
            <div
              key={`d-${i}`}
              className="px-2 py-1 rounded bg-amber-50 dark:bg-amber-900/20 text-[11px] text-amber-800 dark:text-amber-200"
            >
              <span className="font-medium">决策：</span>
              {d.decision}
            </div>
          ))}

          {phaseSummaries.map((ps, i) => (
            <details
              key={`ps-${i}`}
              className="px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/20"
            >
              <summary className="text-[11px] font-medium text-blue-700 dark:text-blue-300 cursor-pointer">
                阶段性小结
              </summary>
              <div className="text-[11px] text-blue-600 dark:text-blue-400 mt-1 whitespace-pre-wrap">
                {ps.summary}
              </div>
            </details>
          ))}

          {sessionSummaries.map((s, i) => (
            <div
              key={`ss-${i}`}
              className="px-2 py-1 rounded bg-gray-50 dark:bg-gray-800/50 text-[11px] text-gray-600 dark:text-gray-400"
            >
              <div className="line-clamp-2">{s.summary}</div>
              <div className="text-gray-400 mt-0.5">
                {new Date(s.createdAt).toLocaleDateString("zh-CN")}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* L1: 按 session 分组 */}
      {groups.map((group) => {
        const isExpanded = expandedSessions.has(group.sessionId);
        const internalCount = group.items.filter((i) => i.internal).length;
        const visibleCount = group.itemCount - internalCount;

        return (
          <div
            key={group.sessionId}
            className="border border-gray-100 dark:border-gray-800 rounded-lg overflow-hidden"
          >
            {/* L1 折叠栏 */}
            <button
              className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              onClick={() => toggleSession(group.sessionId)}
            >
              {isExpanded ? (
                <ChevronDown size={12} className="text-gray-400 shrink-0" />
              ) : (
                <ChevronRight size={12} className="text-gray-400 shrink-0" />
              )}
              <MessageCircle size={12} className="text-gray-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                  {group.summary || `会话 ${group.sessionId.slice(0, 8)}`}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                  <span>{group.dates[0]}</span>
                  <span>{visibleCount} 条</span>
                  {internalCount > 0 && (
                    <span className="text-amber-500">{internalCount} 内部</span>
                  )}
                </div>
              </div>
            </button>

            {/* L2: 展开详情 */}
            {isExpanded && (
              <div className="px-2.5 pb-2 space-y-1">
                {group.items.map((entry) =>
                  renderEntry(entry, group.sessionId),
                )}
                {internalCount > 0 && (
                  <button
                    className="w-full flex items-center gap-1 py-1 text-[10px] text-amber-500 hover:text-amber-600 transition-colors"
                    onClick={() => toggleInternal(group.sessionId)}
                  >
                    {showInternal.has(group.sessionId) ? (
                      <>
                        <EyeOff size={10} /> 隐藏内部轨迹
                      </>
                    ) : (
                      <>
                        <Eye size={10} /> 显示 {internalCount} 条内部轨迹
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
