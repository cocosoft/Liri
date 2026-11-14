/**
 * kg 最小本体层（D8，2026-11-14）
 *
 * 目标：在 **不引入图数据库** 的前提下，给 `kg_edges` 加一层**最小本体约束**：
 * 1. **关系类型规范化**：别名/大小写/空格/连字符统一到 `snake_case` 规范名
 *    （`works_at` → `works_for`）⇒ 同一事实只有一个关系名，检索不会因拼写漂移漏召回；
 * 2. **非法关系拒绝**：写边时按 schema 校验「关系类型存在」+「端点 kind 匹配」，
 *    不合法 ⇒ 抛 `KG_INVALID_EDGE_TYPE` / `KG_INVALID_EDGE_ENDPOINT`；
 * 3. **核心本体**（{@link CORE_EDGE_SCHEMAS}）作为最小可用集合：多数关系为 `*`（任意端点），
 *    只有语义上强约束的关系（如 `works_for: person → org`）才限定端点。
 *
 * 边界（如实）：
 * - **只在调用方 `setEdgeSchemas(...)` 后生效**：未注册 schema 的链路（自由抽取）保持
 *   既有行为（只做关系名规范化），不因本体缺失而拒写（CS03：不阻断主流程）；
 * - 端点校验要求实体 ID 可解析为 `{domain}:{kind}:{slug}`；**旧式自由 ID**（如 `alice`）
 *   解析不出 kind ⇒ 跳过端点校验（不误杀存量数据）；调用方提供「已声明实体种类」时，
 *   **未声明的 kind 同样跳过**（如 `wiki` 页对 `wiki_link: note → note` 的既有写入）；
 * - 关系名规范化**始终生效**（写入与查询同口径）；严格校验仅在 `setEdgeSchemas` 后生效；
 * - 不做推理（无传递闭包 / 无本体对齐），只做写入期校验与命名收敛。
 */

import type { EdgeSchema } from '@modules/knowledge/schema/SchemaLoader';

/** 任意端点（`EdgeSchema.endpoints` 的哨兵值） */
export const ANY_ENTITY_KIND = '*';

/**
 * 关系别名 → 规范名（**唯一事实源**）。
 *
 * 只收录"语义等价、纯拼写差异"的别名；有语义差异的（如 `part_of` vs `member_of`）不收。
 */
export const RELATION_ALIASES: Readonly<Record<string, string>> = {
  works_at: 'works_for',
  worksat: 'works_for',
  employed_by: 'works_for',
  is_a: 'subtype_of',
  is_part_of: 'part_of',
  mentions_entity: 'mentions',
  sameas: 'same_as',
};

/** 关系名规范化（纯函数；空值 ⇒ `related_to`） */
export function normalizeRelationType(raw: string): string {
  const base = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!base) return 'related_to';
  return RELATION_ALIASES[base] ?? base;
}

/** 从实体 ID 提取 kind（与 `KnowledgeGraph.parseEntityId` 同口径；不可解析 ⇒ null） */
export function parseEntityKind(entityId: string): string | null {
  const parts = String(entityId ?? '').split(':');
  if (parts.length < 3) return null;
  return parts.slice(1, -1).join(':') || parts[1] || null;
}

function schema(
  type: string,
  from: string,
  to: string,
  direction: 'directed' | 'symmetric' = 'directed'
): EdgeSchema {
  return {
    type,
    displayName: type,
    endpoints: { from, to },
    direction,
  };
}

/**
 * 最小核心本体（10 种关系）。
 *
 * 与 `SchemaLoader` 的域 schema **同形**（`EdgeSchema`）⇒ 调用方可用
 * `graph.setEdgeSchemas(CORE_EDGE_SCHEMAS)` 直接启用严格模式；
 * 域 schema 优先（更具体），本表只作最小可用集与示例。
 */
