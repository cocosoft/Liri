// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * GraphRAG 图扩展（D1 修复，2026-09-12）
 *
 * 修复《Liri 缺陷查补计划》D1 的三处断点 —— 原实现（`KnowledgeRouter.graphExpand`）长期**静默空转**：
 *
 *   ① 候选实体解析：**删掉** `concept:` / `entity:` 前缀盲查。O15-B 统一裸 slug 后 `kg_nodes`
 *      中含冒号节点为 0，那两次查询必然 0 命中（纯浪费 IO）。改为：
 *        a. 先用裸 token 精确查节点（`getNode(token)`）；
 *        b. 未命中再按 token 检索节点（`listNodes({search: token})`，匹配 node_id/name/description）。
 *   ② 查边必须带 `direction: 'both'` —— 不传时 `queryEdges` 退化为"仅出边"（O16 已确认），入边关系全丢。
 *   ③ 实体 → 文档映射：优先走 `kg_lineage` 反查（`findDocsByArtifact('node', nodeId)`）；
 *      无血缘的节点再用**可读名**（`name` / `aliases`）匹配正文与标题。
 *      原实现拿 **slug** 去正文做子串匹配（如 `knowledge`、`.liri-todo`），正文通常不含该串 → 必然近空。
 *   ④ 可观测性：无论命中与否都上报计数（候选词 / 解析节点 / 命中边 / 扩展文档）；
 *      单个 token 的查询异常只 warn 该 token 并继续，不再静默 `catch {}` 吞掉。
 *
 * 本模块只做"图 → 文档"这一段，检索融合（RRF）、重排、上下文富化仍由 KnowledgeRouter 负责。
 */

import type { KnowledgeRoute } from '@modules/docs/knowledge-types';
import type { KnowledgeGraph } from '@modules/knowledge/graph/KnowledgeGraph';
import type { LineageStore } from '@modules/knowledge/lineage/LineageStore';
import { LogLevel } from '@modules/monitoring';
import { OTelAwareLogger } from '@modules/monitoring/logs/OTelAwareLogger';

const logger = new OTelAwareLogger({
  module: 'knowledge:graph-expansion',
  level: LogLevel.INFO,
});

/** 边关系类型权重（原 KnowledgeRouter 内联映射，随逻辑一并迁入） */
const EDGE_WEIGHTS: Record<string, number> = {
  synonym: 0.5,
  related: 0.4,
  parent: 0.35,
  child: 0.35,
  reference: 0.25,
};
const DEFAULT_EDGE_WEIGHT = 0.3;

/** 单个候选词最多解析出的节点数 */
const MAX_NODES_PER_TOKEN = 5;
/** 参与查边的节点上限（防查询放大） */
const MAX_EDGE_QUERY_NODES = 10;
/** 单节点查边上限（沿用原值） */
const EDGE_LIMIT_PER_NODE = 10;

/** 图扩展所需的最小文档视图（结构化兼容 KnowledgeRouter 的 WeightedDoc） */
export interface GraphExpansionDoc {
  docPath: string;
  title: string;
  content: string;
  category: string;
  isKnowledgeDoc: boolean;
  tags?: string[];
}

export interface GraphExpansionDeps {
  graph: KnowledgeGraph;
  /** 全量文档（与关键词/语义通道同一份语料） */
  docs: readonly GraphExpansionDoc[];
  /** 血缘库：用于"实体节点 → 来源文档"反查；缺省时退化为可读名匹配 */
  lineage?: LineageStore;
  /** 片段提取（由 KnowledgeRouter 注入，避免第二份实现） */
  buildSnippet: (content: string, tokens: string[]) => string;
}

/** 一次图扩展的可观测计数（④） */
export interface GraphExpansionStats {
  /** 候选词数 */
  candidateTokens: number;
  /** 解析出的图节点数 */
  resolvedNodes: number;
  /** 命中的边数 */
  edges: number;
  /** 扩展出的文档数（已按 docPath 去重） */
  expandedDocs: number;
}

export interface GraphExpansionResult {
  routes: KnowledgeRoute[];
  stats: GraphExpansionStats;
}

/** 已解析的图节点（缓存可读名，供 ③ 的兜底匹配使用） */
interface ResolvedNode {
  nodeId: string;
  readableNames: string[];
}

/** 解析 `aliases` 字段（存储为 JSON 字符串） */
function parseAliases(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((a): a is string => typeof a === 'string');
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((a): a is string => typeof a === 'string');
      }
    } catch {
      // @ignore-catch: 非 JSON 的脏数据按"无别名"处理，不影响主流程
    }
  }
  return [];
}

