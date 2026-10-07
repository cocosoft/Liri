# Spec：文档路径引用卫生（歧义基名必须带模块根）（R12-2）

> 版本 1.0 ｜ 创建 2026-10-07 ｜ 状态：🟢 **已实施（2026-10-07）** —— 约定 + 12 处修正；**不新增门禁**
> 来源：台账 `dev_docs/任务计划-20261004.md` §25.4 **R12-2**（报告 12 §五-P2；首例已见 §14.7-DR-2 / §24.3）
> 关联规则：GR15 / **CS01（归一化）** / **CS03（回退最小化）** / CS06（证据驱动）· 关联：`.trae/rules/development-workflow.md` **§2.7**（引用卫生同族）
> 关联文档：`CHANGELOG.md`（DR-2 的起点：`PatternRegistry.ts` 曾被引成 `app/src/patterns/` —— **路径错误**，非仅缺根）

---

## 1. Problem Statement（回仓取证，2026-10-07 实测）

**原始诉求（报告 12 §2.2 偏差①）**：台账/报告里的路径引用**未带模块根**，导致 `PatternRegistry.ts:59-62` 这类引用**无法定位**（实测：真身在 `app/src/core/patterns/`，而 `app/src/patterns/` **不存在**）。

| # | 事实 | 证据 |
|:-:|---|---|
| 1 | **基名歧义是普遍现象**（同基名多文件） | `app/src` 实测：`index.ts` **418** 个 · `types.ts` **106** 个 · `UI.tsx` 48 · `prompt.ts` 37 · `monitor.ts` 27 · `constants.ts` 9 · `utils.ts` 7 · `config.ts` 7 · **`Tool.ts` 5** · **`PermissionContext.ts` 4** · **`PermissionManager.ts` 2** |
| 2 | **但"裸基名"多数不是引用** | committed 文档里的裸基名大量出现在**命名规范条文**中（如 `architecture-compliance.md:362/367` 讲"类型定义按领域命名：`types.ts`、`session.ts`"、禁止 `utils.ts` 当垃圾桶）⇒ **不得**一律补路径（否则改坏规则条文） |
| 3 | **真正的引用型裸基名集中在 `.trae/specs/`** | `app/docs/**` 扫描 ⇒ **0 命中**；`.trae/specs/**` ⇒ 本次定位并修正 **12 处**（§3） |
| 4 | **既有失败模式是"路径错误"而非仅"缺根"** | DR-2 为**错路径**；本次另发现 `a2a-external-exposure.md:14` 的链接指向 `app/src/agent/a2a/types.ts#L138` —— 该文件已由 **D-204（2026-10-01）** 降为 34 行**转出层**，`A2AAgentCard` 实际在 `app/src/types/a2a.ts:167` ⇒ **链接失效** |

## 2. 约定（可执行判据）

> **判据（唯一）**：形如「`<基名>.ts:<行号>`」的**引用**，若该基名在 `app/src` 内**不唯一**（同名 ≥ 2 文件）⇒ **必须带模块根**（如 `core/patterns/types.ts:16`）**或**给出可解析的 `file:///` 链接。
> **唯一基名可裸**（如 `agentCard.ts` / `PatternRegistry.ts` / `TraceWriter.ts` —— 实测各 **1** 个）；**命名示例 / 类别名 / `index.ts` 泛指**一律**保持裸**。

**为什么以"基名唯一性"为判据**（而非"一律带根"）：① 唯一基名带根徒增噪声、且改动面巨大（§1-1 有 418 个 `index.ts`）；② 真正的定位失败**只**发生在歧义基名上（§1-4 两例均为歧义/失效）。

**落点**：`.trae/rules/development-workflow.md §2.7`（引用卫生同族）增一行。

## 3. 本次修正清单（12 处，逐条附依据）

| # | 文件:行 | 前 | 后 | 依据 |
|:-:|---|---|---|---|
| 1 | `eval-security-injection-ab-gate.md:25` | `types.ts:39-46` | `evals/types.ts:39-46` | `AssertResult` 实测在 `evals/types.ts:34-46` |
| 2 | `orchestration-family-convergence.md:95` | `types.ts:43/45/47` | `core/patterns/types.ts:43/45/47` | 实测 `:43-47` = `PATTERN_PROVIDERS`（含 `result_aggregator`/`task_decomposer`） |
| 3 | `pattern-assembly-runtime.md:34` | `types.ts:16` | `core/patterns/types.ts:16` | 实测 `:16` = `'parallel_distributed'`（`PatternName`） |
| 4 | `pattern-assembly-runtime.md:35` | `types.ts:19` | `core/patterns/types.ts:19` | 实测 `:19` = `'self_verify'` |
| 5 | `trajectory-single-source-convergence.md:16` | `types.ts:26-62` | `trace-recording/types.ts:26-62` | 实测 `TraceRecord` 在 `trace-recording/types.ts:25-61` |
| 6 | `trajectory-single-source-convergence.md:183` | `types.ts:41,46` | `trace-recording/types.ts:41,46` | 实测 `:41/:46` = `request.headers` / `response.headers` |
| 7 | `data-contract-unification.md:72` | `Tool.ts:9` | `tools/types/Tool.ts:9` | 该 spec 自身§2 即写"`tools/types/**`"（同表内自证） |
| 8 | `data-contract-unification.md:236` | `PermissionContext.ts:23` | `tools/types/PermissionContext.ts:23` | 同上（同 spec §2.3 指 `tools/types/**`） |
| 9 | `non-idempotent-retry-approval.md:135` | `PermissionManager.ts:525-547` | `permission/PermissionManager.ts:525-547` | 同 spec §4 表全用 `permission/PermissionManager.ts`（歧义：另有 `security/PermissionManager.ts`） |
| 10 | `tool-name-wire-codec.md:126` | `PermissionManager.ts:508` | `permission/PermissionManager.ts:508` | 同行前半即写"权威判定面是 `permission/`" |
| 11 | `a2a-external-exposure.md:14` | 链接 `../../app/src/agent/a2a/types.ts#L138` | 链接 `../../app/src/types/a2a.ts#L167` | **失效链接**（D-204 后 `agent/a2a/types.ts` 仅 34 行转出层；`A2AAgentCard` 实测在 `types/a2a.ts:167`） |
| 12 | `data-contract-unification.md:74` | `types.ts:21` | `ai/models/types.ts:21` | 同行首格即 `ai/models/types.ts:277`（同文件自引；基名 `types.ts` 不唯一 ⇒ 按约定补根） |

