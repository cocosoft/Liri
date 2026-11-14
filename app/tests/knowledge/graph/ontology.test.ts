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
 * D8：kg_edges 最小本体层。
 *
 * 验收（方案 §2 D8）：
 * - **非法关系被拒**：未知关系类型 / 端点 kind 与 schema 不符 ⇒ 抛错（不静默入库）；
 * - **检索质量有对照**：别名写法与规范名写法落库后是**同一种关系**，
 *   用任一写法查询都能召回（未规范化则只召回其中一半）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  CORE_EDGE_SCHEMAS,
  normalizeRelationType,
  parseEntityKind,
  validateEdgeAgainstSchemas,
} from '../../../src/knowledge/graph/ontology';
import { KnowledgeGraph } from '../../../src/knowledge/graph/KnowledgeGraph';

/** 取 `AppError.code`（未抛错 ⇒ `null`） */
async function codeOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? null;
  }
}

describe('normalizeRelationType：关系名规范化', () => {
  it('别名收敛到规范名', () => {
    expect(normalizeRelationType('works_at')).toBe('works_for');
    expect(normalizeRelationType('EMPLOYED_BY')).toBe('works_for');
    expect(normalizeRelationType('is a')).toBe('subtype_of');
    expect(normalizeRelationType('is-part-of')).toBe('part_of');
  });

  it('大小写 / 空格 / 连字符 / 重复下划线统一为 snake_case', () => {
    expect(normalizeRelationType('  Works  At  ')).toBe('works_for');
    expect(normalizeRelationType('Derived-From')).toBe('derived_from');
    expect(normalizeRelationType('__causes__')).toBe('causes');
  });

  it('未知关系原样透传，且规范化幂等', () => {
    expect(normalizeRelationType('created_by')).toBe('created_by');
    const once = normalizeRelationType('Relates To');
    expect(once).toBe('relates_to');
    expect(normalizeRelationType(once)).toBe(once);
  });

  it('空值 ⇒ related_to（不产生空关系名）', () => {
    expect(normalizeRelationType('')).toBe('related_to');
    expect(normalizeRelationType('   ')).toBe('related_to');
  });
});

describe('parseEntityKind：从实体 ID 提取 kind', () => {
  it('`{domain}:{kind}:{slug}` 三段及以上可解析', () => {
    expect(parseEntityKind('acme:person:alice')).toBe('person');
    expect(parseEntityKind('acme:note:2026:q1')).toBe('note:2026');
  });

  it('旧式自由 ID 不可解析 ⇒ null（跳过端点校验）', () => {
    expect(parseEntityKind('alice')).toBeNull();
    expect(parseEntityKind('local:a')).toBeNull();
  });
});

