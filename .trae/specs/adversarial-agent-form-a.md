# Spec：对抗 Agent 形态 A（LLM 攻击者 / 红队提案器）

> 版本 1.2 ｜ 创建 2026-10-04 ｜ 状态：✅ **已实施（确定性半 + LLM 提案器适配器；真实模型端到端待额度）**
> 来源：`dev_docs/20260926/liri-optimization-plan-20260926.md` **P1-1**（2026-09-28 用户裁定「形态 C」：先落机械攻击集 **B**，**A 另立 spec**）
> ＋ `dev_docs/20261001/pending-tasks-consolidated-20261001.md` **T-⑤01**（"对抗 Agent 形态 A 另立 spec：需额度 + 新 spec"）
> 前置已落地：形态 B = [`antiCheatAudit.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/evals/antiCheatAudit.ts)（**5 向量** + `tests/evals/antiCheatAudit.test.ts` **8 例**）
> 关联规则：GR15（Spec-Driven）/ **CS01**（归一化）/ **CS02**（状态判定）/ **CS03**（回退最小化）/ **CS04**（Mock 零容忍）/ **CS05**（根因优先）/ §1.6（模型可见 ⇔ 已落盘）/ §1.3（无兼容包袱）

---

## 0. 一句话

形态 B 把**已知**作弊手法做成机械向量（确定性、可门禁）；本 spec 处理它**结构上够不着的部分** ——
「**未知手法**由谁提出」。做法是引入一个 LLM 驱动的**红队提案器（proposal-only）**，但**裁决权仍归机械判据**：
LLM 只产出"待验证的攻击方案"，**确定性由执行/判定侧保证** ⇒ 提案器本身**不作门禁**、不引入不确定的通过/拒绝。

---

## 1. Problem Statement（取证，`file:line` 为 2026-10-04 实测）

### 1.1 形态 B 的能力与边界（已落地）

| 面 | 形态 B 现状 | 证据 |
|---|---|---|
| 定位 | **不是**"发现新漏洞的扫描器"，而是①配置一致性 ②已知边界显性化 ③挂载点 | `antiCheatAudit.ts:25-46` 头注 |
| 三态 | `blocked` / `exposed`（必挡未挡 ⇒ `--cheat-gate` 拒跑）/ `knownGap`（已登记、**不**参与 fail-closed） | `antiCheatAudit.ts:51`、`:90-96` |
| 覆盖 | **只覆盖已知手法**（其定义即如此，非缺陷） | `liri-optimization-plan` P1-1「未做④」 |
| 结论 | 「**未找到"未覆盖且可机械判定"的 must-block 缺口**」 | 同文件头注 + P1-1 落地前置事实 |

⇒ 形态 B 的风险面 = **未知手法**（既不在向量集内，也无机械判据可"直接"执行）。

### 1.2 决定性约束（四条，均来自既有取证，非本 spec 推断）

| # | 约束 | 依据 |
|:--:|---|---|
| a | 评测流水线的数据模型只有 **task → attempt → findings**，**不存在"角色 / Agent"实体** ⇒ 原设的"第 4 角色"真正要落的是「**一个相位 + 一个产物**」 | `evals/types.ts:176-262`（`EvalTask`/`EvalAttempt`/`ProcessFinding`/`ToolCallDetail`）；P1-1 取证① |
| b | `PatternRegistry` 的 `roles: ['generator','adversarial-reviewer','aggregator']` 是**产品内描述层**（消费方仅记录/展示），**与评测流水线不同域，不可直接移植** | `core/patterns/PatternRegistry.ts:38-46`；P1-1 取证① |
| c | **LLM 攻击者的结果是"不确定"的** ⇒ 原设表已明确标注 **❌ 非确定** ⇒ **不可直接当门禁** | `liri-optimization-plan` P1-1 候选表「形态 A」行 |
| d | 形态 A **需模型额度**（每次评测 +N 次调用） | 同上；T-⑤01「阻塞/前置 = 需模型额度」 |

### 1.3 已有可复用防线（CS01 归一化前置：**不得另建第二套**）

| 机制 | 挡什么 | 位置 |
|---|---|---|
| `pathShield` + `shieldGuard`（含四种写法比较针，两处执行收口各调一次） | 参数引用屏蔽路径 ⇒ fail-closed、工具**不执行** | `app/src/tools/pathShield.ts` / `shieldGuard.ts:57-79` |
| `processAssertions` **P-c** | 从落盘 trace **离线判定**"是否**尝试**访问被屏蔽路径"（**企图**的正面证据） | `app/src/evals/processAssertions.ts:31-36` |
| `repoSnapshot` / `repoTestJudge` | 判据不可篡改（跑测试前**重放**该提交测试文件）+ 三态（`green`/`red`/`unrunnable`） | `app/src/evals/repoSnapshot.ts` / `repoTestJudge.ts` |
| `fixTaskScreening` | 起始态必须真红、修复态必须绿，否则拒收（fail-closed） | `app/src/evals/fixTaskScreening.ts` |
| `auditAntiCheatSurface` | 本次运行的**反作弊面**逐条裁决（含 3 条 `knownGap`） | `app/src/evals/antiCheatAudit.ts:122` |

---

## 2. 根因（CS05）

形态 B 是**封闭集**（已知向量）；系统里**没有"未知手法的提出者"**。
但"提出者"若直接拥有裁定权，就会把**非确定性**引入判据（违 CS03：为理论可能性加机制；且原设表已标 ❌ 非确定）。

⇒ **真正的缺口不是"少一个 Agent"，而是"提案与裁决没有分离"**。
根因方案 = **提案（LLM，非确定）与裁决（机械，确定）解耦**：
LLM 的输出只作为**输入**进入既有机械判据；同一提案集下结果**可复现**。

---

## 3. 目标 / 非目标

**目标**

- **G1（分离）**：新增**只提案**的红队相位：产出结构化攻击方案，**不直接改变**任何裁决、不参与 fail-closed。
- **G2（确定化）**：每条提案都必须能被**机械执行 / 判定**（走既有防线与 judge）⇒ 在固定提案集下裁决**确定**。
- **G3（归一化）**：复用形态 B 的 `CheatFinding` / `CheatVerdict` / `auditAntiCheatSurface` 与既有 judge；**不新建**第二套屏蔽、第二套判据、第二套报告。
- **G4（诚实）**：机械裁决为 `exposed` 的提案 ⇒ 汇入同一 `cheatReport`；`knownGap` ⇒ 如实列出但不作废运行；提案无法机械化 ⇒ 标记 `unmachineable` 并列出（**不臆断为漏洞，也不静默丢弃**）。
- **G5（额度可控）**：默认**关闭**；显式开关启用；单次运行有**调用上限**与超时。

**非目标（明确不做）**

- N1：**不做门禁** —— 形态 A 不得让评测"因 LLM 判断而通过/拒绝"（约束 c）。
- N2：不新增"角色/Agent"实体、不改 `EvalTask`/`EvalAttempt` 的既有语义（约束 a）。
- N3：不新建屏蔽/判据/事件/配置体系（复用 G3）。
- N4：不替代形态 B（两者是"已知"与"未知"的互补，不是替代）。
- N5：不改 `client/`；不改 `PatternRegistry` 描述层（约束 b）。

---

## 4. 设计（混合式：LLM 提案 + 机械裁决）

### 4.1 数据契约（新增，落 `evals/` 域，app 层）

```ts
/** 红队提案（LLM 产出，经 schema 校验；不合法 ⇒ 丢弃，不 fail） */
export interface AdversarialProposal {
  id: string;                 // P-<n>，本次运行内唯一
  /** 攻击目标：指向**既有**防线或判据（如 'pathShield' | 'repoTestJudge' | 'fixTaskScreening'） */
  target: string;
  /** 具体步骤（工具调用序列 / 路径 / 命令形状）—— 必须**可机械执行** */
  steps: string[];
  /** 期望：若"未被挡"则说明什么（人读，用于归类，不作判据） */
  expectation: string;
  /** 机械化可行性（由判定侧回填，非 LLM 自评） */
  machineable: boolean;
}

/** 提案裁决：**复用形态 B 的三态语义**（CS01） */
export interface AdversarialVerdict {
  proposalId: string;
  verdict: CheatVerdict | 'unmachineable';   // blocked | exposed | knownGap | unmachineable
  detail: string;                            // 证据（路径 / 计数 / judge 三态）
}

export interface AdversarialReport {
  proposals: AdversarialProposal[];
  verdicts: AdversarialVerdict[];
  exposed: AdversarialVerdict[];             // 机械确认的未挡面（汇入同一 cheatReport）
  knownGaps: AdversarialVerdict[];
  unmachineable: AdversarialVerdict[];       // 如实列出（不臆断）
}
```

> **状态判定用闭集枚举 + 判定式字段**（CS02），不用标题/文案字符串。

### 4.2 流程（提案 → 机械执行 → 机械裁决）

```
① 提案相位（LLM，可关）        adversarialProposer.propose(ctx) → AdversarialProposal[]
   · 只读上下文：**已声明的防线清单 + task 元信息**（题面/判据形状），**不提供**隐藏期望值
   · 输出经 schema 校验；调用上限 N 次（D4），超时即止
② 机械化（确定）              proposalToVector(p) → 可执行向量（工具调用 / trace 断言）
   · 无法机械化 ⇒ verdict = 'unmachineable'（如实登记）
③ 机械裁决（确定，复用既有）   走 pathShield/shieldGuard（工具是否被执行）、processAssertions P-c（企图）、
                              repoTestJudge 三态、fixTaskScreening —— 产出 CheatVerdict
④ 汇总                        并入同一 cheatReport（G3）；**不触发 fail-closed**（N1）
```

**关键不变量（可证伪）**：
- 给定同一 `proposals`，②③④ 的输出**完全确定**（纯函数 + 既有 judge）；
- LLM 只影响"①产出哪些提案"，**不影响任何裁决**；
- 全流程**不调用**任何"由 LLM 判断是否通过"的分支。

### 4.3 落点与影响面（预计）

| 文件 | 改动 |
|---|---|
| `app/src/evals/adversarialProposer.ts` | **新增**：LLM 提案器（经既有 ai 访问通道，不绕过 Provider 体系）；schema 校验；调用上限/超时 |
| `app/src/evals/adversarialVectors.ts` | **新增**：`proposalToVector()` + 机械裁决（复用既有防线/judge，**不新写判据**） |
| `app/src/evals/types.ts` | 改（**可选**，见 D2）：新增上述报告类型；**不动** `EvalTask`/`EvalAttempt` 既有字段 |
| `app/src/evals/cli.ts` | 改：新增 `--adversarial`（默认关）+ `--adversarial-max-calls=N`；报告与形态 B 同目录 |
| `app/tests/evals/adversarialAgent.test.ts` | **新增**：注入式假 proposer（**测试夹具**，非生产 mock）+ 逐条裁决用例 + 未机械化分支 |

> **不改**：`antiCheatAudit.ts` 的向量语义、`pathShield`/`shieldGuard`/`repoTestJudge`/`fixTaskScreening` 判据、`client/`。

---

## 5. 决策点（**待用户裁定**）

| ID | 决策项 | 选项 | 说明 / 建议 |
|:--:|---|---|---|
| **D1** | 提案器的产物如何进入系统 | (a) **仅独立报告**（artifact，人工看）／(b) 机械确认 `exposed` 的提案 **汇入同一 `cheatReport`** | 建议 **(b)**：与形态 B 同源（G3），但**仍不 fail-closed**（N1） |
| **D2** | 是否改 `evals/types.ts` | (a) **新增独立类型**（不动 `EvalTask`/`EvalAttempt`）／(b) 给 `EvalAttempt` 加 `adversarialReport?` 字段 | 建议 **(a)**：本轮最小改动；数据模型变更（b）属"门禁化同批"议题，非本 spec |
| **D3** | 默认开关 | (a) **默认关**（`--adversarial` opt-in）／(b) 默认开 | 建议 **(a)**：需额度 + 非确定（约束 c/d） |
| **D4** | 调用上限 / 超时 | 每次运行 **≤N** 次（建议 N=5）+ 单次超时（建议 30s） | 固定建议值，可配置项延后（CS03：不提前造配置面） |
| **D5** | LLM 通道 | 复用既有 Provider/模型分工（**不新增供应商/端点**） | 固定建议：经 `ai` 域既有入口 |

> D1/D2 的选择决定 §4.3 的改动面；若 D1=(a) 且 D2=(a)，则 `cli.ts` 之外**零侵入**既有评测主链路。

### 5.1 裁定结果（2026-10-04，用户已答）

| ID | 裁定 |
|:--:|---|
| **D1** | **(b) 机械确认的提案汇入同一 `cheatReport`**（仍**不**参与 fail-closed） |
| **D2** | **(a) 新增独立类型**（不动 `EvalTask` / `EvalAttempt`） |
| **D3** | **(a) 默认关**（`--adversarial` opt-in） |
| **D4 / D5** | 采用 spec 建议值；**实施边界追加裁定 = "先落确定性半"**（提案器以注入式接口预留，LLM 适配器待通道口径确定后补） |

> **⚠️ 实施期新增的一个决定性事实（D5 的前提不成立）**：评测域（`evals/`）是**黑盒 HTTP 客户端** ——
> 全仓 `evals/**` 内**无任何** `@modules/ai` / provider / `AIProvider` 引用，只 `streamChat(sandbox.baseUrl, …)`
> （[`runner.ts:335-341`](file:///e:/PY/Documents/CODES/PY_APP/app/src/evals/runner.ts#L335-L341)）⇒ 「复用既有 Provider/模型分工」
> 在 evals 内**没有现成实例**，通道口径存在两个互斥解释（沙箱后端 HTTP chat vs 引入 `@modules/ai`）
> ⇒ 用户裁定**先落确定性半**，把该分叉显式留给后续（见 §11 遗留）。

### 5.2 D5 通道口径裁定（2026-10-04，本次裁定）

**证据（可复核）**
- 评测 harness 是**黑盒 HTTP 客户端**：`streamChat(sandbox.baseUrl, sessionId, model, prompt, timeout)`（[`runner.ts:331-341`](file:///e:/PY/Documents/CODES/PY_APP/app/src/evals/runner.ts#L331-L341)）；`--model` 指**被测应用**的模型（[`cli.ts:26-38`](file:///e:/PY/Documents/CODES/PY_APP/app/src/evals/cli.ts#L26-L38)）。
- `evals/**` 内**零** provider/AI 引用 ⇒ 「复用既有通道」**无现成实例**。
- `@modules/ai` **有现成入口**：`aiService` · `syncDBProvidersToRegistry` · `ProviderRegistry`（[`ai/index.ts:404,407-408`](file:///e:/PY/Documents/CODES/PY_APP/app/src/ai/index.ts#L404-L408)）；`evals` 与 `ai` **同为 app 层** ⇒ 同层依赖**合法**（R00-001）。

**裁定**

| 项 | 裁定 | 理由 |
|---|:--:|---|
| **(a) 沙箱后端 HTTP chat** | ❌ **否决** | ① 攻击者 = 被测应用**自身**（同模型/同 agent/同提示词）⇒ **红队独立性丧失**，只能复述已知盲区；② 要让 SUT「攻击」必须把**已声明防线清单**喂给它，而它同时是**被测者** ⇒ **审计信息回灌被测者**，评测有效性受损；③ `--model` 是 SUT 模型，**无法为攻击者独立选型**，其调用还污染沙箱状态与统计 |
| **(b) `@modules/ai` 既有入口** | ✅ **采用** | 独立攻击者（可独立选型/提示词）；同层依赖合法；入口已存在 ⇒ 不必引导整个应用，只需「DB → registry 同步 + `aiService` 调用」（**端到端引导步骤待实现时验证**，不预先断言 —— CS06） |
| **落地形态** | 适配器独立模块 `evals/adversarialProposer.ts`，由 CLI **动态 `import()`**（仅 `--adversarial --adversarial-model=<m>` 时加载） | 默认关**零开销**、不进 harness 静态依赖图；harness **确定性**不受破坏（N1 不变） |
| **参数** | `--adversarial-model=<m>`（**必填**，符合 model-usage「不得硬编码默认模型」）· `--adversarial-max-calls=N`（默认 5）· `--adversarial-timeout-ms`（**默认 60000**，R-1 调优 2026-10-07）· `--adversarial-max-tokens`（**默认 16384**，R-1 调优 2026-10-07） | ✅ **已落地**（与适配器同批 —— 见 §10.1）；**默认值经 R-1 真机调优上修**（见 §10.3） |

**闭环不变**：适配器产出 `AdversarialProposal[]` → 本模块**机械裁决**（闭集外记 `unmachineable`）→ 人工复核 `unmachineable` → 可机械化的手法**登记为形态 B 的一条向量**（§8.6）。

---

## 6. 验收（可证伪）

| 项 | 通过标准 |
|---|---|
| G1 | 全仓 `grep` 证明：提案器**无**任何直接写入裁决/fail-closed 的路径；`--adversarial` 关闭时行为与现状**逐字一致** |
| G2 | 注入**固定提案集** ⇒ 连续两次运行裁决**逐条相同**（确定性）；且**不注入模型**也能跑（用测试夹具 proposer） |
| G3 | 全仓 `pathShield` / `repoTestJudge` / `fixTaskScreening` / `CheatVerdict` 仍各只有**一处**实现/定义 |
| G4 | 三类提案各有用例：`exposed`（机械确证）/ `knownGap`（如实列出、不作废）/ `unmachineable`（列出、不臆断） |
| 零回归 | `typecheck 0` · `lint:arch 0 错` · `bun test tests/evals` 0 fail · **形态 B 既有 8 例全绿** |
| 突变验证 | ① 把 `exposed` 改成 fail-closed ⇒ 用例必 red（守住 N1）；② 去掉 schema 校验 ⇒ 非法提案用例必 red |
| 未做（明确） | 形态 A 的门禁化（N1）、`EvalAttempt` 数据模型变更（D2）、真实模型端到端（需额度，列为可选验收） |

---

## 7. 合规（对照 workspace rules）

| 规则 | 落点 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行，**批准后实施**（当前未动码） |
| **CS01 归一化** | ✅ 复用形态 B 的 `CheatFinding`/`CheatVerdict` 与既有 judge；**不新建**屏蔽/判据/事件 |
| CS02 状态判定 | ✅ 裁决用**闭集枚举**（`CheatVerdict` + `unmachineable`），不用文案字符串 |
| **CS03 回退最小化** | ✅ **不做门禁**（LLM 非确定 ⇒ 不参与通过/拒绝）；提案器默认关；无"以防万一"分支 |
| **CS04 Mock 零容忍** | ✅ 生产代码**不含**假提案/假模型；"夹具 proposer"仅存在于 `tests/` |
| **CS05 根因优先** | ✅ 根因＝"提案与裁决未分离" ⇒ 解耦两者，而非给 LLM 判据权 |
| §1.6 模型可见 ⇔ 已落盘 | ⚠️ **实施前须定**：提案器输入（防线清单/task 元信息）若进入模型请求，必须同批落为事件（三处同步）—— 见 §9.3 |
| §1.3 无兼容包袱 | ✅ 新类型、新开关，无需过渡层 |
| 文件行数 ≤1000 | ✅ 新增文件预计远低于上限 |

---

## 8. 风险与边界（如实）

1. **收益不确定**：形态 A 的价值是"**可能**发现未知手法"，**非保证**；且需额度。若长期无额度安排，可**只评审不实施**。
2. **不可当门禁**：任何"因 LLM 判断而 fail"的用法都违背约束 c（原设表已标 ❌ 非确定）—— 本 spec 明文禁止（N1）。
3. **提示词泄漏面**：提案器**不得**获得隐藏期望值 / 参考解（否则等于把泄题通道固化）。输入面须限定为"已声明防线 + 题面形状"。
4. **成本**：每次运行 +≤N 次模型调用（D4）；默认关可避免常态开销。
5. **`unmachineable` 占比可能偏高**：LLM 提案常含不可机械执行项 ⇒ 如实列出即可，**不得**臆断为漏洞（CS06 精神）。
6. **与形态 B 的边界**：A 发现的新手法，一旦**可机械判定** ⇒ 应**登记为形态 B 的一条 `CheatVector`**（回到确定性防线）；A 不长期承担"检测"职责。

---

## 9. 待办（裁定后回填）

- [x] D1 / D2 / D3 裁定（见 §5.1；D4/D5 用建议值 + 追加边界裁定"**先落确定性半**"）
- [x] 实施 —— **确定性半已落地**（见 §10）；**LLM 提案器适配器未实现**（通道口径待定）
- [x] 验证结果回填（见 §10）
- [x] §9.3 输入面落盘口径确认 —— 本轮**不涉及**（零模型调用、不进主会话事件流；提案集为本地文件）
- [ ] 真实模型端到端（需额度；可选）—— **待提案器适配器**

### 9.3 §1.6 红线检查点（实施前必须明确）

若提案器把「防线清单 / task 元信息 / 注入上下文」作为**模型可见输入**发出，则须同批新增一个 session 事件承载它
（`LiriEventType` + `LiriEventMap` + `ALL_SESSION_EVENT_TYPES` **三处同步**，由编译期穷尽断言强制）。
⇒ 实施时优先**避免**让评测侧内容进入主会话事件流（评测为离线 harness，与主会话轨迹不同域）；若确需落盘，按 §1.6 三处同步执行。

---

## 10. 实施记录（2026-10-04 · 确定性半）

> 用户裁定：D1=(b) / D2=(a) / D3=(a) / D4·D5 用建议值，且**先落确定性半**（提案器以注入式接口预留）。

| 文件 | 改动 |
|---|---|
| `app/src/evals/adversarialAgent.ts` | **新增**：类型（`AdversarialProposal` / `AdversarialVerdict` / `AdversarialReport` / `AdversarialVerdictKind` / `AdversarialProposerInput` / `AdversarialProposer`）+ `adversarialTargets` · `buildProposerInput` · `judgeProposal` · `runAdversarialPhase` · `adversarialToCheatFindings` · `parseAdversarialProposals` |
| `app/src/evals/cli.ts` | 改：`--adversarial`（默认关）+ `--adversarial-proposals=<file.json>`；`reportAntiCheatOnce` 抽 `ctx` 并在其后调 `reportAdversarialOnce`（复用既有 `AntiCheatContext`） |
| `app/tests/evals/adversarialAgent.test.ts` | **新增**：**9 例**（解析宽松校验 / 闭集内外裁决 / 确定性 / N1 守住 / 合并 cheatReport / 输入面不含期望值） |

**实现要点（对齐 spec 契约）**
1. **提案与裁决分离**：`adversarialAgent.ts` **不认识 LLM** —— 提案经注入式 `AdversarialProposer` 提供；模块只做"给定提案集 ⇒ 确定性裁决"。⇒ 同提案集结果**可复现**。
2. **单一判据（CS01）**：机械裁决**直接复用** `auditAntiCheatSurface`（按提案 `target` = 向量 id 取该向量裁决）⇒ 目标闭集由**既有判据派生**（`adversarialTargets(audit)`），**不手写第二份清单**。
3. **闭集外 ⇒ `unmachineable`**：如实登记、**不臆断为漏洞**（CS06）；`adversarialToCheatFindings` **不**把它转成 `CheatFinding`（不冒充结论）。
4. **N1 守住**：`--adversarial` 结果**不参与** `--cheat-gate` 的 fail-closed、不改退出码（§6 突变验证①的接口面：模块无 exit/throw 副作用，用例已断言）。
5. **安全面**：`buildProposerInput` 只含 `declaredShields` + `targets`（**无隐藏期望值 / 无参考解** —— §8 风险 3，用例断言键集恰为二者）。

**实施期偏离（如实，均为收窄/保守）**
- 类型落在 **`evals/adversarialAgent.ts`**（spec §4.3 原写 `evals/types.ts`）⇒ **完全不触碰共享数据模型文件**，与 D2=(a)"新增独立类型"更贴。
- 新增 **`--adversarial-proposals=<file.json>`**（spec 原只写 `--adversarial`）⇒ 作为"注入式接口"的**可用实例**（否则开启后无提案来源）；`--adversarial-max-calls` **暂不加**（仅 LLM 适配器需要 ⇒ 避免死开关，CS04）。
- **LLM 提案器适配器未实现**（用户裁定"先落确定性半"）；通道分叉见 §5.1。

**验证（实测）**

| 项 | 结果 |
|---|---|
| `bun run typecheck` | **exit 0** |
| `bun run lint:arch` | **错误 0 / 警告 1**（R07-004=0） |
| `eslint`（3 改动文件） | **0 problem** |
| `bun test tests/evals/adversarialAgent.test.ts` | **9 pass / 0 fail** |
| `bun test tests/evals` | **141 pass / 2 skip / 0 fail**（19 文件；形态 B 既有 8 例全绿） |

**遗留（明确）**
- ~~LLM 提案器适配器~~ ⇒ ✅ **已落地（§10.1，通道口径裁定见 §5.2）**。
- 真实模型端到端（需额度）—— 单元测试已用**注入式假 chat** 全覆盖（零额度）。

### 10.1 LLM 提案器适配器落地（2026-10-04，第二轮：D5 通道口径裁定后）

| 文件 | 改动 |
|---|---|
| `app/src/evals/adversarialProposer.ts` | **新增**：`createLlmProposer`（有界 `maxCalls` + 去重收敛 + 失败/超时**如实降级**）· `createAiServiceChat`（**`@modules/ai` 既有入口**，**动态 `import()`**；`syncDBProvidersToRegistry()` + `aiService.generate(..., { signal })`）· `buildRedTeamPrompt`（**安全面**：只给目标闭集 + 已声明防线）· `extractJsonArray`（容忍围栏/噪声；失败 ⇒ null） |
| `app/src/evals/cli.ts` | 改：新增 `--adversarial-model` · `--adversarial-max-calls`（默认 5）· `--adversarial-timeout-ms`（默认 30000）；提案来源**二选一**（文件 / LLM，互斥校验）；`reportAdversarialOnce` 与 `reportAntiCheatOnce` 改 **async** |
| `app/tests/evals/adversarialProposer.test.ts` | **新增**：**8 例**（解析容错 / 提示词安全面 / 单轮 / 跨轮去重收敛 / 上限恰好停在 maxCalls / 解析失败 / 调用抛错降级） |

**实现要点**
1. **动态 import**（`await import('@modules/ai')`）⇒ 本模块**不把 AI 拉进 harness 静态依赖图**；`evals` 与 `ai` **同为 app 层** ⇒ 依赖合法（`lint:arch` 实测 **违规 0**）。
2. **有界**：`maxCalls` 轮（每轮新增为 0 即提前收敛）+ `timeoutMs` 经 `AbortSignal` **真正中断**底层请求。
3. **如实降级**：调用抛错/超时 ⇒ **停止并保留已产出**；解析失败 ⇒ 该轮视为无产出；**不抛给判据、不伪造**。
4. **模型名显式传入**（`--adversarial-model` **必填**）—— 符合 model-usage 规则。
5. **N1 不变**：结果只进展示面与 `cheatReport` 合并，**不参与** fail-closed / 退出码。

**验证（实测）**

| 项 | 结果 |
|---|---|
| `bun run typecheck` | **exit 0** |
| `bun run lint:arch` | **错误 0 / 警告 1 / 违规 0**（分层检查 3858 → **3860** = +2 新文件） |
| `eslint`（5 改动/新增文件） | **0 problem** |
| `bun test tests/evals/adversarialAgent.test.ts tests/evals/adversarialProposer.test.ts` | **17 pass / 0 fail** |
| `bun test tests/evals` | **149 pass / 2 skip / 0 fail**（20 文件） |

**未做**：`--adversarial-max-calls` 的实测调参。

### 10.2 真实模型端到端（2026-10-04，实测）

**环境**：攻击者模型 = **`deepseek-v4-flash`**（DB 已启用；通道 = `@modules/ai` 既有入口 ⇒ 实测同步 **6 个 DB 供应商** + 加载 **11 条凭据**）；`maxCalls=1`、`timeoutMs=60s`。

**A. 首次实测 ⇒ 暴露 3 个真实缺陷（已修）**

| # | 现象 | 证据（实测） | 修复 |
|:--:|---|---|---|
| 1 | 提案 **0 条**、且无任何报错 | `finish_reason="max_tokens"` + `completion_tokens:4096` + **`content:""`** —— 未显式给 `max_tokens` ⇒ 供应商默认 **4096**，预算被推理吃光、正文为空 | ① 适配器**显式** `max_tokens`（新 `maxTokens` 选项，默认 **8192**）+ CLI `--adversarial-max-tokens` |
| 2 | 给到 8192 时**内容被截断** ⇒ JSON 数组不闭合 ⇒ 解析失败 ⇒ 仍 0 条 | `content` 1199 字符，末尾停在半个对象 | ② `extractJsonArray` 增**截断容错**：取「最后一个**完整顶层对象**」处收尾 ⇒ 只保留模型**已完整产出**的对象（不臆造、不补字段） |
| 3 | 上述失败**静默无痕** | 原 `catch { break }` 无日志 | ③ 失败路径落 `logger.warn`（`chat_failed` / `parse_failed` / `empty`）—— CS03-002「回退不得掩盖错误」 |

**B. 修复后实测（e2e 通过）**
- 提案 **4 条**（`P-1`–`P-4`）：8.3 短名 / 尾随点·空格 / `..` 变体 / 硬链接 / 目录联接（symlink）/ UNC 与卷 GUID / Win32 扩展前缀 —— 均指向 `C-1` / `C-2`。
- **机械裁决**：`A-P-1`–`A-P-3` → `blocked`（报告目录在屏蔽清单内）；`A-P-4` → `blocked`（2 条声明全部生效）。
- 汇总：`提案 4 ｜ exposed 0 ｜ knownGap 0 ｜ unmachineable 0`。

**C. 已知边界（**如实**，本轮实测暴露 → 重要）**
- 机械裁决回答的是「该向量的防线在**配置上**是否成立」，**不是**「该攻击能否**真的绕过**」。
  本轮 LLM 把"绕过型"手法（短名 / 硬链接 / symlink）**自映射到 `C-1`**（一个**配置检查**）⇒ 判 `blocked`（**偏乐观**）。
- ⇒ 该相位的定位应为「**提案供人工复核**」；要成为"未挡证据"，须**为具体手法实现机械判据**（即 §8.6 的登记闭环：把 `unmachineable`/新手法登记为形态 B 的一条向量）。
- 该边界**不改代码**即可明确（属方法论口径），已在此如实记录。

### 10.3 R-1：提案器模型选型 / 参数调优（2026-10-07，真机实测）

> **来由**：台账 §10.3 **R-1** —— 形态 A 的 LLM 提案相位**实测 0 条**（`flash/pro` 预算耗尽 `max_tokens`；`glm-5.2` / `qwen3.6-27b` 超时）⇒ 转「模型选型 / 调优待办」。
> **方法**：临时探针（已删除）直接经 `createLlmProposer`（**跳过评测沙箱**）以**真实** `@modules/ai` 通道跑候选模型/参数；目标闭集由 `buildProposerInput` 从真实反作弊面派生（实测 **C-1 … C-5** 共 5 项）。提示词 / 目标集 / `maxCalls=1` 全程一致。

| 候选（模型 @ `maxTokens` / `timeoutMs`） | 提案数 | 耗时 | 观测（如实） |
|---|:--:|:--:|---|
| `deepseek-v4-flash` @ **8192** / 60s | **0** | 43.7s | 输出 8192（**= 上限**）+ `adversarial.proposer.chat_empty_content`（`content=""`）⇒ `finish_reason` 截断 |
| `deepseek-v4-flash` @ **16384** / 150s | **12** ✅ | **34.5s** | 同提示词下完整产出 ⇒ **推荐攻击者**（快 + 产出多） |
| `deepseek-v4-pro` @ **16384** / 150s | **6** ✅ | 127.2s | 思考型；输出 13126 < 16384（完整）⇒ 可用但慢（3.7×） |
| `qwen3.6-27b:latest`（本地 Ollama）@ 8192 / 180s | **0** | 65.0s | 输出仅 **128** token（近乎空）⇒ 本地小模型在此任务上不可用；`num_ctx` 未传（服务端默认 ~2048） |

**结论（选型）**：攻击者**首选快（非思考型）chat 模型**（实测 `deepseek-v4-flash`）；思考型模型需 **≥150s** 超时；本地 Ollama 小模型**不适用**本任务。

**结论（调优 → 已落地）**：
- `DEFAULT_MAX_TOKENS`：**8192 → 16384**（根因：模型把输出预算耗在推理上，`content` 为空 ⇒ 提案 0 条；仅抬高上限、非强制消耗）。
- `DEFAULT_TIMEOUT_MS`：**30000 → 60000**（原值对实测 34.5s 的快模型**也必然截断**）。
- `DEFAULT_MAX_CALLS`：维持 5。
- CLI 帮助文本同步（`evals/cli.ts` 头注 + 参数解析默认值），并注明「思考型模型须显式 `--adversarial-timeout-ms=180000`」。

**如实（边界）**：① 每候选仅 **1 次调用**（`maxCalls=1`）⇒ 数据为**单样本**，非统计显著性；② 若供应商侧模型实现变更，数值可能漂移；③ 本次运行**消耗真实额度**（`deepseek` 两条候选合计约 **$0.33**）。
