import { memo, useRef, useEffect, useState, useCallback, useMemo } from "react";
import type { GraphEdge } from "../../../types/project";

interface GraphCanvasProps {
  edges: GraphEdge[];
  focusNode?: string;
  onFocusNode: (node: string | null) => void;
  isDark: boolean;
  /** 搜索高亮关键词（匹配实体名） */
  highlight?: string;
}

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  domain?: string;
}

const NODE_RADIUS = 8;
const PADDING = 50;
const DOMAIN_COLORS = [
  "#3b82f6",
  "#a855f7",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#ef4444",
  "#6366f1",
];

export const GraphCanvas = memo(function GraphCanvas({
  edges,
  focusNode,
  onFocusNode,
  isDark,
  highlight = "",
}: GraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<LayoutNode[]>([]);
  const [dim, setDim] = useState({ w: 600, h: 400 });

  // Resize observer
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
      setDim({ w: Math.max(width - 20, 200), h: Math.max(height - 10, 200) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Simple force layout
  useEffect(() => {
    // KB-G1：边清空时重置节点，避免"有边库切到无边库"旧节点残留画布
    if (edges.length === 0) {
      setNodes([]);
      return;
    }

    // Collect unique nodes
    const nodeMap = new Map<string, LayoutNode>();
    for (const e of edges) {
      if (!nodeMap.has(e.from)) {
        nodeMap.set(e.from, {
          id: e.from,
          x: Math.random() * (dim.w - PADDING * 2) + PADDING,
          y: Math.random() * (dim.h - PADDING * 2) + PADDING,
          vx: 0,
          vy: 0,
          domain: e.domain,
        });
      }
      if (!nodeMap.has(e.to)) {
        nodeMap.set(e.to, {
          id: e.to,
          x: Math.random() * (dim.w - PADDING * 2) + PADDING,
          y: Math.random() * (dim.h - PADDING * 2) + PADDING,
          vx: 0,
          vy: 0,
          domain: e.domain,
        });
      }
    }

    // Run force simulation (simple n-body)
    const nodesArr = Array.from(nodeMap.values());
    const runSim = () => {
      const repulsion = 500;
      const attraction = 0.01;
      const damping = 0.9;

      for (let iter = 0; iter < 50; iter++) {
        // Repulsion between all nodes
        for (let i = 0; i < nodesArr.length; i++) {
          for (let j = i + 1; j < nodesArr.length; j++) {
            const a = nodesArr[i]!;
            const b = nodesArr[j]!;
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
            const force = repulsion / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            a.vx -= fx;
            a.vy -= fy;
            b.vx += fx;
            b.vy += fy;
          }
        }

        // Attraction along edges
        for (const e of edges) {
          const a = nodeMap.get(e.from);
          const b = nodeMap.get(e.to);
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = dist * attraction;
          a.vx += (dx / dist) * force;
          a.vy += (dy / dist) * force;
          b.vx -= (dx / dist) * force;
          b.vy -= (dy / dist) * force;
        }

        // Center gravity
        const cx = dim.w / 2;
        const cy = dim.h / 2;
        for (const n of nodesArr) {
          n.vx += (cx - n.x) * 0.001;
          n.vy += (cy - n.y) * 0.001;
        }

        // Damping + apply
        for (const n of nodesArr) {
          n.vx *= damping;
          n.vy *= damping;
          n.x = Math.max(PADDING, Math.min(dim.w - PADDING, n.x + n.vx));
          n.y = Math.max(PADDING, Math.min(dim.h - PADDING, n.y + n.vy));
        }
      }
    };

    runSim();
    setNodes(nodesArr);
    // KB-C12：focusNode 仅影响视觉高亮不参与布局，从 deps 移除避免点击聚焦触发 50 迭代重排导致节点跳动
  }, [edges, dim]);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      onFocusNode(focusNode === nodeId ? null : nodeId);
    },
    [focusNode, onFocusNode],
  );

  // KB-L12：domain→颜色映射用 useMemo 缓存（原每次渲染重建 Map）
  const domainColors = useMemo(() => {
    const map = new Map<string, string>();
    let colorIdx = 0;
    for (const n of nodes) {
      if (n.domain && !map.has(n.domain)) {
        map.set(n.domain, DOMAIN_COLORS[colorIdx % DOMAIN_COLORS.length]!);
        colorIdx++;
      }
    }
    return map;
  }, [nodes]);

  const focusEdges = focusNode
    ? edges.filter((e) => e.from === focusNode || e.to === focusNode)
    : null;

  const hl = highlight.trim().toLowerCase();
  const highlightNodes = useMemo(() => {
    const set = new Set<string>();
    if (!hl) return set;
    for (const e of edges) {
      if (e.from.toLowerCase().includes(hl)) set.add(e.from);
      if (e.to.toLowerCase().includes(hl)) set.add(e.to);
    }
    return set;
  }, [edges, hl]);

  const bgColor = isDark ? "#1f2937" : "#f9fafb";
  const edgeColor = isDark ? "#374151" : "#d1d5db";
  const edgeFocus = isDark ? "#6366f1" : "#3b82f6";
  const textColor = isDark ? "#9ca3af" : "#6b7280";

  return (
    <svg
      ref={svgRef}
      width={dim.w}
      height={dim.h}
      viewBox={`0 0 ${dim.w} ${dim.h}`}
      className="w-full h-full"
      style={{ background: bgColor }}
    >
      {/* Edges */}
      {edges.map((e) => {
        const from = nodes.find((n) => n.id === e.from);
        const to = nodes.find((n) => n.id === e.to);
        if (!from || !to) return null;
        const isFocus = focusEdges?.some((fe) => fe.id === e.id);
        // 高亮模式下：端点命中关键词的边加粗高亮，仅关系类型命中的边淡化
        const edgeStrong =
          isFocus ||
          !hl ||
          highlightNodes.has(e.from) ||
          highlightNodes.has(e.to);
        return (
          <line
            key={e.id}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={isFocus || (hl && !edgeStrong) ? edgeFocus : edgeColor}
            strokeWidth={isFocus ? 2 : edgeStrong ? 1 : 0.5}
            strokeOpacity={
              focusNode && !isFocus ? 0.1 : edgeStrong ? 0.6 : 0.15
            }
          />
        );
      })}

      {/* Nodes */}
      {nodes.map((n) => {
        const isFocus = n.id === focusNode;
        const isHl = hl !== "" && highlightNodes.has(n.id);
        const dimmed = hl !== "" && !isHl;
        const color = n.domain
          ? (domainColors.get(n.domain) ?? "#6b7280")
          : "#6b7280";
        const showLabel = isFocus || isHl || !(focusNode || hl !== "");
        return (
          <g
            key={n.id}
            onClick={() => handleNodeClick(n.id)}
            className="cursor-pointer"
          >
            <circle
              cx={n.x}
              cy={n.y}
              r={
                isFocus ? NODE_RADIUS + 3 : isHl ? NODE_RADIUS + 2 : NODE_RADIUS
              }
              fill={isHl ? "#f59e0b" : color}
              stroke={isFocus || isHl ? "#fff" : "none"}
              strokeWidth={isFocus || isHl ? 2 : 0}
              opacity={focusNode && !isFocus ? 0.3 : dimmed ? 0.2 : 0.85}
            />
            {showLabel && (
              <text
                x={n.x}
                y={n.y + NODE_RADIUS + 10}
                textAnchor="middle"
                fontSize="9"
                fill={textColor}
                opacity={isHl ? 1 : 0.8}
                fontWeight={isHl ? 600 : 400}
              >
                {n.id.length > 20 ? n.id.slice(0, 18) + "…" : n.id}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
});