/** 从一个节点行提取可读名（name + aliases，去重去空） */
function toReadableNames(row: Record<string, unknown>): string[] {
  const names = new Set<string>();
  if (typeof row.name === 'string' && row.name.trim()) {
    names.add(row.name.trim());
  }
  for (const alias of parseAliases(row.aliases)) {
    if (alias.trim()) names.add(alias.trim());
  }
  return [...names];
}

/** ① 候选词 → 图节点（裸 slug 精确命中优先，其次按 token 检索） */
async function resolveNodes(
  tokens: string[],
  graph: KnowledgeGraph,
  stats: GraphExpansionStats
): Promise<Map<string, ResolvedNode>> {
  const resolved = new Map<string, ResolvedNode>();

  for (const token of tokens) {
    try {
      const exact = await graph.getNode(token);
      if (exact) {
        const nodeId = String(exact.node_id ?? token);
        resolved.set(nodeId, { nodeId, readableNames: toReadableNames(exact) });
        continue;
      }
      const rows = await graph.listNodes({
        search: token,
        limit: MAX_NODES_PER_TOKEN,
      });
      for (const row of rows) {
        const nodeId = String(row.node_id ?? '');
        if (!nodeId) continue;
        resolved.set(nodeId, { nodeId, readableNames: toReadableNames(row) });
      }
    } catch (err) {
      // ④：单 token 失败不吞掉（原实现是空 catch），但不影响其它候选词
      logger.warn('GraphRAG: 候选词节点解析失败', {
        token,
        error: String(err),
      });
    }
  }

  stats.resolvedNodes = resolved.size;
  return resolved;
}

/** ② 查边（显式 both）→ 邻居节点权重 */
async function collectRelatedNodes(
  resolved: Map<string, ResolvedNode>,
  graph: KnowledgeGraph,
  stats: GraphExpansionStats
): Promise<{
  weights: Map<string, number>;
  readableNames: Map<string, string[]>;
}> {
  const weights = new Map<string, number>();
  const readableNames = new Map<string, string[]>();

  for (const node of [...resolved.values()].slice(0, MAX_EDGE_QUERY_NODES)) {
    readableNames.set(node.nodeId, node.readableNames);
    try {
      const edges = await graph.queryEdges({
        entityId: node.nodeId,
        direction: 'both', // ② 修复：不传方向会退化为"仅出边"，入边全丢
        limit: EDGE_LIMIT_PER_NODE,
      });
      stats.edges += edges.length;
      for (const edge of edges) {
        const weight = EDGE_WEIGHTS[edge.type] ?? DEFAULT_EDGE_WEIGHT;
        for (const endpoint of [edge.from, edge.to]) {
          if (!endpoint) continue;
          const existing = weights.get(endpoint);
          if (existing === undefined || weight > existing) {
            weights.set(endpoint, weight);
          }
        }
      }
    } catch (err) {
      logger.warn('GraphRAG: 节点查边失败', {
        nodeId: node.nodeId,
        error: String(err),
      });
    }
  }

  return { weights, readableNames };
}

/**
 * ③ 节点 → 文档映射
 *
 * 优先血缘反查（`kg_lineage` 的 `artifact_type='node'`），未覆盖的节点再用可读名匹配正文/标题。
 *
 * 注意：**关联节点**（由边发现的邻居）不在候选词解析结果里，其可读名需按需回查 `getNode`
 * —— 否则 ③-b 兜底会因为"没有名字"而永远匹配不到任何文档（实测踩过）。
 */
