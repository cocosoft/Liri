# Spec：编排模式可见性（PC-6）

> 版本 1.0 ｜ 创建 2026-10-07 ｜ 状态：🟢 **已实施（2026-10-07）**
> 来源：台账 `dev_docs/任务计划-20261004.md` §28.3 **PC-6**（外部报告 Plan §三-2；登记于 §27.3/§27.5 的 client 侧缺口族）
> 关联规则：GR15（Spec-Driven，本项含 **API 变更**）/ GR01（基础设施复用）/ CS01（归一化）/ CS03（回退最小化）/ CS02 / R06-008（分层）
> 关联文档：`.trae/docs/api-spec.md` **§3.29.1**（新端点）；`scripts/modules-to-layers.json`（分层事实源）

---

## 1. Problem Statement（回仓取证，2026-10-07 实测）

| # | 事实 | 证据 |
|:-:|---|---|
| 1 | 后端**已有**完整的编排模式层：注册表 5 个 pattern（含 `displayName` / `when` / `roles` / `assembly` 绑定） | `core/patterns/PatternRegistry.ts:17-116` |
| 2 | 选择层只产出 1 个（`complex && research ⇒ competitive_strategy`），其余如实 `null` | `core/patterns/PatternSelector.ts:52-64` |
| 3 | 装配层把 `assembler` 解析为**可执行路由**或**显式 unavailable + 原因** | `query/patternAssembler.ts:94-102`（`ASSEMBLER_SPECS` `:76-87`） |
| 4 | 该层**已接主链**（研究分流消费 `selectPattern` + `instantiatePattern`） | `chat/ChatManager.ts:3693-3703` |
| 5 | **但前端完全看不到** —— `client/src` 对 `pattern` **0 命中**（模式名 / 装配状态 / 未接线原因均不可见） | 台账 §27.3-PC-6（`grep pattern client/src`） |

⇒ **缺口定性**：不是"没有功能"，而是**没有可见性**（与 §2.2-P1-13 的"**触发面/可达性**"是**两件事**）。
用户/开发者无法回答："本应用有哪些编排模式？哪条已接线？哪条没有、为什么？"

---

## 2. 设计约束（先于方案）

- **不新增判定**：可见性必须**复用**既有唯一事实源（注册表 + `instantiatePattern`），**不得**在展示层另写一套"某模式是否可用"的判断（CS01）。
- **如实呈现 `unavailable`**：未接线**不是缺漏**（无运行时 / 无触发场景 / 运行时由别处独立驱动）⇒ 必须**原样**展示后端的 `reason`，**禁止**改写成更"好看"的说法（CS06 / 项目"不粉饰"约定）。
- **不引 app 类型进服务层端口**（`R00-001` 连类型导入也计）⇒ 端口给**结构镜像 DTO**（沿 `queryOpsPorts.ts` 既有约定）。
- **CS03**：纯只读；无开关、无回退分支；失败**不静默**降级为空清单。
- **层序**：`core`（注册表）→ `app`（目录合成）→ `service`（端口转调）→ `service`（HTTP handler）—— 逐跳合法；**infra 不直连 app**（走端口，避免新增动态跨层盲点）。

---

## 3. 裁定点（用户裁定，2026-10-07）

| ID | 决策项 | 选项 | 定论与理由 |
|:--:|---|---|---|
| **D1** | 「可视化」的对象 | (a) 本轮模式徽标（最小）／(b) **模式清单（全量可见性）**／(c) 两者 | **(b)** —— 用户裁定：清单能实质回答"有哪些 / 哪条通"，且如实含 `unavailable`；本轮徽标增益小（PDCA 卡片已有「研究模式」文案） |
| **D2** | 清单入口位置 | (a) **会话检查器面板（ChatInspector）**／(b) 设置页能力分区／(c) PDCA 抽屉 | **(a)** —— 用户裁定：与 `ContextTab` / `LogTab` 并列的新 Tab，属"查看本应用机制"的既有归口 |

---

## 4. 方案

```text
前端  ChatInspector「模式」Tab（PatternsTab.tsx）
        └─ patternService.list()（services/planService.ts）
              └─ GET /v1/patterns（api-spec §3.29.1）
                    └─ plan-flow-routes.ts（编排域分发）→ plan-flow-handlers.ts#handleListPatterns
                          └─ getCoreAPI().getQueryOpsPort().listOrchestrationPatterns()   ← 服务层端口（结构镜像 DTO）
                                └─ domainSnapshotOps.ts：转调 app 侧纯函数
                                      └─ query/patternAssembler.ts#listPatternCatalog()   ← 唯一合成点
                                            ├─ core/patterns#listPatterns()（注册表）
                                            ├─ core/patterns#resolvePattern(name)（PatternSelection 唯一构造点）
                                            └─ 本文件#instantiatePattern()（装配状态）
```

**落点**