**未改（如实）**：唯一基名裸引用（`agentCard.ts` / `PatternRegistry.ts` / `scorer.ts` / `scoring.ts` / `PatternSelector.ts` / `TraceWriter.ts` / `GoogleProvider.ts` / `initialStateCheck.ts` …）**按约定保持裸**；命名规范条文中的 `types.ts`/`utils.ts` 等**保持裸**。

## 4. 决策点

### D1：是否新增门禁？ —— **不新增**（建议已采纳）

| 选项 | 内容 | 判定 |
|---|---|---|
| (a) 新门禁：扫描"裸基名引用" | 需先判定"这是引用还是命名示例"—— **语义判断**，正则不可靠 ⇒ 会大面积误报（§1-2）；且 418 个 `index.ts` 无从展开 | ❌ |
| **(b)（采纳）** | **约定 + 一次性修正**；不新增门禁 | ✅ 与 R12-1 同判据（不可机械化的判据不做门禁） |
| (c) 复用 `lint:doc-code` | 该门禁设计**明确限定**"只登记已真实发生过的漂移点 + 高变更风险关键常量，不追求全覆盖"（脚本头注释）⇒ 塞入"全量路径扫描"**违背其设计约束** | ❌ |

> **可自动化的一小块（若将来需要）**：校验**所有 `file:///` 链接的路径存在**。本轮**不做**（无反复发生证据；且历史 spec 链接众多，纳入即需一次大清理 —— 属另一议题）。

## 5. 影响文件

| # | 文件 | 改动 |
|:-:|---|---|
| 1 | `.trae/rules/development-workflow.md` §2.7 | +1 行约定（§2） |
| 2 | 6 份 `.trae/specs/*.md` | 11 处引用修正（§3） |
| 3 | 本 spec | 取证 + 约定 + 清单 |

**零代码改动**。

## 6. 验收

- [x] 基名唯一性为**实测**（`Group-Object Name` 计数：`agentCard.ts`=1 · `PatternRegistry.ts`=1 · `types.ts`=106 · `Tool.ts`=5 · `PermissionContext.ts`=4 · `PermissionManager.ts`=2）。
- [x] 12 处修正**逐条附依据**（§3），且修正后路径**实测存在**（未重犯 DR-2 的"错路径"）。
- [x] 未误改命名规范条文（§1-2 / §3 末）。
- [x] 修正后 `.trae/specs/**` 内**不再有**歧义基名的裸引用（复扫验收）。
- [x] `lint:doc-code` 19 断言仍绿。

## 7. 合规检查清单

| 规则 | 判定 |
|---|---|
| **GR15**（Spec-Driven） | ✅ 本轮为文档改动，spec 记录取证/判据/清单 |
| **CS01**（归一化） | ✅ 判据统一为"基名唯一性"，不按文件逐个拍脑袋 |
| **CS03**（回退最小化） | ✅ **不新增门禁**（§4）；不做"全量链接校验"这类无证据的投机机制 |
| **CS06**（证据驱动） | ✅ 计数实测、行号逐条实测；**如实**标注"多数裸基名不是引用"（避免把问题说大） |
| **§3 外科手术式修改** | ✅ 只改**歧义基名**的**引用**；唯一基名与规则条文**不动** |

## 8. 风险与边界（如实）

1. **本约定靠人遵守**（非门禁）⇒ 不保证后续 100% 执行；理由见 §4。
2. **未做全量普查**：本轮扫描面 = `.trae/specs/**` + `.trae/rules/**` + `.trae/docs/**` + `app/docs/**` + `CHANGELOG.md`；`dev_docs/**`（台账与报告）**未逐条改** —— 台账为**未入库**工作稿，其引用已在 §24.3 记"首例"，后续编辑按本约定执行。
3. **链接失效未全量校对**：本轮只修**已发现的 1 处**（§3-11）；"所有 `file:///` 链接可解析"未纳入校验（§4 末）。
4. **历史 spec 的行号本就随代码漂移**：本约定只保证"**能定位到文件**"，不保证行号永久准确（那是另一议题，`memory/README.md` 已有"行号维护"同族提示）。

## 9. 实施记录

**2026-10-07（R12-2）**：约定成文（§2）+ 12 处修正（§3）+ 规则 §2.7 增一行；**零代码改动**，不新增门禁。
