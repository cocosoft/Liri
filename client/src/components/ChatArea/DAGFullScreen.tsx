import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import type { TaskCardTask } from "../../types";

interface DAGFullScreenProps {
  tasks: TaskCardTask[];
  title?: string;
  onClose: () => void;
}

const STATUS_COLORS: Record<
  TaskCardTask["status"],
  { bg: string; border: string; text: string }
> = {
  pending: { bg: "#f3f4f6", border: "#d1d5db", text: "#6b7280" },
  in_progress: { bg: "#dbeafe", border: "#60a5fa", text: "#2563eb" },
  completed: { bg: "#dcfce7", border: "#22c55e", text: "#16a34a" },
  failed: { bg: "#fee2e2", border: "#ef4444", text: "#dc2626" },
  // S3 修复：cancelled 独立终态色（橙色"已取消"）
  cancelled: { bg: "#ffedd5", border: "#f97316", text: "#ea580c" },
  blocked: { bg: "#fff7ed", border: "#f97316", text: "#ea580c" },
  skipped: { bg: "#f9fafb", border: "#9ca3af", text: "#6b7280" },
};

function layoutNodes(tasks: TaskCardTask[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    nodesep: 40,
    ranksep: 60,
    marginx: 20,
    marginy: 20,
  });

  const nodeWidth = 200;
  const nodeHeight = 60;

  for (const task of tasks) {
    g.setNode(task.id, { width: nodeWidth, height: nodeHeight });
  }
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      g.setEdge(dep, task.id);
    }
  }

  dagre.layout(g);

  const nodes: Node[] = tasks.map((task) => {
    const pos = g.node(task.id);
    const colors = STATUS_COLORS[task.status] || STATUS_COLORS.pending;
    const icon =
      task.status === "completed"
        ? "✓"
        : task.status === "in_progress"
          ? "⟳"
          : task.status === "failed"
            ? "✗"
            : task.status === "blocked"
              ? "⏸"
              : "";
    const label = task.result
      ? `${icon} ${task.id}. ${task.name}\n${task.durationMs ? `${(task.durationMs / 1000).toFixed(1)}s` : ""} → ${task.result}`
      : `${icon} ${task.id}. ${task.name}`;

    return {
      id: task.id,
      position: { x: pos.x - nodeWidth / 2, y: pos.y - nodeHeight / 2 },
      style: {
        width: nodeWidth,
        height: nodeHeight,
        background: colors.bg,
        border: `2px solid ${colors.border}`,
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "6px 10px",
        fontSize: 13,
        color: colors.text,
        fontWeight: 500,
        whiteSpace: "pre-wrap",
        textAlign: "center",
      },
      data: { label },
    };
  });

  const edges: Edge[] = [];
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      edges.push({
        id: `${dep}->${task.id}`,
        source: dep,
        target: task.id,
        style: {
          stroke: task.status === "failed" ? "#ef4444" : "#94a3b8",
          strokeWidth: 2,
        },
        animated: task.status === "in_progress",
      });
    }
  }

  return { nodes, edges };
}

export default function DAGFullScreen({
  tasks,
  title,
  onClose,
}: DAGFullScreenProps) {
  const { nodes, edges } = useMemo(() => layoutNodes(tasks), [tasks]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-[90vw] h-[85vh] flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <span className="text-lg">📊</span>
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              {title ? `依赖关系图：${title}` : "任务依赖关系图"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mr-2">
              <span>
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-100 border border-green-500 mr-1" />
                已完成
              </span>
              <span>
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-100 border border-blue-500 mr-1" />
                执行中
              </span>
              <span>
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-100 border border-orange-500 mr-1" />
                等待
              </span>
              <span>
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-100 border border-red-500 mr-1" />
                失败
              </span>
            </div>
            <button
              onClick={onClose}
              className="text-sm px-3 py-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg text-gray-700 dark:text-gray-300 transition-colors"
            >
              关闭
            </button>
          </div>
        </div>

        {/* DAG 图 */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            attributionPosition="bottom-right"
          >
            <Background gap={20} color="#e2e8f0" />
            <Controls />
            <MiniMap nodeStrokeWidth={3} pannable zoomable />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}
