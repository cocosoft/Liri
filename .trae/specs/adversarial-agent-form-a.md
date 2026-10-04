# Spec：对抗 Agent 形态 A（LLM 攻击者 / 红队提案器）

> 版本 1.0 ｜ 创建 2026-10-04 ｜ 状态：📝 **待评审（未动码）**
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

- [ ] D1 / D2 / D3 裁定（D4/D5 建议值待确认）
- [ ] 实施（见 §4.3）
- [ ] 验证结果回填（§6）
- [ ] §9.3 输入面落盘口径（§1.6 红线）确认
- [ ] 真实模型端到端（需额度；可选）

### 9.3 §1.6 红线检查点（实施前必须明确）

若提案器把「防线清单 / task 元信息 / 注入上下文」作为**模型可见输入**发出，则须同批新增一个 session 事件承载它
（`LiriEventType` + `LiriEventMap` + `ALL_SESSION_EVENT_TYPES` **三处同步**，由编译期穷尽断言强制）。
⇒ 实施时优先**避免**让评测侧内容进入主会话事件流（评测为离线 harness，与主会话轨迹不同域）；若确需落盘，按 §1.6 三处同步执行。
