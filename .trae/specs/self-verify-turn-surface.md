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

# Spec：#4 自校验档的「生效面」补齐（turn 级意图 → 验证线路）

- **状态**：🟢 **P1 ~ P6 已落地（2026-11-15）**；默认关 ⇒ 运行时行为零变化
- **来源**：`dev_docs/20261114/今日计划-2026-11-14.md` §4.1 第 4 行（Reflection = 部分）
  ＋ `.trae/specs/default-off-switches-review-gates.md` §2 #11（`SELF_VERIFY_PATTERN` 三条件）
  ＋ `.trae/specs/pattern-wiring-closure.md`（接线与触发面已收口）
- **关联**：`pattern-executable-assembly.md`（`selectPattern` 单一事实源）· `online-quality-evaluation.md`（U4 复核器）· `long-task-routing.md`（PDCA 分流）
- **一句话**：把「verify 意图判定 → 验证线路配方应用 → 决策落盘」从 **PDCA 长任务闸门内** 提到 **每轮入口**；
  仍由 `SELF_VERIFY_PATTERN`（默认 `false`）门控 ⇒ 开关未开时行为零变化。

---

## 1. 现状取证（2026-11-15，只读）

| # | 事实 | 证据 |
|---|---|---|
| 1 | 装配与配方**都已就绪** | `self_verify` / `iterative_refine` → `route: 'verify'`，配方 `VERIFY_RECIPE` / `VERIFY_DEEP_RECIPE`（[patternAssembler.ts#L89-L132](file:///e:/PY/Documents/CODES/PY_APP/packages/query/src/query/patternAssembler.ts#L89-L132)） |
| 2 | 配方 → 验证器配置的换算函数已有 | `verifierConfigForRecipe`（[patternAssembler.ts#L308-L336](file:///e:/PY/Documents/CODES/PY_APP/packages/query/src/query/patternAssembler.ts#L308-L336)）：`blocking` ⇒ `{enabled:true, failClosed:true, maxCycles: 2 | 4}` |
| 3 | 验证器配置的应用/撤销点已有 | `TAORLoop.applyVerifierConfig` / `resetVerifierConfig`（[TAORLoop.ts#L317-L329](file:///e:/PY/Documents/CODES/PY_APP/packages/query/src/query/TAORLoop.ts#L317-L329)） |
| 4 | **生效面只有一条**：`selectPattern` 全仓 1 处调用，在 `maybeLaunch`（PDCA 长任务升级闸门）内 | [pdcaLaunch.ts#L388-L445](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/manager/pdcaLaunch.ts#L388-L445)；`maybeLaunch` 仅由长任务升级/门面调用（[streamFinalize.ts#L421-L438](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/manager/streamFinalize.ts#L421-L438) · [longTaskEscalation.ts#L36-L44](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/longTaskEscalation.ts#L36-L44)） |
| 5 | **观测面同窄**：`pattern/decision` 也只在该块落盘，且 `site` 是闭集 `'research_dispatch'` | 写入 [pdcaLaunch.ts#L450-L470](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/manager/pdcaLaunch.ts#L450-L470)；契约 [eventPayloads.ts#L804-L817](file:///e:/PY/Documents/CODES/PY_APP/packages/service/src/session/types/eventPayloads.ts#L804-L817)；镜像 [events.ts#L595-L602](file:///e:/PY/Documents/CODES/PY_APP/client/src/types/events.ts#L595-L602) |
| 6 | **实测样本 = 0** | 本机 `~/.pyapp/data/sessions` 118 份 `events.jsonl` / 162.1 MB ⇒ 真实 `pattern/decision` 事件 **0 条**（唯一文本命中是某 `tool/result` 里 grep 出的源码片段） |
| 7 | 意图判定已存在但只被那一处调用 | `hasVerifyIntent`（[taskIntent.ts#L191-L196](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/taskIntent.ts#L191-L196)）、`hasRefineIntent`（同文件 `:207`） |

**结论**：审计表记「默认关 ⇒ 未生效」**只对了一半** —— 真正的问题是**生效面与观测面都挂在 PDCA 闸门上**：
普通轮说「先自检再输出」时既不判定、不应用配方、也不落决策。**翻默认值解决不了它。**

---

## 2. 目标 / 非目标

**目标（可验证）**
- **G1 生效面**：`SELF_VERIFY_PATTERN=true` 时，**任意轮**命中 verify/refine 意图 ⇒ 本轮 TAOR 回合判定按验证线路配方执行（`failClosed` + `maxCycles`）。
- **G2 撤销**：门控关闭（或本轮未命中）⇒ 对该会话**已存在**的循环 `resetVerifierConfig`，不残留上一轮档位（沿用 2026-11-03 既有语义）。
- **G3 观测**：命中时落 `pattern/decision`，`site='turn_dispatch'`，`featureGate.enabled` 取判定时刻真值 ⇒ 登记表判据①（`verify` 意图 ≥20 会话）**可量**。
- **G4 零行为变更**：`SELF_VERIFY_PATTERN=false`（默认）⇒ 不新建循环、不应用配方；除「命中意图时多一条 log-only 事件」外与今天逐字一致。

**非目标（明确不做）**
- **N1**：不改 `SELF_VERIFY_PATTERN` 默认值（翻转须 §2 #11 三条件 + 用户裁定）。
- **N2**：不改 `VerifierAgent` / `TAORLoop` 的判定语义（只喂既有配置）。
- **N3**：不新增 route / 不新增编排器（`self_verify` / `iterative_refine` 共用既有 `verify` route）。
- **N4**：不动 U4 空闲期复核器 `turnQualityReviewer`（它按轮抽样复核、写 `turn/quality`；本 spec 改的是**回合内判定策略**，两者语义不同）。
- **N5**：不做 A/B 试验框架、不新增计数器（观测复用既有事件）。
- **N6**：不新增事件类型（只扩 `site` 联合）。

---

## 3. 设计

### 3.1 新增纯函数模块 `app/src/chat/manager/verifyRecipeTurn.ts`

```
planTurnVerifyRecipe(text): TurnVerifyPlan | null
  ├─ hasVerifyIntent(text) || hasRefineIntent(text) 为 false ⇒ null（零开销，早退）
  ├─ selectPattern({ complexity:'complex', verify, refine })   ← 复用单一事实源
  ├─ instantiatePattern(selection)                              ← 复用装配入口
  ├─ route !== 'verify' 或 status !== 'ready' ⇒ { pattern, config: null }
  └─ config = verifierConfigForRecipe(recipe), gate = resolveFeatureGate(flag)
```

```
applyTurnVerifyRecipe(ports, sessionId, text): { applied, reset, decision? }
  ├─ plan === null ⇒ { applied:false, reset:false }（不落事件）
  ├─ plan.gate === true && plan.config ⇒ ports.getOrCreateTAORLoop(sid).applyVerifierConfig(config)
  └─ plan.gate === false ⇒ ports.resetVerifierConfigIfActive(sid)   ← 只对已有实例，不新建
```

`ports` 复用既有门面端口（`getOrCreateTAORLoop` / `resetVerifierConfigIfActive`，见 [facadeWiring.ts#L644-L647](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/manager/facadeWiring.ts#L644-L647)），不新增依赖。

### 3.2 接线（两处入口，一个实现）

| 入口 | 落点 | 时机 |
|---|---|---|
| 流式（客户端聊天主路径） | `runStreamMessage` 在 `prepareStream` 之后、互斥/预算准入之前 | 本轮用户文本 = `ctx.content` |
| 非流式 | `ChatOrchestrator.sendMessage` 在会话解析之后、互斥之前 | 本轮用户文本 = `safeContent` |

两处都只调 `host.applyVerifyRecipeForTurn(sessionId, text)`（宿主薄方法，实现落在 `ChatManager`，委托 3.1 模块）。

### 3.3 决策事件（唯一契约改动：`site` 联合新增 `'turn_dispatch'`）

- 落盘条数：**仅命中 verify/refine 意图时一条**（低频；未命中不写，避免每轮噪声）。
- 字段沿用现状（`selected` / `status` / `route` / `featureGate` / `applied`）。
- 同步三处：`eventPayloads.ts` 的 `site` 联合、`client/src/types/events.ts` 镜像、平齐测试用例；`ALL_SESSION_EVENT_TYPES` **不变**（无新类型）。

### 3.4 `pdcaLaunch` 收窄（同一事实不写两遍）

`maybeLaunch` 现有两块职责：研究分流 + 验证线路应用。3.2 生效后，验证线路在**轮首**已处理（同一 `lastUserContent` ⇒ 结论相同），故：

- 删除验证线路的 `applyVerifierConfig` / `resetVerifierConfigIfActive` 分支（**迁移**，非能力删除；按 `code-deletion.md` CD05 先在 spec 记录迁移依据）；
- `selectPattern` 调用只保留 `research`；决策落盘的触发条件收窄为 `researchIntent`（`site` 仍为 `'research_dispatch'`）。

> 收益：`selectPattern` 的语义分处不再重叠 —— 轮首管 verify/refine，PDCA 闸门管 research。

---

## 4. 分步落地

| 步 | 内容 | 验证 |
|---|---|---|
| P1 | 纯函数模块 + 单测（`planTurnVerifyRecipe` / `applyTurnVerifyRecipe`，注入假 ports） | 新用例全绿；既有 `patternAssemblerRecipe` / `taskIntent` 用例不动 |
| P2 | 事件契约：`site` 联合 + 客户端镜像 + 平齐测试 | `typecheck` 捕获漏改；平齐用例绿 |
| P3 | 流式接线（`runStreamMessage` → 宿主方法） | 单测覆盖「门控关 = 不建循环」；全量 `bun test` 无回归 |
| P4 | 非流式接线（`sendMessage`） | 同上 |
| P5 | `pdcaLaunch` 收窄 + 调整其单测（若有） | 既有分流用例绿（研究路径逐字不变） |
| P6 | 文档：登记表 §2 #11 备注写明「观测点 = `turn_dispatch`」；今日计划 §4.1 第 4 行状态更新 | `lint:doc-code` 绿 |

---

## 5. 验收

| 项 | 判据 |
|---|---|
| 意图未命中 | `planTurnVerifyRecipe` 返回 `null`，不建循环、不落事件 |
| 命中 + 门控关（默认） | `applied=false`、调用 `resetVerifierConfigIfActive`、事件 `featureGate.enabled=false` |
| 命中 + 门控开 | `applyVerifierConfig` 收到 `{enabled:true, failClosed:true, maxCycles:2}`；refine ⇒ `maxCycles:4` |
| 研究意图不受影响 | `maybeLaunch` 仍落 `site='research_dispatch'`；验证线路不再在该处重复应用 |
| 零行为变更 | 门控默认关时：无新增循环、无配方变化；全量 `bun test` 与基线同绿 |
| 突变验证 | 去掉门控判断 ⇒ 「门控关」用例必红；把 route 判断改成 `!== 'research'` ⇒ 应用用例必红 |
| 门禁 | `typecheck` · `lint` · `lint:arch` · `lint:state-ratchet`（新增枚举字面量按既有写法登记）· `bun test` |

---

## 6. 待裁定 / 已裁定

1. **已裁定（2026-11-15，用户）**：推进方式 = **补生效面**（而非只补观测面或只订正口径）。
2. **已裁定（2026-11-15，用户）**：按 spec 全量落地（P1 ~ P6），接受 `site` 新增 `'turn_dispatch'`。
3. **留待后续**：A/B 质量提升（判据②）与重试增量（判据③）—— 本 spec 只让 ①②③ 的**取材可跑**，不翻转默认值。
   - **订正（2026-11-16）**：默认值已由**用户裁定**翻转为 `true`（判据①②③ 均未达标，属**显式豁免**，非本 spec 所做）；回退 `FEATURE_SELF_VERIFY_PATTERN=false` 或设置页关闭。记录见 `default-off-switches-review-gates.md §2.4.3`。

---

## 7. 落地记录（2026-11-15）

| 步 | 落点 |
|---|---|
| P1 | `app/src/chat/manager/verifyRecipeTurn.ts`（`planTurnVerifyRecipe` / `applyTurnVerifyRecipe` / `buildTurnVerifyDecision` / `runTurnVerifyRecipe` / `applyTurnVerifyRecipeForHost`）＋ `app/tests/chat/verifyRecipeTurn.test.ts`（8 用例） |
| P2 | `eventPayloads.ts` `site` 联合 + `client/src/types/events.ts` 镜像（同批） |
| P3 | `streamMessageFlow.ts` 在 `prepareStream` 后调 `host.applyVerifyRecipeForTurn` |
| P4 | `ChatOrchestrator.sendMessage` 会话解析后调同一端口 |
| P5 | `pdcaLaunch.ts` 收窄：只留研究分流；`VerifierConfigSink` 与 `getOrCreateTAORLoop` / `resetVerifierConfigIfActive` 两个注入口随之删除（消费点已前移，`code-deletion.md` CD01~CD06 已核：全仓无其它消费方） |
| P6 | 登记表 §3-O5 口径订正；本 spec 状态更新 |

**装配位置（实测约束）**：端口实现在 `facadeWiring.ts` 装到宿主上（与 `_pdcaLaunch` 同法）——`ChatManager` 已 **1999 行**，直接加方法会触顶 R04-001（2000）；本方案使类本体**零增长**。

**实测**：新增 8 条单测全绿；全量 `bun test` **12,085 pass / 44 skip / 0 fail**（12,129 用例 / 1,465 文件）；`typecheck` 0 错；`lint` 0 error、`lint:arch` 无 ERROR、`lint:consts` / `state-ratchet` / `fn-size` / `size` / `doc-code` / `refs` / `unref` / `infra` / `invariants` / `fix-evidence` / `command-coverage` / `evals` / `scripts` 全绿。
**行为边界（如实）**：门控默认关 ⇒ 不建循环、配方不变；命中 verify/refine 意图时**多一条** log-only 事件（`turn_dispatch`）。
