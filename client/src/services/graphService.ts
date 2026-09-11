import type {
  GraphAuditResponse,
  GraphBulkCreateResult,
  GraphEdge,
  GraphEdgeInput,
  GraphEdgesResponse,
  GraphEntitiesResponse,
  GraphNodeArchivePatch,
  GraphNodeRecord,
  GraphNodesResponse,
  GraphStats,
  GraphUndoResult,
} from "../types/project";
import { http } from "./httpClient";

function unwrap<T>(
  res: { ok: boolean; data?: T; error?: { code: number; message: string } },
  action: string,
): T {
  if (!res.ok)
    throw new Error(`[${action}] ${res.error?.message ?? "未知错误"}`);
  return res.data as T;
}

export const graphService = {
  /** 查询图谱边列表 */
  listEdges: async (params?: {
    domain?: string;
    entityId?: string;
    type?: string;
    limit?: number;
  }): Promise<GraphEdgesResponse> => {
    const sp = new URLSearchParams();
    if (params?.domain) sp.set("domain", params.domain);
    if (params?.entityId) sp.set("entityId", params.entityId);
    if (params?.type) sp.set("type", params.type);
    if (params?.limit !== undefined) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    const url = qs
      ? `/v1/knowledge/graph/edges?${qs}`
      : "/v1/knowledge/graph/edges";
    const res = await http.get<GraphEdgesResponse>(url);
    return unwrap(res, "GRAPH_LIST");
  },

  /** 获取图统计 */
  getStats: async (): Promise<GraphStats> => {
    const res = await http.get<GraphStats>("/v1/knowledge/graph/stats");
    return unwrap(res, "GRAPH_STATS");
  },

  /** 列出实体（由边派生；用于"看不到就管不了"的可见性兜底） */
  listEntities: async (params?: {
    domain?: string;
    limit?: number;
  }): Promise<GraphEntitiesResponse> => {
    const sp = new URLSearchParams();
    if (params?.domain) sp.set("domain", params.domain);
    if (params?.limit !== undefined) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    const url = qs
      ? `/v1/knowledge/graph/entities?${qs}`
      : "/v1/knowledge/graph/entities";
    const res = await http.get<GraphEntitiesResponse>(url);
    return unwrap(res, "GRAPH_LIST_ENTITIES");
  },

  /** 新增关系（后端幂等：同 (from,to,type,domain) 返回既有边） */
  createEdge: async (input: GraphEdgeInput): Promise<GraphEdge> => {
    const res = await http.post<{ edge: GraphEdge }>(
      "/v1/knowledge/graph/edges",
      input,
    );
    return unwrap(res, "GRAPH_CREATE_EDGE").edge;
  },

  /** 修改关系（attributes 为合并语义） */
  updateEdge: async (
    id: string,
    patch: {
      type?: string;
      direction?: "directed" | "symmetric";
      attributes?: Record<string, unknown>;
    },
  ): Promise<GraphEdge> => {
    const res = await http.patch<{ edge: GraphEdge }>(
      `/v1/knowledge/graph/edges/${encodeURIComponent(id)}`,
      patch,
    );
    return unwrap(res, "GRAPH_UPDATE_EDGE").edge;
  },

  /** 删除关系 */
  deleteEdge: async (id: string): Promise<void> => {
    const res = await http.delete<{ deleted: boolean }>(
      `/v1/knowledge/graph/edges/${encodeURIComponent(id)}`,
    );
    unwrap(res, "GRAPH_DELETE_EDGE");
  },

  /** 批量新增（单次 ≤ 1000，逐条容错） */
  bulkCreateEdges: async (
    edges: GraphEdgeInput[],
  ): Promise<GraphBulkCreateResult> => {
    const res = await http.post<GraphBulkCreateResult>(
      "/v1/knowledge/graph/edges/bulk",
      { edges },
    );
    return unwrap(res, "GRAPH_BULK_CREATE");
  },

  /** 删除实体（= 删除其所有关联边） */
  deleteEntity: async (
    id: string,
  ): Promise<{ deleted: boolean; removedEdges: number }> => {
    const res = await http.delete<{ deleted: boolean; removedEdges: number }>(
      `/v1/knowledge/graph/entities/${encodeURIComponent(id)}`,
    );
    return unwrap(res, "GRAPH_DELETE_ENTITY");
  },

  /** D5：审计列表（最新在前；append-only） */
  listAudit: async (params?: {
    edgeId?: string;
    limit?: number;
  }): Promise<GraphAuditResponse> => {
    const sp = new URLSearchParams();
    if (params?.edgeId) sp.set("edgeId", params.edgeId);
    if (params?.limit !== undefined) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    const url = qs
      ? `/v1/knowledge/graph/audit?${qs}`
      : "/v1/knowledge/graph/audit";
    const res = await http.get<GraphAuditResponse>(url);
    return unwrap(res, "GRAPH_LIST_AUDIT");
  },

  /** D5：撤销一次人工操作（新增→删除 / 修改→回滚 / 删除→恢复并解除墓碑） */
  undoAudit: async (auditId: string): Promise<GraphUndoResult> => {
    const res = await http.post<GraphUndoResult>(
      `/v1/knowledge/graph/audit/${encodeURIComponent(auditId)}/undo`,
      {},
    );
    return unwrap(res, "GRAPH_UNDO_AUDIT");
  },

  /**
   * D4：按关系类型批量删除该类型的全部边
   *
   * 服务端逐条走 `deleteEdge` → 每条写入墓碑 + 审计（可逐条撤销，且不会被下次抽取加回）。
   * 服务端要求 `confirm: true`（防误调用）。
   */
  deleteEdgesByType: async (
    type: string,
    domain?: string,
  ): Promise<{ deleted: number }> => {
    const res = await http.post<{ deleted: number }>(
      "/v1/knowledge/graph/edges/bulk-delete",
      domain ? { type, domain, confirm: true } : { type, confirm: true },
    );
    return unwrap(res, "GRAPH_BULK_DELETE");
  },

  // ===== D2：实体（节点）档案 =====

  /** 实体列表（**含孤立实体**，每行带 degree；`search` 由服务端全量匹配） */
  listNodes: async (params?: {
    domain?: string;
    limit?: number;
    search?: string;
  }): Promise<GraphNodesResponse> => {
    const sp = new URLSearchParams();
    if (params?.domain) sp.set("domain", params.domain);
    if (params?.limit) sp.set("limit", String(params.limit));
    if (params?.search) sp.set("search", params.search);
    const qs = sp.toString();
    const res = await http.get<GraphNodesResponse>(
      `/v1/knowledge/graph/nodes${qs ? `?${qs}` : ""}`,
    );
    return unwrap(res, "GRAPH_LIST_NODES");
  },

  /** 单实体档案 */
  getNode: async (nodeId: string): Promise<GraphNodeRecord> => {
    const res = await http.get<{ node: GraphNodeRecord }>(
      `/v1/knowledge/graph/nodes/${encodeURIComponent(nodeId)}`,
    );
    return unwrap(res, "GRAPH_GET_NODE").node;
  },

  /** 创建实体（支持孤立实体；`id` 即裸 slug，也可只给 `slug`） */
  createNode: async (
    input: {
      id?: string;
      domain?: string;
      kind?: string;
      slug?: string;
    } & GraphNodeArchivePatch,
  ): Promise<GraphNodeRecord> => {
    const res = await http.post<{ node: GraphNodeRecord }>(
      "/v1/knowledge/graph/nodes",
      input,
    );
    return unwrap(res, "GRAPH_CREATE_NODE").node;
  },

  /** 更新实体档案（身份字段 id 不可改；kind 是档案属性，可改） */
  updateNode: async (
    nodeId: string,
    patch: GraphNodeArchivePatch,
  ): Promise<GraphNodeRecord> => {
    const res = await http.patch<{ node: GraphNodeRecord }>(
      `/v1/knowledge/graph/nodes/${encodeURIComponent(nodeId)}`,
      patch,
    );
    return unwrap(res, "GRAPH_UPDATE_NODE").node;
  },

  /** 删除实体（有关联边时必须 `cascade=true`，否则服务端 400） */
  deleteNode: async (
    nodeId: string,
    cascade = false,
  ): Promise<{ deleted: boolean; removedEdges: number }> => {
    const res = await http.delete<{ deleted: boolean; removedEdges: number }>(
      `/v1/knowledge/graph/nodes/${encodeURIComponent(nodeId)}${cascade ? "?cascade=true" : ""}`,
    );
    return unwrap(res, "GRAPH_DELETE_NODE");
  },

  /**
   * O15：合并实体 —— 把 `from` 的全部关系改指到 `into`，并删除 `from` 节点
   *
   * 用于修复"同一实体被写成两个 ID"（如 `plan` 与 `pdca:plan`）的历史分裂。
   * 改指后与既有边同自然键的会被判重去重；每条改动写入审计（可撤销）。
   */
  mergeNodes: async (
    from: string,
    into: string,
  ): Promise<{ merged: boolean; repointed: number; deduped: number }> => {
    const res = await http.post<{
      merged: boolean;
      repointed: number;
      deduped: number;
    }>("/v1/knowledge/graph/nodes/merge", { from, into, confirm: true });
    return unwrap(res, "GRAPH_MERGE_NODES");
  },
};
