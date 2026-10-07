# Spec：非幂等工具「重试」主动分流（R07-3）

> 版本 1.0 ｜ 创建 2026-10-07 ｜ 状态：🟢 **已实施（2026-10-07）**
> 来源：台账 `dev_docs/任务计划-20261004.md` §28.3 **R07-3**（外部报告 §五-**P1-4**，= `13-P1-2` 的**加强项**）
> 前置：`13-P1-2`（2026-10-05）已落地「工具幂等/副作用**声明**」+ **被动警告**
> 关联规则：GR15（Spec-Driven）/ GR01（基础设施复用）/ CS01（归一化）/ CS03（回退最小化）/ CS02；对标《Agentic Design Patterns》Ch.18 Guardrails / Ch.10 幂等与副作用
> 关联文档：`app/docs/配置与安全/工具调用安全检查链路.md`（**本批为其新增一个可裁决层 ⇒ 必须同步该文档**）

---

## 1. Problem Statement（回仓取证，file:line 为 2026-10-07 实测）

| # | 事实 | 证据 |
|:-:|---|---|
| 1 | `13-P1-2` 建立了**声明**（唯一事实源，`Record<ToolName,…>` ⇒ 漏声明编译失败）与**策略函数** | `tools/toolEffects.ts:49-121`（`TOOL_EFFECTS`）· `:135-137`（`shouldBlindRetryTool`） |
| 2 | 但唯一的**生产接线**是「把警告**写进 tool 结果**回传模型」——**被动**，依赖模型自觉 | `chat/ChatManager.ts:2583-2597`（`[重试注意] …禁止直接原样重试`） |
| 3 | **`shouldBlindRetryTool()` 全仓无生产消费者**（仅 `tools/index.ts` 转出 + 单测） | `app/tests/tools/toolEffects.test.ts:89-103`；`grep` 无其它调用点 |
| 4 | 因此**非幂等工具的重试没有任何主动分流**（不会拦截、不会询问） | 主链权限门 `chat/services/ToolExecutionService.ts:536-598` 与工具效果**无任何交集** |

⇒ **缺口定性**：`13-P1-2` 只做了「告知」（且只在**降级路径** `_sendMessageDowngradePath` 接线），**未做「分流」**。
外部报告的判断（"重试分流未成体系"）**成立**，台账 §28.4 已采纳。

**为什么值得做**：非幂等工具（`bash` / `file_write` / `channel` / `agent` / `mcp_tool` …共 24 项声明为 `idempotent:false`）
在**上一次已失败**后被**原样重放**，会产生**重复副作用**（重复写文件 / 重复发消息 / 重复扣费）。

---

## 2. 设计约束（先于方案）

- **CS01 / GR01**：**不新建审批机制**——复用既有「`ask` ⇒ Inbox 审批卡片」唯一提交点（`PermissionChecker.submitAskToInbox`）与既有返回形态（`awaiting_approval`）。
- **CS03**：不引入新开关（无"以防万一"回退）；不新增拒绝路径（只把 `allow` **升级**为 `ask`）。
- **CS02**：判定基于**结构化字段**（`idempotent` 布尔 + 历史调用记录），**不做文案匹配**。
- **不改变原有语义**：`deny` 不被覆盖；`bypass` / `dontAsk`（用户**明示**"不要打断"）**不被覆盖**。

---

## 3. 裁定点（本批已定，理由随附；如需变更请显式推翻）

| ID | 决策项 | 选项 | 定论与理由 |
|:--:|---|---|---|
| **D1** | 「重试」的判定口径 | (a) **同工具名 + 同参数 + 上次失败** ／ (b) 仅"同工具名曾失败" ／ (c) 仅"同工具名" | **(a)** —— (b)/(c) 会把「模型**修正后**再调用同一工具」（合法且常见）误判为重试 ⇒ 无谓打断；参数比对可精确区分"原样重放"与"换参数再试" |
| **D2** | 是否覆盖 `bypass` / `dontAsk` | (a) **不覆盖**（用户明示不打断）／ (b) 覆盖（安全不变量优先） | **(a)** —— 两模式是**用户/自动化显式选择**的"不要打断"；强制弹审批会让**无人值守流程**永久挂在 `awaiting_approval`（真实危害）。本闸只把**本该放行**的调用升级为 ask ⇒ 在 `ask`/`alwaysAsk`（本就询问）无回归，在 default/auto/plan 生效 |
| **D3** | **未声明**工具（MCP / 插件）是否纳入 | (a) **纳入**（无法证明幂等 ⇒ 保守）／ (b) 不纳入 | **(a)** —— 与既有 `shouldBlindRetryTool` 的保守口径**完全一致**（未声明 ⇒ `false` ⇒ 禁盲重试），不新增第二套判定 |
| **D4** | 是否覆盖 `deny` | (a) **不覆盖** ／ (b) 覆盖 | **(a)** —— `deny` 更强，覆盖会**削弱**安全性（CS03/安全姿态单调） |

---

## 4. 方案（唯一实现，勿另起）

**数据流**

