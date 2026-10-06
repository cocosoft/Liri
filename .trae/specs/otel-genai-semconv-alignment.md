# Spec：OTel GenAI 语义约定对齐（**并存新增 `gen_ai.*`**）—— 论文 A4

> 版本 1.0 ｜ 创建 2026-10-06 ｜ 状态：🟡 **分批实施** —— **T1/T2 已实施（2026-10-06，并存新增）**；**T3（改名）/T4（provider 与内容）待裁定**
> **来源**：`dev_docs/papers/精读笔记-优先级论文-2026-10-06.md` 行动 **A4**；依据 `dev_docs/papers/notes/otel-genai-semconv.md` §3.2（span 命名）、**§4.1（推理 span 属性表）**、§3.3/§3.4（枚举）、§5（指标）
> **关联规则**：GR15 · GR01 · CS01 · CS03 · **model-usage.md（禁止硬编码供应商名）** · §1.2
> **前置**：`.trae/specs/llm-request-otel-span.md`（LLM 请求 span 的既有实现）
> **口径**：下列 `file:line` 为 **2026-10-06 实测**。

---

## 0. 一句话

Liri 的 tracing **自带命名空间**（`Liri.*` 属性 / `Liri.*` span / `Liri.*` 指标），与 OTel 的 `gen_ai.*` 语义约定**不通**。本批按论文建议**"先新增、后改名"**：只在 LLM 请求 span 上**并存写入** `gen_ai.*` 属性，**不动**任何既有名。

---

## 1. 取证（2026-10-06）

**Liri 自有命名面（仅计数，不全列）**
| 面 | 位置（示例） |
|---|---|
| span 名 `Liri.interaction` / `Liri.llm_request` / `Liri.tool` | `monitoring/tracing/SessionTracing.ts:184,269,389` |
| span 覆盖去重键（**字面量依赖**） | `SessionTracing.ts:264,272,385,392` |
| 属性 `Liri.model` / `Liri.session_id` / `Liri.input_tokens` …（12 个） | `core/SessionSpanTracer.ts:22-33` |
| 指标 `Liri.cost.total` / `Liri.tokens.*` / `Liri.requests.total` … | `cost/CostMetricsBridge.ts:108-254` |
| 指标 `Liri.permission.denials/decisions/role_denies` | `permission/trackers/DenialTracker.ts:151`、`permission/PermissionManager.ts:372,413` |

**OTel 要求（推理 span）**：`Required` = `gen_ai.operation.name`、`gen_ai.provider.name`；`Conditionally Required` 含 `gen_ai.request.model`、`gen_ai.conversation.id`、`error.type`；`Recommended` 含 `gen_ai.usage.input_tokens` / `output_tokens`；`Opt-In`（**默认不采**）= `gen_ai.input.messages` / `output.messages` / `system_instructions` / `tool.definitions`；span 名 SHOULD = `{gen_ai.operation.name} {gen_ai.request.model}`。

**净增量**
| # | 缺口 | 本批处置 |
|:--:|---|---|
| **G1** | LLM 请求 span 无 `gen_ai.operation.name` / `gen_ai.request.model` | ✅ **T1**（`model` 与 operation 在此**可得**） |
| **G2** | 用量无 `gen_ai.usage.input_tokens` / `output_tokens`（规范：input SHOULD 含 cache 读写、output SHOULD 含 reasoning） | ✅ **T2**（`endLLMRequestSpan` 已有 token 元数据） |
| **G3** | 无 `gen_ai.provider.name`（**Required**） | ⏸ **T4** —— 该调用点**不透传 provider**（`startLLMRequestSpan(model, options?)` 仅 model/querySource/fastMode）⇒ 需调用方透传 + **OTel 枚举映射**；而枚举是**供应商名硬编码**，与 `model-usage.md` 红线冲突 ⇒ 须先定"映射表归属（协议适配白名单 or DB `capabilities`）" |
| **G4** | 无 `gen_ai.conversation.id` | ⏸ **T4** —— 同上，需 session id 透传 |
| **G5** | span 名仍为 `Liri.llm_request` | ⏸ **T3** —— 改名会**同批**影响覆盖去重键（4 处字面量）与客户端 trace UI + 单测 ⇒ 须整批改 |
| **G6** | 指标仍为 `Liri.tokens.*` | ⏸ **T3** |

**CS01 归一化**：全仓 `gen_ai.` **0 命中** ⇒ 净增量；`gen_ai.*` 字段名**逐字**取自 note §4.1/§3.x（**不臆造**）。

---

## 2. 目标 / 非目标

**目标**
- **G-a（T1）**：`startLLMRequestSpan` 在 span 创建时**并存**写入 `gen_ai.operation.name = 'chat'`、`gen_ai.request.model = <model>`。
- **G-b（T2）**：`endLLMRequestSpan` 在结束时就 token 元数据**并存**写入 `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens`。

**非目标**
- **N1** **不改**任何既有名：span 名、`Liri.*` 属性、`Liri.*` 指标、覆盖去重键 —— **一律不动**（T3 另批）。
- **N2** **不采集内容**（`gen_ai.input.messages` / `output.messages` / `system_instructions` / `tool.definitions` 属 Opt-In，默认不采 ⇒ **不实现即合规**）。
- **N3** 不新增 `gen_ai.*` **指标**（T3）。
- **N4** 不引入 provider→枚举映射表（T4，见 G3 的红线冲突）。
- **N5** 不改 `SessionSpanTracer` 的 12 个 `Liri.*` 属性常量。

---

## 3. 设计

