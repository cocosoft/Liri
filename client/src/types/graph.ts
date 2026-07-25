/** 边 */
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  direction: "directed" | "symmetric";
  domain?: string;
  attributes: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** 图统计 */
export interface GraphStats {
  totalEdges: number;
  byType: Record<string, number>;
  totalEntities: number;
}

/** 图数据 API 响应 */
export interface GraphEdgesResponse {
  edges: GraphEdge[];
  stats: GraphStats;
}