```text
ToolExecutionService.execute（主链唯一工具执行入口）
  ├─ R07-3 闸（新增・执行前）
  │    ├─ resolveToolEffect(name)?.idempotent === true ⇒ 跳过（幂等可自动重试）
  │    └─ 否 ⇒ isNonIdempotentRetry(name, args, history)
  │            （history = toolResultRegistry.listBySession(sessionId)）
  │            ├─ false ⇒ 跳过
  │            └─ true  ⇒ forceAskReason = "…非幂等工具的重试需审批…"
  └─ 权限门 PermissionManager.checkPermissionForTool(name, args, { sessionId, forceAskReason })
       └─ checkPermissionInner：模式分派后
            └─ forceAskReason && decision.type === ALLOW && mode ∉ {BYPASS, DONT_ASK}
                 ⇒ createAskDecision(forceAskReason)            ← 升级（不覆盖 deny）
                    └─ 既有通路：submitAskToInbox ⇒ submittedToInbox:true
                         ⇒ ToolExecutionService 返回 awaiting_approval（**不执行工具**）
```

**落点**

| # | 文件 | 改动 |
|:-:|---|---|
| 1 | `tools/toolEffects.ts` | 新增纯函数 `isNonIdempotentRetry(name, args, history)`（+ `PriorToolCall` 类型 + 私有 `sameArgs` 深比较）；**唯一判定实现** |
| 2 | `tools/index.ts` | 转出 ①（对齐既有 `shouldBlindRetryTool` 出口） |
| 3 | `permission/PermissionManager.ts` | `checkPermissionForTool` 的 context 增 `forceAskReason?: string`；`checkPermission` / `checkPermissionInner` 透传；**模式分派后**做 `ALLOW → ASK` 升级（D2/D4 豁免） |
| 4 | `chat/services/ToolExecutionService.ts` | 权限门**之前**计算 `forceAskReason`（读 `toolResultRegistry` 历史）并传入 |
| 5 | `app/tests/tools/toolEffects.test.ts` | 扩：重试判定（幂等跳过 / 同参数失败⇒真 / 换参数⇒假 / 无历史⇒假 / 未声明⇒保守 / 参数顺序无关） |
| 6 | `app/tests/permission/*` | 新建/扩：`forceAskReason` ⇒ allow 升级为 ask；`deny` 不覆盖；`bypass`/`dontAsk` 豁免 |
| 7 | `app/docs/配置与安全/工具调用安全检查链路.md` | **同步**（该文档 §6 自检清单强制）：链路图 + §5 表格新增"可裁决层" + 说明 D2 豁免 |

---

## 5. 验收

| 项 | 标准 |
|---|---|
| 重试判定（P1） | `isNonIdempotentRetry` 对「幂等工具」「同参数失败」「换参数」「无历史」四类判定正确；参数**顺序无关** |
| 主动分流（P2） | 非幂等 + 同参数失败重放 ⇒ 走 `ask`⇒Inbox ⇒ 返回 `awaiting_approval` 且**工具不执行** |
| 不削弱（P3） | `deny` 不被覆盖；`bypass`/`dontAsk` 不被覆盖；幂等工具零行为变更 |
| 单一实现（P4） | 全仓重试判定仅 `isNonIdempotentRetry` 一处；审批提交仅 `submitAskToInbox` 一处（沿用） |
| 文档同步（P5） | 《工具调用安全检查链路》链路图与 §5 均含本层 |
| 回归 | `typecheck` 0 · 改动文件 `eslint` 0 · `lint:arch` 不新增违规 · 全量 `bun test` 0 fail |

---

## 6. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行；裁定点 D1–D4 已定并留痕 |
| GR01 基础设施复用 | ✅ 复用 `toolResultRegistry`（历史）/ `submitAskToInbox`（审批唯一提交点）/ `awaiting_approval`（既有返回形态）；**不新建**审批原语 |
| CS01 归一化 | ✅ 判定收敛到 `toolEffects.ts`（既有策略事实源）；`shouldBlindRetryTool` 与 `isNonIdempotentRetry` 共用 `resolveToolEffect` |
| **CS03 回退最小化** | ✅ 不新增开关/回退分支；只做 `ALLOW→ASK` 单向升级（无新拒绝路径） |
| CS02 状态判定 | ✅ 结构化布尔 + 历史记录，非文案匹配 |
| CS04 零 Mock | ✅ 测试用真实 `TOOL_EFFECTS` |
| R12-1 防 CS03 滥用 | ✅ 有真实消费者（主链执行入口），非死抽象 |
| 安全姿态单调 | ✅ 只增拦截、不削拦截（`deny`/`bypass`/`dontAsk` 语义均不变） |

---

## 7. 风险与边界（如实）