| # | 文件 | 改动 |
|:-:|---|---|
| 1 | `core/patterns/PatternSelector.ts` | 新增 `resolvePattern(name)`（`PatternSelection` **唯一构造点**；闭集名重载 ⇒ 非可选） |
| 2 | `core/index.ts` | 转出 `resolvePattern` |
| 3 | `query/patternAssembler.ts` | 新增 `PatternCatalogEntry` + **纯函数** `listPatternCatalog()`（注册表 + 装配状态合成） |
| 4 | `query/index.ts` | 转出 ③（值 + 类型） |
| 5 | `runtime/api/queryOpsPorts.ts` | 新增 `OrchestrationPatternDto`（**结构镜像**）+ `QueryOpsPort.listOrchestrationPatterns()` |
| 6 | `runtime/api/domainSnapshotOps.ts` | 实现端口（`queryModule()` 懒加载转调，不复制判定） |
| 7 | `infrastructure/http/handlers/plan-flow-handlers.ts` | 新增 `handleListPatterns`（只读；`{ patterns }`） |
| 8 | `infrastructure/http/handlers/routes/plan-flow-routes.ts` | 新增 `GET /v1/patterns` |
| 9 | `.trae/docs/api-spec.md` | 新增 **§3.29.1**（含响应示例与"`unavailable` 非缺漏"语义） |
| 10 | `client/src/services/planService.ts` | 新增 `OrchestrationPattern` 类型 + `patternService.list()` |
| 11 | `client/src/stores/chatInspectorStore.ts` | `InspectorTab` 增 `"patterns"`（含 `VALID_TABS` 旧值防护） |
| 12 | `client/src/components/ChatInspector/PatternsTab.tsx` | **新建**：只读清单（显示名 / 模式名 / 状态徽标 / 适用场景 / 未接线原因 / 角色绑定可展开） |
| 13 | `client/src/components/ChatInspector/ChatInspector.tsx` | `TABS` + `TabContent` 接入 |
| 14 | `client/src/i18n/locales/{zh,en}.ts` | `chatInspector.tabPatterns` + 9 个 `patterns*`（**双语同批**） |
| 15 | `app/tests/query/patternCatalog.test.ts` | **新建 5 例**（覆盖完整 / 字段齐备 / 状态自洽 / 冻结接线实况 / 返回副本） |

---

## 5. 验收

| 项 | 标准 |
|---|---|
| 可见性（P1） | `GET /v1/patterns` 返回**全部** pattern（数量 = 注册表），含 `displayName` / `when` / `roles` / `bindings` / `status`（+`route`/`reason`） |
| 如实性（P2） | `unavailable` 条目带**非空** `reason` 且 `route` 缺省；前端原样展示，不改写 |
| 单一事实源（P3） | 装配状态**只**来自 `instantiatePattern`；全仓无第二处"模式可用性"判定 |
| 分层（P4） | infra **不**直接 import app；经服务层端口（`lint:arch` 违规 0，动态跨层引用计数**不增**） |
| 前端可达（P5） | `client/src` 对 `pattern` **不再 0 命中**；检查器出现「模式」Tab 并能渲染清单/错误态 |
| 回归 | `typecheck`（app+client）0 · 改动文件 `eslint` 0 · `lint:arch` 不新增违规 · `lint:size` 回基线 · 全量 `bun test` / `vitest` 0 fail |

---

## 6. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行（API 变更）；D1/D2 由用户裁定 |
| **GR01 基础设施复用** | ✅ 复用注册表 + `instantiatePattern` + 既有 `QueryOpsPort` 端口 + 既有 `plan-flow-routes` 域分发；**不新建**服务/路由框架 |
| CS01 归一化 | ✅ 模式可用性判定**唯一**在 `instantiatePattern`；`PatternSelection` 构造收敛到 `resolvePattern`（消除第二处手工拼装） |
| CS03 回退最小化 | ✅ 只读、无开关；失败显式报错（不静默空清单） |
| CS02 状态判定 | ✅ `status: 'ready' \| 'unavailable'` 为**结构化枚举**，非文案匹配 |
| CS06 证据驱动 | ✅ §1 逐条 file:line；未接线原因**原样透传** |
| R06-008 分层 | ✅ core → app → service 逐跳合法；infra 经端口取 app 能力 |

---

## 7. 风险与边界（如实）

1. **本项只解决"可见性"**：不改变任何选择/装配行为；`unavailable` 的 3 个 pattern **仍然**不可达（受 N4「无触发场景」约束，见台账 §26.5-P26-4）—— 本 spec **不**声称已接通。
2. **清单是全局的、非会话级**：放在会话检查器面板（用户裁定 D2）⇒ 与"当前会话用了哪个模式"无关（后者属 D1-a 本轮徽标，**本批未做**）。
3. **`reason` 为技术性中文文案**：来自装配层自陈，按"不粉饰"原样展示；若需面向小白改写，属**另议**（可能违背 CS06 如实性，需显式决策）。
4. **端口 DTO 为结构镜像**：与 app 层 `PatternCatalogEntry` 字段同名同义（`route` 收敛为 `string`）—— 沿本仓端口既有约定；字段漂移由 `typecheck` 结构性校验兜住（返回处赋值）。

---

## 8. 实施记录（2026-10-07）

**落点（实测）**：与 §4 表逐条一致，无偏离。

**门禁（全绿）**：`typecheck`（app + client）**0** · 改动文件 `eslint` **0** · `lint:arch` **违规 0 / 警告 4（基线）· 重复实现 0 · 动态跨层引用 41（未增）** · `lint:size` **0 错 / 470 警告 / 8 例外（基线）** · `lint:doc-code` **18 断言一致** · 全量 `bun test`（app）**512 files / 4814 pass / 21 skip / 0 fail**（+1 文件 / +5 例）· `vitest`（client）**60 files / 521 pass**（含 i18n 双语 parity）。

**遗留（明确，未做）**：
- **不做** D1-c 的"本轮模式徽标"（`pdca:auto_launched` 载荷加 `pattern` 字段）；
- **不做** `unavailable` 三个 pattern 的接线（受 N4 约束，非本项范围）；
- **未做真机端到端**：本批为单元/集成级（纯函数 + 端口 + 路由 + 前端 Tab），**未**在运行中的应用点开「模式」Tab 目视确认（如实登记，非声称已验）。