### 3.1 T1（span 创建时）
```ts
attributes['gen_ai.operation.name'] = 'chat';        // §3.3 枚举原值（推理对话）
attributes['gen_ai.request.model'] = model;          // §4.1 Conditionally Required
```
> 与 §4.1"采样相关属性 SHOULD 在 **span 创建时**提供"一致（`operation.name` / `request.model` 已就位）。

### 3.2 T2（span 结束时）
```ts
span.setAttribute('gen_ai.usage.input_tokens', metadata.inputTokens);   // 与 llm_request.input_tokens 并存
span.setAttribute('gen_ai.usage.output_tokens', metadata.outputTokens);
```

---

## 4. 决策点

| ID | 决策项 | 选项 | 采纳 / 状态 |
|:--:|---|---|---|
| **D1** | 改名策略 | (a) **先新增并存，改名后置**／(b) 本批直接改名 | **(a) 已采纳** —— 论文建议 + 改名牵连覆盖键/客户端 UI/单测，风险不对称 |
| **D2** | 内容类属性 | (a) **默认不采（合规）**／(b) 本批实现 opt-in | **(a) 已采纳** —— 规范默认即不采；U 系列要求"内容默认 opt-in"，**不实现即合规** |
| **D3** | `gen_ai.provider.name` 如何取 | (a) 调用方透传 + 映射表／(b) 从 DB `capabilities` 派生 | ⏸ **待裁定** —— (a) 涉**硬编码供应商名**（`model-usage.md` 红线）；(b) 需先确认 DB 是否已有可映射字段 |

---

## 5. 任务分解

| # | 步骤 | 状态 |
|:--:|---|---|
| **T1** | `SessionTracing.startLLMRequestSpan` 并存写 `gen_ai.operation.name` / `gen_ai.request.model` | ✅ 已实施 |
| **T2** | `SessionTracing.endLLMRequestSpan` 并存写 `gen_ai.usage.input_tokens` / `output_tokens` | ✅ 已实施 |
| **T3** | span 名与 `Liri.*` 指标**改名**（同批改覆盖去重键 4 处 + 客户端 trace UI + 单测） | ⏸ 待裁定 |
| **T4** | `gen_ai.provider.name` / `gen_ai.conversation.id`（须调用方透传 + D3 决策） | ⏸ 待裁定 |

---

## 6. 验收（T1/T2，可证伪）

1. `bun run typecheck` → **0**；`bun run lint:arch` → **错误 0**（警告回基线）；
2. **并存**：span 上 `llm_request.input_tokens` 与 `gen_ai.usage.input_tokens` **同值齐在**（旧属性**未消失**）；
3. **未改名**：`grep -n "startSpan('Liri.llm_request'"` 仍 **1 命中**；4 处覆盖键字面量**逐字未变**；
4. `grep -rn "gen_ai\." app/src` 命中**仅**本批 4 个字段名（无第 5 个臆造字段）；
5. 全量 `bun test` → **0 fail**（当前基线：**4644 pass / 21 skip / 0 fail / 4665 tests / 492 files**）。

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| **GR15** | ✅ 先 spec；D1/D2 已采纳、D3 待裁定 |
| **GR01** | ✅ 只改既有 span 属性写入点，**不新增**模块/依赖 |
| **CS01** | ✅ `gen_ai.` 全仓 0 命中 ⇒ 净增量；字段名逐字取自 note |
| **CS03** | ✅ 不做"以防万一"的 provider 猜测（缺失即**不写**，不填假值） |
| **CS04** | ✅ 无任何 Mock/占位取值 |
| **CS06** | ✅ 每个字段名附 note 出处；（**未证实**者如 Retrieval/Memory 属性**不采用**） |
| **model-usage.md** | ✅ **未**硬编码任何供应商名（provider 相关一律 T4 待裁定） |
| **§1.2** | ✅ 改动文件均已有 MIT 头 |

---

## 8. 未取证（如实）

| # | 项 | 说明 |
|:--:|---|---|
| **U1** | 采集器/后端能否识别 `gen_ai.*` | 本批只**写**属性，**未验证**任一 OTel 后端（Jaeger/Tempo…）能正确解析 |
| **U2** | 与既有 `Liri.*` 的**双写开销** | 未测量（多 4 个属性，量级极小） |
| **U3** | `gen_ai.operation.name` 取值是否正确 | Liri 同时含 chat/embedding/工具等路径；本批**仅**在 LLM 请求 span 写 `'chat'`（该 span 确为对话推理）；embedding 路径未接入 |
| **U4** | note 的 `Recommended` 行（§4.1 line 65） | 原文该行被抓取工具省略 ⇒ 本批**未**据其增补 `temperature`/`max_tokens` 等属性 |

---

## 9. 实施记录

| 日期 | 事件 | 详情 |
|---|---|---|
| 2026-10-06 | **立项 + T1/T2 实施** | 用户「继续处理 A4、A5 与 A6」⇒ 在 `SessionTracing` 的 LLM 请求 span 上**并存新增** 4 个 OTel `gen_ai.*` 属性（`operation.name` / `request.model` / `usage.input_tokens` / `usage.output_tokens`），**零改名**；T3/T4 待裁定（D1=a/D2=a/D3=待裁定）。验证见 §6 |
| 2026-10-06 | **验证（四证）** | `typecheck` **0** · `eslint` **0** · `lint:arch` **错误 0 / 警告 4（基线）**、分层 **3886 不变** · **并存实证**：`gen_ai.` 命中**恰为本批 4 个字段**（`SessionTracing.ts:259/260/334/339`，**无第 5 个臆造字段**），且 `startSpan('Liri.llm_request'` 仍 **1 命中**（**未改名**）· 全量 **4644 pass / 21 skip / 0 fail**（4665 tests / 492 files，与基线**逐数一致**） |