describe('validateEdgeAgainstSchemas：写前本体校验', () => {
  it('已声明关系 + 端点匹配 ⇒ 通过', () => {
    const verdict = validateEdgeAgainstSchemas(CORE_EDGE_SCHEMAS, {
      type: 'works_for',
      from: 'acme:person:alice',
      to: 'acme:org:acme-inc',
    });
    expect(verdict.ok).toBe(true);
  });

  it('未知关系类型 ⇒ KG_INVALID_EDGE_TYPE', () => {
    const verdict = validateEdgeAgainstSchemas(CORE_EDGE_SCHEMAS, {
      type: 'invented_relation',
      from: 'acme:person:alice',
      to: 'acme:org:acme-inc',
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('KG_INVALID_EDGE_TYPE');
  });

  it('端点 kind 与 schema 不符 ⇒ KG_INVALID_EDGE_ENDPOINT', () => {
    const verdict = validateEdgeAgainstSchemas(CORE_EDGE_SCHEMAS, {
      type: 'works_for',
      from: 'acme:org:acme-inc',
      to: 'acme:person:alice',
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('KG_INVALID_EDGE_ENDPOINT');
      expect(verdict.detail).toMatchObject({
        side: 'from',
        expected: 'person',
      });
    }
  });

  it('`*` 端点约束放行任意 kind', () => {
    const verdict = validateEdgeAgainstSchemas(CORE_EDGE_SCHEMAS, {
      type: 'related_to',
      from: 'acme:org:x',
      to: 'acme:wiki:index',
    });
    expect(verdict.ok).toBe(true);
  });

  it('提交已声明实体种类时，未声明的 kind 跳过校验（wiki 页不被 note→note 误杀）', () => {
    const wikiLink = new Map(CORE_EDGE_SCHEMAS);
    wikiLink.set('wiki_link', {
      type: 'wiki_link',
      displayName: 'wiki_link',
      endpoints: { from: 'note', to: 'note' },
      direction: 'symmetric',
    });
    const edge = {
      type: 'wiki_link',
      from: 'acme:wiki:index',
      to: 'acme:wiki:guide',
    };
    // 不提供已知种类 ⇒ 严格按 note→note 判定 ⇒ 拒绝
    expect(validateEdgeAgainstSchemas(wikiLink, edge).ok).toBe(false);
    // 提供 entities.yaml 的 kind 集合（无 wiki）⇒ 跳过 ⇒ 放行
    const knownKinds = new Set(['note', 'person', 'project', 'topic']);
    expect(validateEdgeAgainstSchemas(wikiLink, edge, knownKinds).ok).toBe(
      true
    );
  });
});

describe('KnowledgeGraph：规范化 + 拒绝（集成）', () => {
  const graph = new KnowledgeGraph(':memory:');

  beforeAll(async () => {
    await graph.init();
  });

  afterAll(async () => {
    await graph.close();
  });

  it('别名与规范名落库后是同一种关系（检索对照）', async () => {
    const aliasEdge = await graph.addEdge({
      from: 'acme:person:alice',
      to: 'acme:org:acme-inc',
      type: 'works_at',
    });
    const canonicalEdge = await graph.addEdge({
      from: 'acme:person:bob',
      to: 'acme:org:acme-inc',
      type: 'works_for',
    });

    // 写入即规范名：两条边在库里同名（未规范化时这里是 works_at / works_for 各一条）
    expect(aliasEdge.type).toBe('works_for');
    expect(canonicalEdge.type).toBe('works_for');

    // 用规范名 / 别名 / 大小写任一写法查询都能召回两条（检索质量对照）
    for (const type of ['works_for', 'works_at', 'Works For']) {
      const hits = await graph.queryEdges({ type });
      expect(hits.map((e) => e.from).sort()).toEqual([
        'acme:person:alice',
        'acme:person:bob',
      ]);
    }
  });

  it('未注册 schema 时未知关系不拒写（自由抽取链路保持可用）', async () => {
    const edge = await graph.addEdge({
      from: 'acme:wiki:a',
      to: 'acme:wiki:b',
      type: 'invented_relation',
    });
    expect(edge.type).toBe('invented_relation');
  });

  it('注册 schema 后：未知关系类型被拒', async () => {
    const strict = new KnowledgeGraph(':memory:');
    await strict.init();
    strict.setEdgeSchemas(new Map(CORE_EDGE_SCHEMAS));

    expect(
      await codeOf(() =>
        strict.addEdge({
          from: 'acme:person:alice',
          to: 'acme:org:acme-inc',
          type: 'invented_relation',
        })
      )
    ).toBe('KG_INVALID_EDGE_TYPE');

    // 别名先规范化再校验 ⇒ 合法别名不被误拒
    const ok = await strict.addEdge({
      from: 'acme:person:alice',
      to: 'acme:org:acme-inc',
      type: 'works_at',
    });
    expect(ok.type).toBe('works_for');
    await strict.close();
  });

  it('注册 schema 后：端点 kind 不符被拒（非法关系不入库）', async () => {
    const strict = new KnowledgeGraph(':memory:');
    await strict.init();
    strict.setEdgeSchemas(new Map(CORE_EDGE_SCHEMAS));

    expect(
      await codeOf(() =>
        strict.addEdge({
          from: 'acme:org:acme-inc',
          to: 'acme:person:alice',
          type: 'works_for',
        })
      )
    ).toBe('KG_INVALID_EDGE_ENDPOINT');

    // 被拒的边确实没有落库
    expect(await strict.queryEdges({})).toEqual([]);
    await strict.close();
  });
});