export const CORE_EDGE_SCHEMAS: ReadonlyMap<string, EdgeSchema> = new Map([
  ['related_to', schema('related_to', ANY_ENTITY_KIND, ANY_ENTITY_KIND)],
  ['part_of', schema('part_of', ANY_ENTITY_KIND, ANY_ENTITY_KIND)],
  ['subtype_of', schema('subtype_of', ANY_ENTITY_KIND, ANY_ENTITY_KIND)],
  ['mentions', schema('mentions', ANY_ENTITY_KIND, ANY_ENTITY_KIND)],
  ['depends_on', schema('depends_on', ANY_ENTITY_KIND, ANY_ENTITY_KIND)],
  ['derived_from', schema('derived_from', ANY_ENTITY_KIND, ANY_ENTITY_KIND)],
  ['causes', schema('causes', ANY_ENTITY_KIND, ANY_ENTITY_KIND)],
  ['located_in', schema('located_in', ANY_ENTITY_KIND, ANY_ENTITY_KIND)],
  ['same_as', schema('same_as', ANY_ENTITY_KIND, ANY_ENTITY_KIND, 'symmetric')],
  // 唯一强约束：任职关系必须 person → org
  ['works_for', schema('works_for', 'person', 'org')],
]);

export type OntologyViolationCode =
  | 'KG_INVALID_EDGE_TYPE'
  | 'KG_INVALID_EDGE_ENDPOINT';

export type OntologyCheckResult =
  | { ok: true; type: string }
  | {
      ok: false;
      code: OntologyViolationCode;
      message: string;
      detail: Record<string, unknown>;
    };

/**
 * 写边前的本体校验（**纯函数**）。
 *
 * @param schemas 已注册的关系 schema（域 schema 或 `CORE_EDGE_SCHEMAS`）
 * @param input   `type` 应已规范化（调用方先 `normalizeRelationType`）
 * @param knownKinds 已声明的实体种类（来自 `entities.yaml`）。**提供时**：端点实际 kind
 *   不在该集合内 ⇒ 跳过该侧校验（如 wiki 页 ID 为 `domain:wiki:*`，而 edges.yaml 的
 *   `wiki_link` 声明 `note → note`；不跳过会误杀既有写入链路）。缺省 ⇒ 校验所有可解析 kind。
 */
export function validateEdgeAgainstSchemas(
  schemas: ReadonlyMap<string, EdgeSchema>,
  input: { type: string; from: string; to: string },
  knownKinds?: ReadonlySet<string>
): OntologyCheckResult {
  const { type, from, to } = input;
  const declared = schemas.get(type);
  if (!declared) {
    return {
      ok: false,
      code: 'KG_INVALID_EDGE_TYPE',
      message: `未知的关系类型 "${type}"，已知类型: ${Array.from(schemas.keys()).join(', ')}`,
      detail: { type, knownTypes: Array.from(schemas.keys()) },
    };
  }

  const expectedFrom = declared.endpoints?.from ?? ANY_ENTITY_KIND;
  const expectedTo = declared.endpoints?.to ?? ANY_ENTITY_KIND;
  const actualFrom = parseEntityKind(from);
  const actualTo = parseEntityKind(to);

  const mismatch = (side: 'from' | 'to', expected: string, actual: string) => ({
    ok: false as const,
    code: 'KG_INVALID_EDGE_ENDPOINT' as const,
    message: `关系 "${type}" 的 ${side} 端点类型不匹配：期望 ${expected}，实际 ${actual}`,
    detail: { type, side, expected, actual },
  });

  const checkable = (actual: string | null): actual is string =>
    actual !== null && (!knownKinds || knownKinds.has(actual));

  if (
    expectedFrom !== ANY_ENTITY_KIND &&
    checkable(actualFrom) &&
    actualFrom !== expectedFrom
  ) {
    return mismatch('from', expectedFrom, actualFrom);
  }
  if (
    expectedTo !== ANY_ENTITY_KIND &&
    checkable(actualTo) &&
    actualTo !== expectedTo
  ) {
    return mismatch('to', expectedTo, actualTo);
  }
  return { ok: true, type };
}
