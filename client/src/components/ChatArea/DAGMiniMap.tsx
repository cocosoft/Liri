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

interface DAGMiniMapProps {
  tasks: TaskCardTask[];
  height?: number;
  onExpand?: () => void;
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

/** 用 Dagre 布局算法计算节点位置 */
function layoutNodes(tasks: TaskCardTask[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    nodesep: 20,
    ranksep: 40,
    marginx: 10,
    marginy: 10,
  });

  const nodeWidth = 160;
  const nodeHeight = 48;

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

    return {
      id: task.id,
      position: { x: pos.x - nodeWidth / 2, y: pos.y - nodeHeight / 2 },
      style: {
        width: nodeWidth,
        height: nodeHeight,
        background: colors.bg,
        border: `2px solid ${colors.border}`,
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "4px 8px",
        fontSize: 12,
        color: colors.text,
        fontWeight: 500,
      },
      data: { label: `${icon} ${task.id}. ${task.name}` },
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
          strokeWidth: 1.5,
        },
      });
    }
  }

  return { nodes, edges };
}

export default function DAGMiniMap({
  tasks,
  height = 160,
  onExpand,
}: DAGMiniMapProps) {
  const { nodes, edges } = useMemo(() => layoutNodes(tasks), [tasks]);

  return (
    <div
      className="relative border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
      style={{ height }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        attributionPosition="bottom-left"
      >
        <Background gap={16} color="#e5e7eb" />
        <Controls showInteractive={false} />
        <MiniMap nodeStrokeWidth={2} pannable zoomable />
      </ReactFlow>
      {onExpand && (
        <button
          onClick={onExpand}
          className="absolute top-2 right-2 z-10 text-xs px-2 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
        >
          📊 全屏查看
        </button>
      )}
    </div>
  );
}
