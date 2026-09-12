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
 * GraphRAG 图扩展回归（D1，2026-09-12）
 *
 * 锁死三处断点，防止再次静默退化：
 *   ① 不得再用 `concept:` / `entity:` 前缀盲查（O15-B 后必然 0 命中）
 *   ② 查边必须带 `direction: 'both'`（否则入边全丢）
 *   ③ 实体→文档映射优先血缘反查；无血缘时用**可读名**（name/aliases）而非 slug 子串
 * 以及 ④ 零命中/异常不得抛异常（图扩展是增强通道）
 *
 * 用测试替身（stub）注入图/血缘，不需要真实 DB 与模型。
 */
import { describe, expect, test } from 'bun:test';
import {
  expandKnowledgeByGraph,
  type GraphExpansionDoc,
} from './GraphExpansion.js';
import type { KnowledgeGraph } from './KnowledgeGraph.js';
import type { LineageStore } from '../lineage/LineageStore.js';

/** 记录调用参数的图替身 */
function createGraphStub(options: {
  nodes: Record<string, Record<string, unknown>>;
  edgesByNode: Record<string, Array<Record<string, unknown>>>;
  onGetNode?: (nodeId: string) => void;
}) {
  const queriedEntityIds: string[] = [];
  const queriedDirections: Array<string | undefined> = [];
  const graph = {
    async getNode(nodeId: string) {
      options.onGetNode?.(nodeId);
      return options.nodes[nodeId] ?? null;
    },
    async listNodes(filters: { search?: string }) {
      const search = filters.search ?? '';
      return Object.values(options.nodes).filter(
        (n) =>
          String(n.node_id ?? '').includes(search) ||
          String(n.name ?? '').includes(search)
      );
    },
    async queryEdges(filters: { entityId?: string; direction?: string }) {
      queriedEntityIds.push(String(filters.entityId));
      queriedDirections.push(filters.direction);
      return options.edgesByNode[String(filters.entityId)] ?? [];
    },
  };
  return {
    graph: graph as unknown as KnowledgeGraph,
    queriedEntityIds,
    queriedDirections,
  };
}

/** 血缘替身：nodeId → docPath[] */
function createLineageStub(map: Record<string, string[]>) {
  return {
    async findDocsByArtifact(_type: string, artifactId: string) {
      return (map[artifactId] ?? []).map((docPath) => ({
        docPath,
        artifactType: 'node',
        artifactId,
        domain: 'knowledge',
        version: 1,
        createdAt: 0,
      }));
    },
  } as unknown as LineageStore;
}

const buildSnippet = (content: string, tokens: string[]): string => {
  const line = content
    .split('\n')
    .find((l) => tokens.some((t) => l.toLowerCase().includes(t.toLowerCase())));
  return (line ?? '').trim();
};

const doc = (
  docPath: string,
  title: string,
  content: string
): GraphExpansionDoc => ({
  docPath,
  title,
  content,
  category: 'wiki',
  isKnowledgeDoc: true,
});