1. **`bypass` / `dontAsk` 下本闸不生效**（D2）：这两类用户**仍可能**因重放产生重复副作用 —— 属**用户显式选择**的代价，已在此登记。
2. **历史依赖运行期注册表**：`toolResultRegistry` 为**进程内**存储 ⇒ 重启后历史清空 ⇒ 重启后的首次调用不会被判为"重试"（**只影响"跨重启重放"这一窄场景**；同轮/同会话内有效）。
3. **参数比对为深比较**（非哈希）⇒ 工具参数极大时（如 `file_write` 的 `content`）比较成本随参数大小线性；仅在**非幂等工具**路径触发，且为纯内存比较，可接受。
4. **不覆盖工具循环内部的重试**：本仓工具级自动化重试不存在（`13-P1-2` 已取证），模型是唯一"重试方" ⇒ 本闸即唯一有效拦截位。

---

## 8. 实施记录（2026-10-07）

**落点（实测回仓）**

| # | 文件 | 改动 | 实测行 |
|:-:|---|---|---|
| 1 | `app/src/tools/toolEffects.ts` | 新增 `PriorToolCall` 类型 + 私有 `deepEqualArgs`（键序无关深比较）+ **纯函数** `isNonIdempotentRetry`（唯一判定实现） | `:142-196` |
| 2 | `app/src/tools/index.ts` | 转出 `isNonIdempotentRetry` + `PriorToolCall` | `:311-320` |
| 3 | `app/src/permission/PermissionManager.ts` | `checkPermissionForTool` 的 context 增 `forceAskReason?`；`checkPermission` / `checkPermissionInner` 透传；**模式分派后**加 `ALLOW → ASK` 升级块（D2/D4 豁免） | `:1155` / `:179` / `:235` / **`:339-355`** |
| 4 | `app/src/chat/services/ToolExecutionService.ts` | 新增 `_resolveNonIdempotentRetryReason`（读 `toolResultRegistry` 历史）；权限门前算理由并传入 | `:274` / `:584` |
| 5 | `app/tests/tools/toolEffects.test.ts` | 扩 **+8 例**（幂等跳过 / 同参数失败 ⇒ 真 / 换参数 ⇒ 假 / 上次成功 ⇒ 假 / 无历史与异工具 ⇒ 假 / 未声明 ⇒ 保守纳入 / **键序无关** / 嵌套按值） | — |
| 6 | `app/tests/permission/nonIdempotentRetryEscalation.test.ts` | **新建 5 例**（默认放行 + 提示 ⇒ ask + Inbox 提交 / 关开关保理由 / 不传 ⇒ 仍 allow / `deny` 不覆盖 / `bypass`+`dontAsk` 豁免） | — |
| 7 | `app/docs/配置与安全/工具调用安全检查链路.md` | **同步**（该文档 §6 自检清单强制）：§1.1 链路图新增 ⓪ 层、§2 表新增一行并**重编号**、§5 表新增行、头部标注 2026-10-07 局部更新；同批修正被本批改动的行号（`ToolExecutionService` 权限门 / `PermissionManager` 各处） | — |

**与 spec 的偏离（如实）**
1. **新增 `deepEqualArgs`（本地私有）**：spec §4 未预列。理由 —— 参数比对必须**键序无关**（同一参数对象经不同装配路径键序可能不同），而全仓既有的 `stableStringify` 均为**各模块私有**（`query/LoopDetector.ts:136` / `config/ConfigManager.ts:185`），**无导出的公共实现**；直接 `JSON.stringify` 会引入键序敏感 → 漏判。故写入最小深比较（~15 行），并在此登记（**非**第三份 `stableStringify`：不做序列化、不产出字符串）。
2. **`dontAsk` 的实际语义与预期不同**：实测 `handleDontAsk`（`permission/PermissionManager.ts:525-547`）为「允许则 allow；否则记拒绝 ⇒ `shouldAsk` 时 ask，否则 **deny**」——并非"恒放行"。⇒ 该模式的测试断言改为「**不注入 ask**」（`decision.behavior !== 'ask'`）而非"仍 allow"，与 D2 的真实意图（不改变"不询问"语义）一致。
3. **提交 Inbox 时 `reason` 被改写**：`submitAskToInbox` 成功后会以 `'<tool>' queued in Inbox (risk: …). Awaiting approval.` 覆盖 reason ⇒ 升级理由本身改由**关闭 `PERMISSION_INBOX_APPROVAL_ENABLED`** 的用例（①b）验证（那里保留原始 ask 决策）。

**门禁（全绿）**：`typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **违规 0 / 警告 4（基线）· 重复实现 0** · `lint:size` **0 错 / 470 警告 / 8 例外（基线）** · `lint:doc-code` **18 断言一致** · 全量 `bun test` **511 files / 4809 pass / 21 skip / 0 fail**（+1 文件 / +13 例，逐数吻合）。

**遗留（明确，未做）**
- **`bypass` / `dontAsk` 下本闸不生效**（D2 的有意选择，§7-1 已登记代价）；
- **跨重启重放**不判为"重试"（历史为进程内，§7-2）；
- **未做真机端到端实证**：本批为**单元/集成级**验证（判定纯函数 + 权限升级 + 主链接线），**未**以真实模型 + 真实失败工具跑一次会话级端到端观察（需真实模型额度；如实登记而非声称已验）。
