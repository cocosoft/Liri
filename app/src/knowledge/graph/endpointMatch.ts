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
 * 端点约束判定（D7-1；**O15-B 起不再从 ID 解析 kind**）
 *
 * **B 决策（2026-09-11，用户拍板）**：实体 ID 统一为**裸 slug**，不承载 domain/kind；
 * `kind` 是实体的**档案属性**，存 `kg_nodes.kind`。因此端点校验所需 kind 由调用方
 * **注入**（先查节点表再传入）—— 本模块保持**纯函数**（可测、无 DB 依赖）。
 *
 * 共用的是「比对」这一纯函数，不共用「处置动作」：
 * - 抽取侧（`GraphExtractor.applySchemaFilter`）：不匹配 → **丢弃 + 计入 `droppedEdges`**
 * - 写入侧（`KnowledgeGraph.addEdge`）：不匹配 → **告警 + 计数，不拒绝**（D7=B 决策）
 *
 * **kind 未知时视为 matched（不判定）**：历史上 2191 个实体均无 kind，未标注时不应误报；
 * 待实体档案补全 kind 后，本约束**自动生效**（无需再改代码）。
 *
 * 本模块刻意不 import `KnowledgeGraph`（避免循环依赖）。
 */

import type { EdgeSchema } from '@modules/knowledge/schema/SchemaLoader';

/** 端点 kind 提供者（同步；由调用方预先查好，如 `Map.get` 的包装） */
export type EndpointKindLookup = (nodeId: string) => string | undefined;

export interface EndpointMatchResult {
  /** false = 端点 kind 与 schema 的 endpoints 声明不符 */
  matched: boolean;
  reason?: 'from_mismatch' | 'to_mismatch';
  expectedFrom?: string;
  expectedTo?: string;
  actualFrom?: string;
  actualTo?: string;
}

/**
 * 判定一条边的端点是否符合 schema 的 `endpoints` 声明
 *
 * 以下情况一律视为 matched（跳过校验）：
 * 1. 该关系类型未在 schema 中声明（关系白名单由调用方另行判定）；
 * 2. schema 未声明 `endpoints`；
 * 3. 未提供 `kindOf`，或该端点的 kind 为空（**未标注**，防误报）。
 */
export function evaluateEndpointMatch(
  edge: { from: string; to: string; type: string },
  edgeSchemas: Map<string, EdgeSchema>,
  kindOf?: EndpointKindLookup
): EndpointMatchResult {
  const edgeSchema = edgeSchemas.get(edge.type);
  if (!edgeSchema?.endpoints) return { matched: true };

  const expectedFrom = edgeSchema.endpoints.from;
  const expectedTo = edgeSchema.endpoints.to;
  const actualFrom = kindOf?.(edge.from);
  const actualTo = kindOf?.(edge.to);

  if (actualFrom && actualFrom !== expectedFrom) {
    return {
      matched: false,
      reason: 'from_mismatch',
      expectedFrom,
      expectedTo,
      actualFrom,
      actualTo,
    };
  }
  if (actualTo && actualTo !== expectedTo) {
    return {
      matched: false,
      reason: 'to_mismatch',
      expectedFrom,
      expectedTo,
      actualFrom,
      actualTo,
    };
  }
  return { matched: true };
}
