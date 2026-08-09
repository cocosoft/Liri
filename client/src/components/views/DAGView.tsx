/**
 * DAGView — DAG 依赖图可视化组件
 *
 * P2（08-09）：纯 SVG/CSS 实现，不依赖 @xyflow/react。
 * 使用 Kahn 拓扑排序 → 分层布局 → SVG 贝塞尔连线。
 *
 * 节点状态色：
 *   pending=灰 / running=蓝+脉冲 / completed=绿 / failed=红 / blocked=橙
 */

import { useEffect, useState, useMemo } from "react";
import { planService } from "../../services/planService";
import { createLogger } from "../../utils/logger";
import { handleClientError } from "../../utils/handleError";
import type { DAGData, DAGNode } from "../../services/planService";

const logger = createLogger("DAGView");

// ─── 常量 ──────────────────────────────────────────

const NODE_W = 140;
const NODE_H = 40;
const LAYER_GAP_X = 200;
const NODE_GAP_Y = 56;
const PADDING = 16;

// ─── 状态样式映射 ──────────────────────────────────

const STATUS_STYLE: Record<
  string,
  { bg: string; border: string; text: string; icon: string; pulse: boolean }
> = {
  pending: {
    bg: "bg-white dark:bg-gray-800",
    border: "border-gray-300 dark:border-gray-600",
    text: "text-gray-600 dark:text-gray-400",
    icon: "○",
    pulse: false,
  },
  running: {
    bg: "bg-blue-50 dark:bg-blue-900/30",
    border: "border-blue-500",
    text: "text-blue-700 dark:text-blue-300",
    icon: "◌",
    pulse: true,
  },
  completed: {
    bg: "bg-green-50 dark:bg-green-900/30",
    border: "border-green-500",
    text: "text-green-700 dark:text-green-300",
    icon: "✓",
    pulse: false,
  },
  failed: {
    bg: "bg-red-50 dark:bg-red-900/30",
    border: "border-red-500",
    text: "text-red-700 dark:text-red-300",
    icon: "✗",
    pulse: false,
  },
  blocked: {
    bg: "bg-orange-50 dark:bg-orange-900/30",
    border: "border-orange-400",
    text: "text-orange-700 dark:text-orange-300",
    icon: "⏸",
    pulse: false,
  },
};

// ─── 布局算法 ──────────────────────────────────────

interface LayoutNode {
  node: DAGNode;
  x: number;
  y: number;
  layer: number;
}

/**
 * Kahn 拓扑排序 → 分层布局
 * 将节点分配到层级，使所有边从低层指向高层
 */
function layoutDAG(dag: DAGData): LayoutNode[] {
  const { nodes, edges } = dag;
  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    outEdges.set(n.id, []);
  }
  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
    outEdges.get(e.from)?.push(e.to);
  }

  // Kahn 算法
  const layers: string[][] = [];
  let queue = nodes
    .filter((n) => (inDegree.get(n.id) || 0) === 0)
    .map((n) => n.id);

  while (queue.length > 0) {
    layers.push([...queue]);
    const next: string[] = [];
    for (const id of queue) {
      for (const to of outEdges.get(id) || []) {
        const deg = (inDegree.get(to) || 1) - 1;
        inDegree.set(to, deg);
        if (deg === 0) next.push(to);
      }
    }
    queue = next;
  }

  // 处理孤立节点（无入边也无出边）
  const placed = new Set(layers.flat());
  const orphans = nodes.filter((n) => !placed.has(n.id));
  if (orphans.length > 0) layers.push(orphans.map((n) => n.id));

  // 计算位置
  const result: LayoutNode[] = [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const totalHeight = layer.length * NODE_GAP_Y;
    const startY = -(totalHeight - NODE_GAP_Y) / 2;

    for (let ni = 0; ni < layer.length; ni++) {
      const node = nodeMap.get(layer[ni]);
      if (!node) continue;
      result.push({
        node,
        x: PADDING + li * LAYER_GAP_X,
        y: startY + ni * NODE_GAP_Y,
        layer: li,
      });
    }
  }

  return result;
}

// ─── 组件 ──────────────────────────────────────────

interface DAGViewProps {
  planId: string;
  onNodeClick?: (nodeId: string) => void;
}

export default function DAGView({ planId, onNodeClick }: DAGViewProps) {
  const [dag, setDag] = useState<DAGData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    planService
      .getDAG(planId)
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setError("无法加载 DAG 数据");
          logger.warn("DAG 数据为空", { planId });
        } else {
          setDag(data);
          logger.debug("DAG 数据加载成功", {
            planId,
            nodeCount: data.nodes.length,
          });
        }
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        handleClientError(e, {
          module: "views:DAGView",
          action: "getDAG",
          meta: { planId },
        });
        setError("加载 DAG 失败");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [planId]);

  const layout = useMemo(() => (dag ? layoutDAG(dag) : []), [dag]);

  if (loading) {
    return (
      <div className="p-4 text-center text-xs text-gray-400">加载依赖图...</div>
    );
  }

  if (error || !dag) {
    return (
      <div className="p-4 text-center text-xs text-gray-400">
        {error || "无依赖数据"}
      </div>
    );
  }

  if (dag.nodes.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-gray-400">暂无步骤</div>
    );
  }

  // 计算 SVG 画布大小
  const maxLayer = Math.max(...layout.map((n) => n.layer), 0);
  const svgW = PADDING * 2 + maxLayer * LAYER_GAP_X + NODE_W;
  const allY = layout.map((n) => n.y);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const svgH = maxY - minY + NODE_H + PADDING * 2;

  const layoutMap = new Map(layout.map((n) => [n.node.id, n]));

  // 连线路径
  const edgePaths = dag.edges.map((e, i) => {
    const from = layoutMap.get(e.from);
    const to = layoutMap.get(e.to);
    if (!from || !to) return null;

    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const cx = (x1 + x2) / 2;

    return (
      <path
        key={`edge-${i}`}
        d={`M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`}
        fill="none"
        stroke="currentColor"
        className="text-gray-300 dark:text-gray-600"
        strokeWidth="1.5"
        markerEnd="url(#arrowhead)"
      />
    );
  });

  return (
    <div className="overflow-auto p-2">
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="block"
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon
              points="0 0, 8 3, 0 6"
              className="fill-gray-400 dark:fill-gray-500"
            />
          </marker>
        </defs>

        {/* 连线 */}
        <g>{edgePaths}</g>

        {/* 节点 */}
        {layout.map((ln) => {
          const style = STATUS_STYLE[ln.node.status] || STATUS_STYLE.pending;
          return (
            <g
              key={ln.node.id}
              transform={`translate(${ln.x}, ${ln.y})`}
              className="cursor-pointer"
              onClick={() => onNodeClick?.(ln.node.id)}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx="6"
                className={`${style.bg} ${style.border} ${
                  style.pulse ? "animate-pulse" : ""
                }`}
                strokeWidth="1.5"
              />
              <text
                x={NODE_W / 2}
                y={NODE_H / 2 + 4}
                textAnchor="middle"
                className={`text-xs font-medium ${style.text}`}
              >
                {style.icon} {ln.node.description.slice(0, 12)}
                {ln.node.description.length > 12 ? "..." : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
