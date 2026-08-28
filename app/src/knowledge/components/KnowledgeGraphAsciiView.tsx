// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 知识图谱文本化视图 — KnowledgeGraphAsciiView
 *
 * 在终端中以文本方式渲染实体关系图。
 * 使用简单的连线绘制实体节点和关系边。
 */

import React from 'react';
import { Text, Box } from '../../components/ink.js';

export interface GraphEntity {
  id: string;
  label: string;
  type?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: string;
}

interface Props {
  entities: GraphEntity[];
  edges: GraphEdge[];
  centerEntity?: string;
  maxDepth?: number;
}

/** 实体→子实体的邻接关系 */
interface AdjacencyMap {
  entity: GraphEntity;
  edges: Array<{ target: GraphEntity; type: string }>;
}

export function KnowledgeGraphAsciiView({
  entities,
  edges,
  centerEntity,
  maxDepth = 2,
}: Props): React.ReactNode {
  if (entities.length === 0) {
    return (
      <Box flexDirection="row">
        <Text dimColor>知识图谱为空。编译知识库以构建实体关系。</Text>
      </Box>
    );
  }

  const entityMap = new Map<string, GraphEntity>();
  for (const e of entities) {
    entityMap.set(e.id, e);
  }

  // 构建邻接关系
  const adj = new Map<string, AdjacencyMap>();
  const connected = new Set<string>();
  for (const edge of edges) {
    const fromEntity = entityMap.get(edge.from);
    const toEntity = entityMap.get(edge.to);
    if (!fromEntity || !toEntity) continue;

    connected.add(edge.from);
    connected.add(edge.to);
    if (!adj.has(edge.from)) {
      adj.set(edge.from, { entity: fromEntity, edges: [] });
    }
    adj.get(edge.from)!.edges.push({ target: toEntity, type: edge.type });
  }

  // 确定起始节点：centerEntity 无效时回退到第一个实体
  const rootId =
    centerEntity && entityMap.has(centerEntity)
      ? centerEntity
      : entities[0]!.id;
  const visited = new Set<string>();

  function renderNode(
    entityId: string,
    depth: number,
    prefix: string
  ): React.ReactNode[] {
    if (depth > maxDepth || visited.has(entityId)) return [];
    visited.add(entityId);

    const entity = entityMap.get(entityId);
    if (!entity) return [];

    const node = adj.get(entityId);
    const children = node?.edges ?? [];

    const result: React.ReactNode[] = [];
    result.push(
      <Box key={entityId} flexDirection="row">
        <Text>{prefix}</Text>
        <Text bold>{entity.label}</Text>
        {entity.type && <Text dimColor> [{entity.type}]</Text>}
      </Box>
    );

    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      const isLast = i === children.length - 1;
      const childPrefix =
        prefix.replace(/├──$/, '│  ').replace(/└──$/, '   ') +
        (isLast ? '└──' : '├──');
      const edgeLabel = `─${child.type}─ `;

      result.push(
        <Box key={`${entityId}-edge-${i}`} flexDirection="row">
          <Text dimColor>
            {childPrefix}
            {edgeLabel}
          </Text>
          <Text>{child.target.label}</Text>
        </Box>
      );

      // 递归子节点
      const childNodePrefix =
        prefix.replace(/├──$/, '│  ').replace(/└──$/, '   ') +
        (isLast ? '   ' : '│  ');
      result.push(...renderNode(child.target.id, depth + 1, childNodePrefix));
    }

    return result;
  }

  // 孤立实体：没有任何关联边，单独列出（P3-2）
  const isolated = entities.filter((e) => !connected.has(e.id));

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>知识图谱</Text>
        <Text dimColor>
          {' '}
          ({entities.length} entities, {edges.length} edges)
        </Text>
      </Box>
      <Box flexDirection="column" marginLeft={1}>
        {renderNode(rootId, 1, '● ')}
      </Box>
      {isolated.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Box flexDirection="row">
            <Text dimColor>孤立实体 ({isolated.length})：</Text>
          </Box>
          <Box flexDirection="column" marginLeft={2}>
            {isolated.slice(0, 10).map((e) => (
              <Text key={e.id} dimColor>
                • {e.label}
                {e.type ? ` [${e.type}]` : ''}
              </Text>
            ))}
            {isolated.length > 10 && (
              <Text dimColor>... 共 {isolated.length} 个孤立实体</Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
