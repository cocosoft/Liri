import { memo, useRef, useEffect, useState, useCallback } from "react";
import type { GraphEdge } from "../../../types/graph";

interface GraphCanvasProps {
  edges: GraphEdge[];
  focusNode?: string;
  onFocusNode: (node: string | null) => void;
  isDark: boolean;
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
    if (edges.length === 0) return;

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
    const focusId = focusNode;
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
  }, [edges, dim, focusNode]);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      onFocusNode(focusNode === nodeId ? null : nodeId);
    },
    [focusNode, onFocusNode],
  );

  const domainColors = new Map<string, string>();
  let colorIdx = 0;
  for (const n of nodes) {
    if (n.domain && !domainColors.has(n.domain)) {
      domainColors.set(
        n.domain,
        DOMAIN_COLORS[colorIdx % DOMAIN_COLORS.length]!,
      );
      colorIdx++;
    }
  }

  const focusEdges = focusNode
    ? edges.filter((e) => e.from === focusNode || e.to === focusNode)
    : null;

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
        return (
          <line
            key={e.id}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={isFocus ? edgeFocus : edgeColor}
            strokeWidth={isFocus ? 2 : 0.5}
            strokeOpacity={focusNode && !isFocus ? 0.1 : 0.6}
          />
        );
      })}

      {/* Nodes */}
      {nodes.map((n) => {
        const isFocus = n.id === focusNode;
        const color = n.domain
          ? (domainColors.get(n.domain) ?? "#6b7280")
          : "#6b7280";
        return (
          <g
            key={n.id}
            onClick={() => handleNodeClick(n.id)}
            className="cursor-pointer"
          >
            <circle
              cx={n.x}
              cy={n.y}
              r={isFocus ? NODE_RADIUS + 3 : NODE_RADIUS}
              fill={color}
              stroke={isFocus ? "#fff" : "none"}
              strokeWidth={isFocus ? 2 : 0}
              opacity={focusNode && !isFocus ? 0.3 : 0.85}
            />
            {(isFocus || !focusNode) && (
              <text
                x={n.x}
                y={n.y + NODE_RADIUS + 10}
                textAnchor="middle"
                fontSize="9"
                fill={textColor}
                opacity={0.8}
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