async function mapNodesToDocs(
  weights: Map<string, number>,
  readableNames: Map<string, string[]>,
  deps: GraphExpansionDeps
): Promise<{
  byDoc: Map<string, { weight: number; viaLineage: boolean; names: string[] }>;
  lineageNodeCount: number;
}> {
  const byDoc = new Map<
    string,
    { weight: number; viaLineage: boolean; names: string[] }
  >();
  const nameCache = new Map<string, string[]>(readableNames);
  let lineageNodeCount = 0;

  /** 取节点可读名（name + aliases）：先查缓存，未命中回头查图 */
  const lookupNames = async (nodeId: string): Promise<string[]> => {
    const cached = nameCache.get(nodeId);
    if (cached !== undefined) return cached;
    try {
      const row = await deps.graph.getNode(nodeId);
      const resolved = row ? toReadableNames(row) : [];
      nameCache.set(nodeId, resolved);
      return resolved;
    } catch (err) {
      logger.warn('GraphRAG: 关联节点可读名查询失败', {
        nodeId,
        error: String(err),
      });
      nameCache.set(nodeId, []);
      return [];
    }
  };

  for (const [nodeId, weight] of weights) {
    // ③-a 血缘反查：实体 → 产出它的源文档
    let coveredByLineage = false;
    if (deps.lineage) {
      try {
        const links = await deps.lineage.findDocsByArtifact('node', nodeId);
        if (links.length > 0) {
          coveredByLineage = true;
          lineageNodeCount++;
          const names = await lookupNames(nodeId);
          for (const link of links) {
            const existing = byDoc.get(link.docPath);
            if (existing === undefined || weight > existing.weight) {
              byDoc.set(link.docPath, { weight, viaLineage: true, names });
            }
          }
        }
      } catch (err) {
        logger.warn('GraphRAG: 血缘反查失败', { nodeId, error: String(err) });
      }
    }
    if (coveredByLineage) continue;

    // ③-b 兜底：用**可读名**（name/aliases）匹配正文/标题（不再用 slug 做子串匹配）
    const names = (await lookupNames(nodeId)).filter((n) => n.length >= 2);
    if (names.length === 0) continue;
    for (const doc of deps.docs) {
      const haystack = `${doc.title}\n${doc.content}`.toLowerCase();
      const hit = names.some((n) => haystack.includes(n.toLowerCase()));
      if (!hit) continue;
      const existing = byDoc.get(doc.docPath);
      if (existing === undefined || weight > existing.weight) {
        byDoc.set(doc.docPath, { weight, viaLineage: false, names });
      }
    }
  }

  return { byDoc, lineageNodeCount };
}

/**
 * 图扩展主入口：query 候选词 → 图节点 → 关联节点 → 文档
 *
 * 调用方（KnowledgeRouter）负责传入已分词过滤的 `tokens`（保持单一分词实现）。
 */
export async function expandKnowledgeByGraph(params: {
  query: string;
  tokens: string[];
  maxResults: number;
  deps: GraphExpansionDeps;
}): Promise<GraphExpansionResult> {
  const { query, tokens, maxResults, deps } = params;
  const stats: GraphExpansionStats = {
    candidateTokens: tokens.length,
    resolvedNodes: 0,
    edges: 0,
    expandedDocs: 0,
  };

  if (tokens.length === 0) {
    return { routes: [], stats };
  }

  const resolved = await resolveNodes(tokens, deps.graph, stats);
  if (resolved.size === 0) {
    // ④ "无异常但零命中"也要留痕（原实现在此静默 return）
    logger.debug('GraphRAG: 候选词未命中任何图节点', {
      query,
      candidateTokens: stats.candidateTokens,
    });
    return { routes: [], stats };
  }

  const { weights, readableNames } = await collectRelatedNodes(
    resolved,
    deps.graph,
    stats
  );
  if (weights.size === 0) {
    logger.debug('GraphRAG: 节点无关联边', {
      query,
      resolvedNodes: stats.resolvedNodes,
    });
    return { routes: [], stats };
  }

  const { byDoc, lineageNodeCount } = await mapNodesToDocs(
    weights,
    readableNames,
    deps
  );

  const docsByPath = new Map(deps.docs.map((d) => [d.docPath, d]));
  const routes: KnowledgeRoute[] = [];
  for (const [docPath, meta] of byDoc) {
    const doc = docsByPath.get(docPath);
    if (!doc) continue; // 血缘指向的文档不在当前语料（可能已删除/被过滤）
    routes.push({
      docPath: doc.docPath,
      title: doc.title,
      score: meta.weight,
      category: doc.category,
      snippet: deps.buildSnippet(
        doc.content,
        meta.names.length ? meta.names : tokens
      ),
      matchType: 'semantic',
      isKnowledgeDoc: doc.isKnowledgeDoc,
      tags: doc.tags,
    });
    if (routes.length >= maxResults) break;
  }

  stats.expandedDocs = routes.length;

  if (routes.length === 0) {
    // ④ 有节点、有边却映射不到文档 → 这是**可操作**的信号，用 warn 而非静默
    logger.warn('GraphRAG: 图扩展无产出（有节点/边但未映射到文档）', {
      query,
      ...stats,
      lineageNodeCount,
    });
  } else {
    logger.debug('GraphRAG 图扩展完成', {
      query,
      ...stats,
      lineageNodeCount,
    });
  }

  return { routes, stats };
}
