# kg_edges 最小本体层（D8）

> 立项：2026-11-14（方案 `dev_docs/20261113/建议落地方案-20261114.md` §2 · D8）
> 约束：**不引入图数据库**（仍为 SQLite 单表 `kg_edges`）。

## 1. 目标

1. **关系名规范化**：同一事实只允许一种关系名，消除拼写漂移导致的漏召回。
2. **非法关系被拒**：写边时按已注册 schema 校验「关系类型存在」+「端点 kind 匹配」，不合法直接抛错，不静默入库。
3. **最小核心本体**：提供 10 种通用关系作为可用的最小集合（多数 `*` 任意端点，仅语义强约束者限定端点）。

## 2. 边界（如实）

| 项 | 口径 |
|---|---|
| 生效范围 | 规范化**始终生效**；严格校验**仅在调用方 `setEdgeSchemas(...)` 后**生效 |
| 未注册 schema | 只做规范化，不拒写（自由抽取 / 反哺链路不被本体缺失阻断，CS03） |
| 端点校验 | 必须能解析出 kind（`{domain}:{kind}:{slug}`）；**旧式自由 ID 跳过** |
| 已声明种类 | 调用方提交 `entityKinds` 时，**未声明的 kind 跳过端点校验** |
| 不做 | 无推理（传递闭包 / 本体对齐 / 规则引擎），无迁移，不改表结构 |

## 3. 为什么端点校验要跳过「未声明 kind」

默认 schema（`SchemaLoader.ensureDefaults` 播种）声明 `wiki_link: note → note`，而
`DreamGraphPhase` 写入的实体 ID 是 `domain:wiki:slug`（kind=`wiki`，不在 `entities.yaml` 的
note/person/project/topic 内）。若一律按 schema 拒绝，**autoDream 的 wiki 链建立会整体失败**。
⇒ 规则：**只对「已声明实体种类」的端点拒绝**；未声明 kind 视为「本体未覆盖」，放行（fail-open on unknown，
fail-closed on declared）。

## 4. 验收

| 验收项 | 落点 |
|---|---|
| 别名/大小写/空格/连字符 → 规范名；幂等；空值 ⇒ `related_to` | `ontology.test.ts` · `normalizeRelationType` |
| 未知关系类型 ⇒ `KG_INVALID_EDGE_TYPE` | `validateEdgeAgainstSchemas` + `addEdge` 集成 |
| 端点 kind 不符 ⇒ `KG_INVALID_EDGE_ENDPOINT`（且**不入库**） | 同上 |
| `*` 端点放行；自由 ID / 未声明 kind 跳过 | 同上 |
| **检索质量对照**：`works_at` 与 `works_for` 落库后同名，用任一写法查询都召回 2 条 | `KnowledgeGraph` 集成用例 |
| 未注册 schema ⇒ 未知关系不拒写 | `KnowledgeGraph` 集成用例 |

## 5. 实现落点

| 文件 | 变更 |
|---|---|
| `app/src/knowledge/graph/ontology.ts` | **新增**：`RELATION_ALIASES` / `normalizeRelationType` / `parseEntityKind` / `CORE_EDGE_SCHEMAS` / `validateEdgeAgainstSchemas` |
| `app/src/knowledge/graph/KnowledgeGraph.ts` | `addEdge` 先规范化再校验（非法抛 `AppError`，code 为 `KG_INVALID_EDGE_*`）；`queryEdges` 的 `type` 过滤同口径规范化；`setEdgeSchemas(schemas, entityKinds?)` |
| `packages/infra/src/chronos/autoDream/DreamGraphPhase.ts` | 注册 schema 时一并提交 `entities` 的 kind 集合（wiki 不被误杀） |
| `app/tests/knowledge/graph/ontology.test.ts` | **新增** 15 条用例（纯函数 + 集成） |

## 6. 已知迁移注意

- **存量行**未回填：历史边的 `edge_type` 保留原样（如 `works_at`）。用规范名查询**不会**召回它们；
  需要时执行一次性回填（`UPDATE kg_edges SET edge_type = <规范名>`），本次未做。
- **域 schema 若用别名原名声明**（如 `is_a`）会因规范化后查不到 schema 而被拒 ⇒ 域 schema 应直接声明规范名。
- `CORE_EDGE_SCHEMAS` 与其他 schema **同形**（`EdgeSchema`），可直接 `graph.setEdgeSchemas(CORE_EDGE_SCHEMAS)` 启用；它与默认域 schema 的 `relates_to` 不同名（前者 `related_to`），二者互不覆盖。