describe('GraphRAG 图扩展（D1）', () => {
  test('① 不再用 concept:/entity: 前缀盲查；② 查边带 both；③ 经血缘召回"正文不含节点 ID"的文档', async () => {
    const { graph, queriedEntityIds, queriedDirections } = createGraphStub({
      nodes: {
        knowledge: {
          node_id: 'knowledge',
          name: '知识图谱检索',
          aliases: '[]',
        },
        graphrag: {
          node_id: 'graphrag',
          name: 'GraphRAG 图扩展',
          aliases: '[]',
        },
        vector: { node_id: 'vector', name: '向量检索', aliases: '[]' },
      },
      edgesByNode: {
        // 出边 + 入边各一条：只有 direction:'both' 才能同时拿到
        knowledge: [
          { from: 'knowledge', to: 'graphrag', type: 'synonym' },
          { from: 'vector', to: 'knowledge', type: 'related' },
        ],
      },
    });

    const docB = doc(
      'domains/x/wiki/doc-b.md',
      '图扩展实现',
      '这一段正文既没有 knowledge 也没有 graphrag 这样的标识串。'
    );
    const docC = doc('domains/x/wiki/doc-c.md', '向量通道', '纯向量检索说明。');

    const { routes, stats } = await expandKnowledgeByGraph({
      query: '知识图谱检索',
      tokens: ['knowledge'],
      maxResults: 5,
      deps: {
        graph,
        docs: [docB, docC],
        lineage: createLineageStub({
          graphrag: [docB.docPath],
          vector: [docC.docPath],
        }),
        buildSnippet,
      },
    });

    // ① 无前缀盲查
    expect(queriedEntityIds.every((id) => !id.includes(':'))).toBe(true);
    expect(queriedEntityIds).toContain('knowledge');
    // ② 每次查边都显式 both
    expect(queriedDirections).toEqual(['both']);
    // ③ 入边（vector→knowledge）与出边（knowledge→graphrag）都被映射到文档
    expect(routes.map((r) => r.docPath).sort()).toEqual([
      docB.docPath,
      docC.docPath,
    ]);
    expect(stats).toMatchObject({
      candidateTokens: 1,
      resolvedNodes: 1,
      edges: 2,
      expandedDocs: 2,
    });
  });

  test('③-b 无血缘时用可读名（name/aliases）兜底，而非 slug 子串', async () => {
    const { graph } = createGraphStub({
      nodes: {
        graphrag: {
          node_id: 'graphrag',
          name: 'GraphRAG 图扩展',
          aliases: '[]',
        },
        neighbor: {
          node_id: 'neighbor',
          name: '社区摘要',
          aliases: '["community summary"]',
        },
      },
      edgesByNode: {
        graphrag: [{ from: 'graphrag', to: 'neighbor', type: 'related' }],
      },
    });

    // 正文含可读名（'社区摘要'），但不含节点 ID（'neighbor'）
    const target = doc(
      'domains/x/wiki/doc-d.md',
      '摘要机制',
      '社区摘要是 GraphRAG 的全局问答前提。'
    );

    const { routes, stats } = await expandKnowledgeByGraph({
      query: 'graphrag',
      tokens: ['graphrag'],
      maxResults: 5,
      deps: { graph, docs: [target], buildSnippet },
    });

    expect(routes.map((r) => r.docPath)).toEqual([target.docPath]);
    expect(stats.expandedDocs).toBe(1);
  });

  test('④ 零命中与单点异常都不抛异常（图扩展属增强通道）', async () => {
    const { graph: emptyGraph } = createGraphStub({
      nodes: {},
      edgesByNode: {},
    });
    const empty = await expandKnowledgeByGraph({
      query: '不存在的词',
      tokens: ['nonexistenttoken'],
      maxResults: 5,
      deps: { graph: emptyGraph, docs: [], buildSnippet },
    });
    expect(empty.routes).toEqual([]);
    expect(empty.stats.resolvedNodes).toBe(0);

    const { graph: throwingGraph } = createGraphStub({
      nodes: {},
      edgesByNode: {},
      onGetNode: () => {
        throw new Error('db down');
      },
    });
    const thrown = await expandKnowledgeByGraph({
      query: '任意词',
      tokens: ['sometoken'],
      maxResults: 5,
      deps: { graph: throwingGraph, docs: [], buildSnippet },
    });
    expect(thrown.routes).toEqual([]);
    expect(thrown.stats.resolvedNodes).toBe(0);
  });

  test('maxResults 截断生效', async () => {
    const { graph } = createGraphStub({
      nodes: {
        a: { node_id: 'a', name: '甲', aliases: '[]' },
        b: { node_id: 'b', name: '乙', aliases: '[]' },
        c: { node_id: 'c', name: '丙', aliases: '[]' },
      },
      edgesByNode: {
        a: [
          { from: 'a', to: 'b', type: 'related' },
          { from: 'a', to: 'c', type: 'related' },
        ],
      },
    });
    const docs = [doc('d1.md', 't1', '正文一'), doc('d2.md', 't2', '正文二')];
    const { routes } = await expandKnowledgeByGraph({
      query: 'a',
      tokens: ['a'],
      maxResults: 1,
      deps: {
        graph,
        docs,
        lineage: createLineageStub({ b: ['d1.md'], c: ['d2.md'] }),
        buildSnippet,
      },
    });
    expect(routes.length).toBe(1);
  });
});
