# 状态机治理整体方案（2026-11-24）

> **状态**：✅ 已完成 —— **P0 / P1 / P2-1 / P2-2 全部落地**（2026-11-24）
> **定位**：本文件是 Liri **状态机治理总纲**，接替已缺失的 `dev_docs/20261012/状态机规范管理方案-20261012.md`
> （该目录当前**不存在**，但 `fix-evidence-registry.json` 仍有两处指向它 —— 见 G8）。
> **已完成基线**：13 条具体缺陷的修复见 [state-machine-defect-remediation.md](./state-machine-defect-remediation.md)
> （5 批已实施并推送，提交 `1b6adde31`…`3f4805935`）。本方案不重复那些修复，只治理**机制**。
> **原则**：先取证 → 只对**新增**强约束（棘轮哲学）→ 存量按域迁移；每批独立提交，可单独 revert。

---

## §1 结论与目标

**一句话结论**：Liri 已有"引擎 + 注册中心 + 定义目录 + 两道门禁"的骨架，但治理面仍有三处结构性缺口 ——
**目录不全**（已接入引擎的机器没有定义条目）、**前端不在扫描面**（前端状态词汇完全无登记/无棘轮）、
**只治"定义"不治"转移与收尾"**（终态残留、重启对账、派生判据都靠各域自觉）。

**治理目标（均为可验收）**：

| # | 目标 | 现状 | 目标值 |
|---|---|---|---|
| ① | 定义目录覆盖所有状态机 | 14 台登记；`StreamStateMachine` / `BackgroundTaskStateMachine` 仅在豁免清单 | 引擎机器与转移规则 100% 登记 |
| ② | 持久化机器的重启对账可证 | Inbox / SelfWake 已补（本轮），其余无声明 | 每台持久化机器都有 `reconcile` 策略 + 启动调用点 |
| ③ | 终态不再残留瞬态标记 | 本轮修了 3 处同类（审批 pending / 唤醒 fired / 工具 running） | 终态收尾成为显式契约，可门禁检查 |
| ④ | 同一概念只有一个派生判据 | `toolOutcome` 已统一；仍有 4+ 处分散判据 | 派生登记表 + 重复即阻断 |
| ⑤ | 前后端词汇不漂移 | 前端不入扫描面 | 前端词汇登记 + 跨端一致性测试 |
| ⑥ | 转移可审计 | 仅 Inbox / SelfWake / 投影有事件 | 持久化机器转移落结构化事件（或显式豁免） |

---

## §2 现状盘点（逐项取证）

### §2.1 已有能力（✅ 已亲自核对代码）

| 能力 | 实现 | 证据 |
|---|---|---|
| 泛型状态机引擎 | `StateMachine<S>`：规则校验 / 历史 / 快照 / 监听器 / 关键态日志 / `onTransition` | `packages/infra/src/state/engine/StateMachine.ts` |
| 终态自动推导 | 规则表出度为 0 ⇒ 终态（`computeDefaultTerminal`） | 同上 `:47-59` |
| 实例注册中心 | `StateMachineRegistry`（register/find/gc，30min 空闲清理） | `state/engine/StateMachineRegistry.ts` |
| 运行时可观测 | `GET /v1/state/all` 聚合注册实例（R09-005） | `app/src/infrastructure/http/handlers/state-handlers.ts` |
| 定义目录 | `STATE_MACHINES` 14 台 + `BOUNDARY_STATE_MACHINES` 6 台（同名不同物） | `state/engine/stateMachineCatalog.ts` |
| 目录 ↔ 源码一致性测试 | 运行时锚点逐项比对 / 锚点自洽 / id 唯一 / sourceFile 存在 | `app/tests/state/stateMachineCatalog.test.ts` |
| 定义登记硬门禁 | R09-006：`export enum *Status/*State` 与 `const *_STATUSES/*_STATES` 必须登记或显式豁免 | `scripts/lint-architecture.ts#checkStateMachineRegistration` |
| 豁免清单自洽 | 文件存在 / 符号确由该文件导出 / 带 reason / 键唯一 / 不与目录重叠 | `app/tests/state/stateMachineRegistrationGate.test.ts` |
| 状态字面量棘轮 | 词汇表取值 × 文件 ⇒ 新增未报备即阻断；`--update` 重生成基线 | `scripts/lint-state-literal-ratchet.ts` |
| 只读投影（非状态机） | 四原语 `PREPARED/RUNNING/SUSPENDED/SETTLED`，只读、非第二事实源、feature-gated | `state/engine/projectionBroker.ts` |
| 缺陷修复基线 | 审批 processing / selfwake firing / 工具 running / 挂起流 TTL / 派生统一 | `state-machine-defect-remediation.md` §9 |

### §2.2 结构性局限（本方案要治的）

| ID | 局限 | 证据 | 后果 |
|---|---|---|---|
| **G1** | **目录不全**：`StreamStateMachine`（生产使用：`packages/service/src/streaming/Stream.ts:59,247`）与 `BackgroundTaskStateMachine`（`getBackgroundTaskStateMachine` + Registry）都**不在目录**，只在 `scripts/state-machine-allowlist.json` 豁免 | 目录条目清单；allowlist 两行 reason = "运行时实例登记在 Registry" | 目录自称"全仓有哪些状态机"却漏掉两台已接引擎的机器；豁免被当成"不用管" |
| **G2** | **前端不在扫描面**：`resolveSourceRoots()` 只返回 `app/src` + `packages/*/src`；R09-006 与 `lint:state-literal-ratchet` 均消费它（`lint:arch` 仅对 `client/src` 单独做 store 订阅检查） | `scripts/lib/sourceRoots.ts:34-58`；`lint-architecture.ts:4686-4705` | 前端词汇（`toolOutcome`、`pausedStreams.phase`、`TaskCardTask.status`、`waitState`）无登记、无棘轮、无跨端一致性保证 |
| **G3** | **转移规则未治理**：目录只有 `hasTransitionFn: boolean`，没有规则表引用、没有终态集合校验 | `stateMachineCatalog.ts:53` | 新增状态忘记加入/移出转移表时无人发现（本轮 5 批中 3 处正是中间态/终态缺失） |
| **G4** | **终态收尾无契约**：进入终态时"清瞬态标记 / 解监听 / 停定时器"靠各域自觉 | 本轮 A1/B5/A5 三处同类缺陷 | 终态残留会反复复发（审批仍待批、工具仍转圈、唤醒仍等待） |
| **G5** | **重启对账无契约**：`processing`（Inbox）与 `firing`（SelfWake）各自手写复位/超时；无"持久化机器必须声明 reconcile"的门禁 | `InboxManager.PROCESSING_STALE_TIMEOUT_MS`、`WakeStore.recoverStaleFiring` | 新增持久化机器极易漏掉崩溃残留路径 |
| **G6** | **派生判据分散**：`hasPendingApproval`（审批）、`deriveWaitState`（等待）、`deriveToolOutcome`（工具）、`isTerminalPdcaEvent`（编排）各在一处，无登记/无重复检测 | 对应文件 | 同一事实被多处解释（本轮 B3/B4 的根因） |
| **G7** | **审计事件不统一**：`onTransition` 可选、`/v1/state/all` 只覆盖 Registry 实例；Inbox/SelfWake 有专用事件，其余机器无 | `state/engine/types.ts:89`（`onTransition?` 可选）、`state-handlers.ts` | "这次转移为什么发生"无法从持久层重建 |
| **G8** | **文档真源悬空**：`fix-evidence-registry.json` 两处 `source` 指向 `dev_docs/20261012/状态机规范管理方案-20261012.md`，该目录**不存在** | `fix-evidence-registry.json:2872,2898`；`Test-Path dev_docs/20261012` = False | 治理依据不可追溯；规则引用指向幽灵文件 |
| **G9** | **棘轮缺归属**：`state-literal-baseline.json` 是"值 → 文件列表"的全局快照，`--update` 一次性纳入所有出现点；无 owner / 无到期 | `lint-state-literal-ratchet.ts:85-97`（本轮 `--update` 实测新增 44 行） | 棘轮逐渐退化为"整体快照"，失去"只拦增量"的约束力 |
| **G10** | **无转移级测试门禁**：目录测试只比对"状态集合"，不校验规则表键/目标、终态可达性、跨端一致性 | `stateMachineCatalog.test.ts` | 转移表与实际状态集漂移无自动发现 |

---

## §3 目标模型（五层）

```
L1 定义层   stateMachineCatalog（扩展字段：转移规则/终态/持久化/对账/派生/跨端）
              │  门禁：R09-006（已有）+ R09-007/008（新增）
              ▼
L2 实现层   StateMachine<S>（新机器优先）/ 存量手写机（允许，但必须导出规则表 + 终态判定）
              │  门禁：R09-008；豁免必须带 reason（已有清单机制）
              ▼
L3 派生层   derive* 单一实现（后端：纯函数；前端：toolOutcome 模式）
              │  门禁：R09-011（派生登记表，重复即阻断）
              ▼
L4 收尾层   finalize（终态清瞬态）+ reconcile（启动对账）
              │  门禁：R09-009（持久化机必须有 reconcile）/ R09-010（终态收尾声明）
              ▼
L5 观测层   转移事件 + /v1/state/all + 审计（session/* 事件）
              │  门禁：R09-013（可恢复机器强制，其余豁免）
```

**关键裁定（避免过度设计）**：

1. **不要求所有字符串状态都引擎化**。只读投影（四原语）与纯展示派生（图标/文案映射）**不是状态机**，不登记、不引擎化（沿用 `projectionBroker.ts` 头注的既有裁定）。
2. **存量手写机允许保留**，但必须满足"可枚举 + 可校验"：导出规则表或显式声明 `transitionRules: null` + `terminalStates`。
3. **前端不是第二事实源**：前端只允许"投影 + 派生"，词汇必须能映射回目录条目的 `states`。

**目录条目扩展（建议形态，纯数据、零依赖）**：

```ts
interface StateMachineEntry {
  // 既有
  id: string;
  title: string;
  kind: 'persistent' | 'transient' | 'projection';
  sourceFile: string;
  states: readonly string[];
  verification: 'runtime-import' | 'source-read';
  verifyRef?: { module: string; exportName: string; anchor: 'array' | 'enum' | 'objectKeys' };
  hasTransitionFn: boolean;
  note?: string;
  // 新增（P0 起必填）
  owner: string;                 // 责任域（模块名，不写人名）：inbox / selfwake / execution / plan ...
  persistence: 'none' | 'memory' | 'json-file' | 'sqlite';
  transitionRules?: { module: string; exportName: string };  // 规则表锚点（手写机可缺省）
  terminalStates?: readonly string[];                        // 终态集合（可从规则表推导后固化）
  reconcile?: {
    strategy: 'none' | 'ttl-sweep' | 'startup-reset' | 'startup-rescan' | 'cas-requeue' | 'heartbeat-rescan';
    evidence: string;                                         // 启动调用点文件#函数
  };
  derivedViews?: readonly string[];                            // 消费该状态的派生实现
  crossEnd?: { clientFile: string; mapping: 'identical' | 'projection' };
}
```

---

## §4 缺口 → 动作映射

| 缺口 | 动作 | 落地批次 |
|---|---|---|
| G1 目录不全 | 把 `stream` / `backgroundTask` 从豁免升级为目录条目（含规则表锚点） | P0-1 |
| G2 前端不在扫描面 | ① `state-literal-ratchet` 扫描根加入 `client/src`（先 warning 收编基线）② 新增 `client/src/constants/stateVocabulary.ts` 登记前端词汇 ③ 跨端一致性测试 | P1-2 |
| G3 转移规则未治理 | 目录扩展 `transitionRules` / `terminalStates`；R09-008 校验"规则表键 = 状态全集、目标 ⊆ 状态全集" | P0-2 |
| G4 终态收尾无契约 | 新增"终态收尾清单"（清 `pendingApproval` / 解监听 / 停 timer / 释放幂等键）；R09-010 检查目录声明 | P0-2（规则）+ P1-1（样板） |
| G5 重启对账无契约 | 目录扩展 `reconcile`；R09-009 检查"持久化机必须有非 none 策略 + 启动调用点" | P1-1 |
| G6 派生判据分散 | `scripts/state-derivations.json` 登记 `{concept, owner, implementation, consumers}`；R09-011 查重 | P1-3 |
| G7 审计不统一 | 明确"可恢复机器转移必须落事件"，其余显式豁免；补 `state/*` 事件载荷文档 | P2-1 |
| G8 文档真源悬空 | 本文件作为总纲；修正 `fix-evidence-registry.json` 两处 `source`（改为本文件或恢复归档），并在目录 note 标注 | P0-1 |
| G9 棘轮缺归属 | 基线按 `machineId` 分组；`--update` 要求 `--reason`；新增条目带 `expiresAt` | P2-2 |
| G10 无转移级测试 | 扩展 `stateMachineCatalog.test.ts`：规则表自洽 / 终态可达 / 无孤儿状态；跨端一致性测试 | P0-2 / P1-2 |

---

## §5 规则提案（R09-007…R09-013）

> 编号接续现有 R09-001…R09-006（⑥ 不动）；**先落规则文件与测试，门禁再由 warning 升 error**，避免一次性红海。

| ID | 级别 | 判据 | 门禁实现 |
|---|---|---|---|
| **R09-007** | MUST | 目录条目必填 `owner` / `persistence` / `terminalStates`（`persistence!=='none'` 时还必须有 `reconcile`） | 扩展 `stateMachineCatalog.test.ts`（纯数据断言） |
| **R09-008** | MUST | 登记的转移规则自洽：① 键集合 = `states`；② 每个目标 ∈ `states`；③ **非终态**至少有一条出边。**口径修正（P0-2 实测）**：不要求"终态出度为 0" —— `task` / `stream` / `backgroundTask` 显式 `isTerminal` 且允许终态复位/重试回初始态 | 新测试 `stateMachineTransitions.test.ts`（动态载入规则表） |
| **R09-009** | MUST | `persistence !== 'none'` ⇒ `reconcile.strategy !== 'none'`，且 `evidence` 指向真实启动调用点（文件存在 + 函数名出现） | 扩展 `lint-architecture.ts`（新检查项，失败 error） |
| **R09-010** | MUST | 进入终态必须执行收尾（清瞬态标记 / 停 timer / 释放幂等键）：由目录 `terminalStates` + 代码内 `finalize` 调用点断言；无收尾需求须在目录 note 说明 | 先测试覆盖（按机器），P2 再考虑静态门禁 |
| **R09-011** | MUST | 同一概念只允许一个派生实现：`scripts/state-derivations.json` 中 `concept` 唯一，`implementation` 真实导出；消费方不得自写判据（代码评审 + grep 门禁） | 新脚本 `lint-state-derivations.ts`（低风险、只查重） |
| **R09-012** | SHOULD | 跨端词汇必须对齐：`crossEnd.clientFile` 的状态集合 ⊆ 目录 `states`（投影允许子集）；不一致即告警→阻断 | 新测试 `stateCrossEndParity.test.ts` |
| **R09-013** | SHOULD | 可恢复机器（`persistence!=='none'`）的每次转移必须落结构化事件（或目录登记豁免理由） | P2-1 已落地：目录 `audit` 字段 + `stateAuditCoverage.test.ts`（session-event 的 evidence 真实可查 / exempt 理由非空） |

---

## §6 分批实施

> 每批**独立提交**；顺序按依赖；每批完成即跑门禁与全量测试（app `bun test` / client `vitest run`）。

### P0-1 文档归位 + 目录补全 + 字段扩展

**改动**
- `stateMachineCatalog.ts`：新增 `stream`、`backgroundTask` 两个条目（含 `transitionRules` 锚点：`packages/service/src/streaming/StreamStateMachine.ts#STREAM_TRANSITIONS`、`packages/infra/src/state/background/BackgroundTaskStateMachine.ts#BACKGROUND_TASK_TRANSITIONS`）；为 14 台补齐 `owner` / `persistence` / `terminalStates` / `reconcile` / `derivedViews` / `crossEnd`。
  - ⚠️ 取证细节：`BACKGROUND_TASK_TRANSITIONS` 已 `export`；`STREAM_TRANSITIONS` 目前是**文件内常量**（`StreamStateMachine.ts:21`），P0-1 需同批补 `export`（纯可见性，无行为变更）。
- `scripts/state-machine-allowlist.json`：删除上述两条豁免（豁免与目录不重叠 —— 已有测试会校验）。
- `fix-evidence-registry.json`：两处 `source` 从缺失的 `dev_docs/20261012/...` 改为本文件锚点（或恢复归档，需维护者确认口径）。
- 本文件落盘并加入 `.trae/rules/architecture-compliance.md` 的 R09 引用（只加指针，不复制正文）。

**测试**：`stateMachineCatalog.test.ts` 扩展字段必填断言；`stateMachineRegistrationGate.test.ts` 保持不变（自动覆盖"豁免不得与目录重叠"）。

**验收**：目录条目数 16（14 + 2）；R09-006 仍 0 error；allowlist 条目数 -2。

**风险/回滚**：纯数据 + 文档，风险低；回滚 = revert 单提交。

---

### P0-2 规则落盘 + 转移自洽测试

**改动**
- `.trae/rules/architecture-compliance.md`：新增 R09-007…R09-013（含"门禁先行/分级"说明）。
- 新测试 `app/tests/state/stateMachineTransitions.test.ts`：对所有登记了 `transitionRules` 的机器做 §5 R09-008 三项断言。
- 对存量手写机（inbox / selfwake / plan / pdca）在目录中登记 `transitionRules: 缺省` + `terminalStates` + note 说明"转移集中在 X 文件的 CAS/状态更新函数"。

**验收**：转移测试全绿；目录无"有规则表却未登记"的机器。

**风险**：手写机规则表缺失 → 只要求登记终态与集中实现位置，不强迫补表（避免大重构）。

---

### P1-1 终态收尾 + 启动对账样板

**改动**
- 把本轮已验证的两条路径写成**样板契约**（文档 + 测试）：
  - 终态收尾：`inboxApproval`（终态清 `pendingApproval`）、`selfwake`（成功才 `fired`）、`chat-message-stream`（running → 中断）。
  - 启动对账：`InboxManager` 的 `processing` 超时、`WakeStore.recoverStaleFiring`、`recoverOverdueWakes`。
- 新增 `app/tests/state/stateReconcileContract.test.ts`：每个 `persistence!=='none'` 机器的 `reconcile.evidence` 必须指向真实启动调用（文件 + 函数名）。
- 补齐缺失声明（预期：`plan` / `goals` / `pdca` / `effects` 已有启动扫描，只需登记；`dedup` 为内存态）。

**验收**：R09-009 覆盖 100%；三台真机会话（`session_mwr473pd502e995dd1` / `session_mwpj4amge75a67ec4f` / `session_mwrf18pu00456e0f2b`）无终态残留。

---

### P1-2 前端词汇纳管

**改动**
- `scripts/lint-state-literal-ratchet.ts`：扫描根加入 `client/src`（独立追加根）；首次以 `--update` 收编存量（用户已确认，2026-11-24），随后即按"新增即阻断"生效。
- 新增 `shared/stateVocabulary.ts`：登记前端使用的状态词汇（tool outcome / task status 先行），标注对应后端 `machineId`、改名别名与 UI 独有项；前端经 `@shared/*` 引用，门禁测试读同一份数据（P1-2 实施时从 `client/src/constants/` 上移，避免双源/薄桶）。
- 新增 `app/tests/state/stateCrossEndParity.test.ts`（与目录测试同处，直接读 `shared/stateVocabulary`）：每个值 ⊆ 对应目录 `states`（投影/UI 独有需声明理由）。
- 把剩余分散判据收敛到 `toolOutcome.ts` 模式（如 `waitState` 的 `pendingWake` 判定保持单一入口）。

**验收**：client 侧状态字面量纳入棘轮（基线一次性扩大需用户确认，见 §11-Q2）；跨端一致性测试绿。

**风险**：前端存量大、词汇通用（`pending/completed/failed`）→ 基线膨胀。缓解：按 `machineId` 分组、只对新增文件阻断；不追溯清理。

---

### P1-3 派生唯一登记

**改动**
- 新增 `scripts/state-derivations.json` + `lint-state-derivations.ts`：登记 `{concept, owner, implementation, consumers, note}`，校验 `implementation` 真实导出、`concept` 唯一。
- 登记现有 4 个：`toolOutcome`（前端）、`hasPendingApproval`（审批）、`deriveWaitState`（等待）、`isTerminalPdcaEvent`（编排）。
- 替换剩余自写判据（评审 + grep：同一 `pendingApproval === true && ...` 形态不得再新增）。

**验收**：重复概念 = 0；新增判据必须先在登记表落一行。

---

### P2-1 审计与观测

**改动**
- 新增通用会话事件 `state/transition`（`shared/events/eventNames.ts` + 后端载荷/登记清单 + 客户端载荷镜像，按 `project_rules §1.6` 同批登记）。
- 新增 infra 端口 `stateTransitionAudit.ts`（纯数据记录 + 注入式 sink），由 `service/session/stateTransitionEvents.ts` 适配成事件，宿主 `hostWiring` 注入追加器。
- 目录新增 `audit` 声明（`session-event` 带 `event` + `evidence` / `exempt` 带 `reason`）：已接入 6 台（`state/transition`：toolCall / toolExecutionTransient / sessionState / selfWake / inboxApproval / plan）+ 3 台复用既有专用事件（execution / goal / workflowStopReason），其余按证据豁免。
- 新增门禁 `app/tests/state/stateAuditCoverage.test.ts`（R09-013）。

**验收**：持久化机器逐台有审计结论；`state/transition` 机器的 `evidence` 指向真实发射点（文件存在 + 符号出现）。

---

### P2-2 棘轮归属与巡检

**改动**
- 基线结构升级：`{version: 2, machines: {machineId: {values, files}}, unowned: []}`；`--update` 要求 `--reason`（写入基线 note）。
- 新增季度巡检脚本（只读）：目录覆盖率、未登记新增、持久化机对账覆盖、派生重复、跨端不一致、死代码 `@deprecated` 到期。
- 清理观察期结束的死代码（`extractToolCalls` / `buildLogEvents` / `resolveGroupStatus`，按 CD05/CD06）——**已完成**（§20）。

**验收**：巡检报告可作为发布前 checklist 的一节。

---

## §7 门禁与测试矩阵

| 检查 | 类型 | 现状 | 目标批次 |
|---|---|---|---|
| R09-006 定义登记 | lint:arch error | ✅ 已有 | 不动 |
| 豁免清单自洽 | bun test | ✅ 已有 | P0-1 自动覆盖 |
| 目录字段完整性（R09-007） | bun test | ✅ | P0-1 |
| 转移表自洽（R09-008） | bun test | ✅ | P0-2 |
| 启动对账证据（R09-009） | bun test（后续可并入门禁） | ✅ | P1-1 |
| 终态收尾（R09-010） | 逐机测试 → 静态 | ❌ | P1-1（样板已锁定，静态门禁未做） |
| 派生唯一（R09-011） | bun test（登记表查重） | ✅ | P1-3 |
| 跨端一致性（R09-012） | bun test | ✅ | P1-2 |
| 转移审计（R09-013） | bun test（目录 `audit` + 证据锚点） | ✅ | P2-1 |
| 状态字面量棘轮 | lint:state-ratchet | ✅（含 `client/src`） | P1-2 |
| 目录 ↔ 锚点比对 | bun test | ✅ 已有 | 扩展字段后沿用 |

---

## §8 验收标准（量化）

1. **覆盖率**：所有 `StateMachine` 子类 + 所有 `*_TRANSITIONS` 导出 100% 出现在目录（当前缺 2 台）。
2. **新增纪律**：新状态机定义未登记 = 0（R09-006 维持）；无 owner/无 reconcile 的持久化机器 = 0。
3. **恢复性**：三台真机会话重启后无"永久中间态"（`processing` / `firing` / 挂起超 30min / 工具 running）。
4. **一致**：同一工具调用在组头 / 工具卡 / 行内 / 日志面板结论一致（本轮已验证，纳入回归）。
5. **跨端**：前端词汇与目录 `states` 不一致 = 0。
6. **可审计**：持久化机器的终态转移可从 `events.jsonl` 重建。

---

## §9 非目标（明确不做）

- ❌ 不把只读投影（`PREPARED/RUNNING/SUSPENDED/SETTLED`）登记为状态机（既有裁定，见 `projectionBroker.ts` 头注）。
- ❌ 不强制所有字符串状态引擎化（全仓类型联合 >150 处，逐一迁移属无收益重构）。
- ❌ 不改任何业务语义（审批档位、风险分级、白名单策略、计划状态取值）。
- ❌ 不引入跨进程/分布式状态一致性（单进程假定，与 `firing` / `processing` 的复位口径一致）。
- ❌ 不把状态机目录做成运行时依赖注入容器（保持零依赖纯数据，避免 core←service 倒挂）。

---

## §10 风险与回滚

| 风险 | 缓解 | 回滚 |
|---|---|---|
| 规则过重拖慢开发 | 只对**新增**强约束；存量登记即可，不强制迁移引擎 | 单批 revert |
| 前端棘轮基线一次性膨胀 | 先 warning + `--update` 收编，下一版本转阻断；按机器分组 | 移除 client 扫描根 |
| 目录字段扩展导致大量文件改动 | P0-1 一次性补 16 台，纯数据 | revert 单提交 |
| 手写机规则表缺失 → R09-008 无法覆盖 | 允许 `transitionRules` 缺省，只要求终态 + 集中实现位置（note） | 降级为 warning |
| 文档/证据登记口径变更 | 只改 `source` 指针，保留原文字 | revert |

---

## §11 待拍板（带推荐值）

| # | 事项 | 推荐 | 影响 |
|---|---|---|---|
| Q1 | 引擎强制范围 | **新机器 + 有并发/恢复语义的机器**必须用 `StateMachine<S>`；只读投影与纯展示派生不强制 | 决定 R09-001 是否收紧 |
| Q2 | `client/src` 是否纳入状态字面量棘轮 | **纳入，先 warning 收编基线，下一版本转阻断** | 前端门禁强度 |
| Q3 | 终态收尾是否统一 `finalize()` 契约 | **统一为可选 `onTerminal` 注册**（不强迫所有机器实现） | P1-1 改动面 |
| Q4 | 审计事件覆盖范围 | **仅 `persistence!=='none'` 且可恢复的机器强制**，其余目录登记豁免 | 事件量与实现成本 |
| Q5 | 目录 `owner` 口径 | **按模块域**（inbox/selfwake/execution/plan/…），不写个人 | 责任归属与巡检报告 |

---

## §12 变更记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-11-24 | 初版：现状取证（G1–G10）+ 五层目标模型 + R09-007…013 提案 + 7 批实施路线 + 门禁/验收/风险 | AI |
| 2026-11-24 | **P0-1 实施完成**：目录 14 → 16（补 `stream` / `backgroundTask`，删除对应豁免）、全部条目补治理字段、导出 `STREAM_TRANSITIONS` / `EXECUTION_TRANSITIONS`、R09-007 断言入测试、证据登记 `source` 改指本文件 | AI |
| 2026-11-24 | **P0-2 实施完成**：目录 16 → 18（补 `inboxApproval` / `plan`）、`sessionState` 补 `transitionRules` 锚点、新增 R09-008 转移规则自洽测试（口径修正：不要求终态出度为 0） | AI |
| 2026-11-24 | **P1-1 实施完成**：新增 R09-009 对账证据契约测试（持久化机 ⇒ 策略非 none + `文件#符号` 真实可查）；`stepVerdict` 按"无独立状态存储"归为 `persistence: none` | AI |
| 2026-11-24 | **P1-2 实施完成**：`lint:state-ratchet` 扫描根加入 `client/src`（基线 +481 行收编存量）；新增 `shared/stateVocabulary.ts`（toolCall / task 两项）与 R09-012 跨端一致性测试 | AI |
| 2026-11-24 | **P1-3 实施完成**：新增 `scripts/state-derivations.json` 与 R09-011 测试，登记 tool/approval/wait/pdca 四个派生判据（concept 与实现均唯一、锚点真实导出） | AI |
| 2026-11-24 | **P2-2 实施完成**：基线升级 v2（`reason` / `generatedAt` / `valueOwners`，`--update` 强制 `--reason`）；新增只读巡检脚本 `scripts/state-governance-report.ts`（支持 `--check`） | AI |
| 2026-11-24 | **P2-1 实施完成**：新增 `state/transition` 事件（三处登记 + 客户端载荷镜像）· infra 注入式审计端口 + service 适配 + 宿主编织 · 目录 `audit` 声明（6 台接入 / 3 台复用既有事件 / 其余按证据豁免）· R09-013 覆盖门禁 | AI |
| 2026-11-24 | **P2-2 遗留清理完成**：按 CD05/CD06 两段式删除 `extractToolCalls` / `buildLogEvents` / `resolveGroupStatus`（先摘测试入口 `771854de7`，再删实现） | AI |

---

## §13 P0-1 实施记录（2026-11-24）

**已落地**

| 项 | 结果 |
|---|---|
| 目录条目 | 14 → **16**（新增 `stream`、`backgroundTask`，均含 `transitionRules` 锚点） |
| 治理字段 | 16 台全部补 `owner` / `persistence` / `terminalStates`；持久化机补 `reconcile`（含证据锚点） |
| 规则表可见性 | `STREAM_TRANSITIONS`（原文件内常量）与 `EXECUTION_TRANSITIONS`（原 `TRANSITIONS`，改名避免与 `connectionMonitor` 同名）已导出，无行为变更 |
| 豁免清单 | 删除 `BackgroundTaskState` / `packages/service/src/streaming/types.ts#StreamState` 两条（保留 `app/src/chat/streaming/AdvancedStreamingProcessor.ts#StreamState` —— 另一台局部枚举） |
| 文档归位 | `fix-evidence-registry.json` 两处 `source` 从缺失的 `dev_docs/20261012/...` 改为本文件（并注明原文档缺失） |
| 门禁 | `tests/state/stateMachineCatalog.test.ts` 新增 R09-007 三条断言（字段必填 / 持久化机必须有 reconcile / 规则表锚点可载入） |
| 基线 | `state-literal-baseline.json` 因新增 `streaming` / `skipped` 词汇重新收编（+52/−9） |

**新发现（P0-2 处理，未纳入 P0-1 范围）**

1. **`inboxApproval` 未登记**：`pending/processing/replied/expired/dismissed` 是真实持久化机器（`inbox_items` 表 + CAS + 启动对账 `reconcileStuckApprovalSessions`），但既不在目录、也未被 R09-006 捕获（状态用单数常量而非 `*_STATUSES` 数组）。
2. **计划生命周期（`Plan.status`）未登记**：`pending-acceptance-state-machine.md` 已描述验收子态，但目录无 `plan` 条目。
3. ~~**R04-001 本地口径**：从 `app/` 目录运行 `lint:arch` 时，`InboxManager.ts` 的 `FSZ-006` 例外不生效（相对路径带 `..`）；从仓库根运行正常。~~ **已修（2026-11-24）**：`checkFileSize` 的豁免判定路径改由 `this.projectDir`（仓库根）归一（AR-2），展示路径仍用 cwd 相对；`app/` 与仓库根两处运行均为 `错误: 0`（仅剩 R00-003 warning）。

**验证**：`bun test tests/state tests/execution tests/streaming` → **310 pass / 0 fail**；`bun run typecheck` 通过；`lint:state-ratchet` 通过；仓库根 `lint:arch` 仅剩 R00-003 warning（预存）。

---

## §14 P0-2 实施记录（2026-11-24）

**已落地**

| 项 | 结果 |
|---|---|
| 目录条目 | 16 → **18**：补 `inboxApproval`（`pending/processing/replied/expired/dismissed`）与 `plan`（`pending/running/completed/failed/aborted`） |
| 规则表锚点 | `sessionState` 补 `SESSION_TRANSITIONS` ⇒ 目前 5 台机器受 R09-008 校验（execution / sessionState / task / stream / backgroundTask） |
| 新门禁 | `app/tests/state/stateMachineTransitions.test.ts`：键集合 = `states`、目标 ⊆ `states`、非终态有出边；并断言"至少覆盖 4 台"防锚点失效空跑 |
| 基线 | `state-literal-baseline.json` 因 `processing` / `replied` / `dismissed` / `aborted` 词汇收编（+68/−8） |

**口径修正（如实）**

- 方案 §5 原写"`terminalStates` ⊆ 出度为 0 的集合"，P0-2 实测**不成立**：`TaskStatus` 允许 `completed→running` 等重试边；`StreamStateMachine` / `BackgroundTaskStateMachine` 也显式传 `isTerminal` 且终态可复位到 `idle`。
- 改为**非终态必须有出边**（"活着的死胡同"），终态允许复位/重试边；已在 §5 R09-008 与测试文件头注明。

**遗留（转入 P1）**

- `inboxApproval` / `plan` 的 `transitionRules` 仍缺省（手写机，转移分散在 CAS/UPDATE 与编排器）⇒ 目录 note 已写明集中实现位置；是否补规则表待 P1-1 评估。
- `processing` / `dismissed` 等通用词进入词汇表后，棘轮噪声上升 —— 由 P2-2「按机器归属 + 到期」收敛。

**验证**：`bun test tests/state` → **15 pass / 0 fail**（新增 6 条）；`bun run typecheck` 通过；`lint:state-ratchet` 通过。

---

## §15 P1-1 实施记录（2026-11-24）

**已落地**

| 项 | 结果 |
|---|---|
| 新门禁 | `app/tests/state/stateReconcileContract.test.ts`（R09-009）：12 台持久化机器逐一断言——`reconcile.strategy !== 'none'`、证据格式 `文件#符号`、文件存在且符号真实出现（防陈旧/编造锚点） |
| 防空跑 | 断言"至少覆盖 5 台持久化机器"，避免筛选条件失效后全绿（AR-3） |
| 样板契约 | 测试锁定 3 个终态收尾样板文件存在：审批回滚 / 唤醒重试 / 工具态派生（只查存在，不重复实现） |
| 字段修正 | `stepVerdict` 由 `persistence: sqlite` 改为 `none`：它是步骤产出的解析标记（随计划落盘），**无独立状态存储与恢复动作** |

**说明**：R09-009 在方案 §5 原写"扩展到 `lint-architecture.ts`"；实际先以 **bun test** 落地（零 CI 接线风险、可直接跑），待 P2 再并入 `lint:arch` 硬门禁。

**验证**：`bun test tests/state` → **160 pass / 0 fail**（新增 14 条）；`bun run typecheck` 通过。

---

## §16 P1-2 实施记录（2026-11-24）

**已落地**

| 项 | 结果 |
|---|---|
| 棘轮扫描面 | `scripts/lint-state-literal-ratchet.ts` 扫描根加入 `client/src`（与 app/packages 同一词汇表、同一基线） |
| 存量收编 | 首次纳入新增 **480 处**未报备命中 ⇒ `--update` 收编，基线 +481 行（用户已确认"先收编存量"） |
| 跨端词汇表 | `shared/stateVocabulary.ts`（零依赖纯数据）：`toolCall` 6 态（`pending_approval→running`、`interrupted→unknown` 投影）· `task` 7 态（`in_progress→running`；`cancelled`/`skipped` 为 UI 独有并附理由） |
| 新门禁 | `app/tests/state/stateCrossEndParity.test.ts`（R09-012）：机器存在 / 前端文件存在 / 取值可映射或带理由的 UI 独有 |

**口径说明**：方案 §6 原写"新增 `client/src/constants/stateVocabulary.ts`"；实际放在 `shared/stateVocabulary.ts` —— 前端经既有 `@shared/*` 别名引用，门禁测试直接读同一份数据，避免"前端一份、测试一份"的双源。未新增 `client/src/constants/stateVocabulary.ts`（薄桶 re-export 会触发 R07-003 告警）。

**风险（已发生，按预期）**：通用词（`running/completed/pending` 等）进入前端后，基线显著变大；棘轮仍只拦**新增**，存量不追溯。按机器归属与到期收敛留给 P2-2。

**验证**：`bun test tests/state` → **163 pass / 0 fail**（新增 3 条）；`bun run typecheck` 通过；`lint:state-ratchet` 通过。

---

## §17 P1-3 实施记录（2026-11-24）

**已落地**

| 项 | 结果 |
|---|---|
| 登记表 | `scripts/state-derivations.json`（version 1）：`tool.outcome` / `approval.session_pending` / `wait.state` / `pdca.terminal` 四项，含 owner / 实现锚点 / 消费方 / 口径说明 |
| 新门禁 | `app/tests/state/stateDerivations.test.ts`（R09-011）：`concept` 与 `implementation` 均唯一、`文件#符号` 真实导出、`consumers` 文件存在 |
| 现状说明 | 四项均为既有**单一实现**（本轮 B3/B4 已收敛）；本批只做登记与守卫，**不改业务代码** |

**说明**：方案 §5 原写"新脚本 `lint-state-derivations.ts`"；本批以 bun test 落地（随全量测试执行，零 CI 接线风险），待 P2 再并入 `lint:arch`。

**验证**：`bun test tests/state` → **167 pass / 0 fail**（新增 4 条）；`bun run typecheck` 通过。

---

## §18 P2-2 实施记录（2026-11-24）

**已落地**

| 项 | 结果 |
|---|---|
| 基线 v2 | `StateLiteralBaseline` 新增 `reason` / `generatedAt` / `valueOwners`；**`files` 仍是 diff 的唯一事实源**，因此 v1 → v2 迁移**不改变门禁行为**（纯元数据增量） |
| `--update` 强制理由 | 缺 `--reason "<收编理由>"` ⇒ **exit 2**（支持 `--reason=…` 与 `--reason …` 两种写法）；v2 基线缺 `reason` 在加载时 exit 1；v1 基线仍兼容加载 |
| 归属元数据 | `toValueOwners()` 生成「值 → 拥有该值的机器 id」，供巡检/归属排查；**不参与 diff** |
| 只读巡检 | `scripts/state-governance-report.ts`：输出目录条目 / 字段缺失 / 持久化与对账覆盖 / 基线健康（版本·理由·幽灵值·幽灵文件）/ 派生登记 / 跨端对齐 / `@deprecated` 存量；`--check` 有问题即 exit 1 |
| 基线迁移 | 以 `--update --reason "P2-2 基线升级 v2（归属元数据 + 强制理由）；本次仅结构迁移，不新增收编项"` 迁移，`files` 内容不变（44 值 / 2360 文件对） |
| 测试适配 | `app/tests/gates/stateLiteralRatchet.test.ts` 基线健康断言改为接受 v1\|v2，v2 追加断言 `reason` / `generatedAt` / `valueOwners` 非空 |

**口径修正（如实）**

- 方案 §6 原写"**基线按 `machineId` 分组**"：**未采用**。同一取值被多台机器共用（`pending` / `running` / `completed` 等），按机器分组会让同一 (value, file) 在多组重复登记，diff 噪声与维护成本上升。改为**值 → 机器归属映射**（`valueOwners`）达成同一目的（归属可查），`files` 保持单层结构。
- 方案 §6 原写"**新增条目带 `expiresAt`**"：**本批未引入**。到期日缺真实决定方（谁定？依据什么？），引入只会产生人肉维护的空日期 ⇒ 属"无场景的机制"（CS03）。待出现真实废弃计划时，按 `reason` + 目录 note 记录，再评估是否加机器可读到期字段。
- 通用词噪声的实际收敛点是**归属可查 + 巡检可见**（`valueOwners` + `state-governance-report`），而非拆分基线文件。

**巡检基线（2026-11-24 实跑）**：目录 18 台（+边界 6）、字段缺失 0、持久化 11 台**全部**有对账证据、基线 v2（`reason` 存在）、值 44 / 文件对 2360、幽灵值 0 / 幽灵文件 0、派生登记 4、跨端对齐 2、`@deprecated` client 14 处 / 6 文件 + app 30 处 / 16 文件、`--check` 通过。

**遗留**

- `@deprecated` 死代码（`extractToolCalls` / `buildLogEvents` / `resolveGroupStatus`）已按 CD05/CD06 删除，见 §20。
- `inboxApproval` / `plan` 仍无 `transitionRules`（手写机，转移分散在 CAS/UPDATE 与编排器）⇒ 未纳入 R09-008 的动态校验面。

**验证**：`bun test tests/state tests/gates/stateLiteralRatchet.test.ts` → **171 pass / 0 fail**；`bun run typecheck` 通过；`lint:state-ratchet` 通过；`state-governance-report --check` 通过。

---

## §19 P2-1 实施记录（2026-11-24）

**已落地**

| 项 | 结果 |
|---|---|
| 新事件 | `state/transition`（log-only）：`machine` / `from` / `to` / `reason?` / `subjectId?`；按 §1.6 三处同批登记（`LIRI_EVENT_NAMES` · `LiriEventMap` · `ALL_SESSION_EVENT_TYPES`）+ 客户端载荷镜像 |
| 审计端口 | `packages/infra/src/state/engine/stateTransitionAudit.ts`：纯数据记录 + 注入式 sink（`setStateTransitionAuditSink` / `emitStateTransitionAudit`），未注入 ⇒ 如实不落 |
| 事件适配 | `packages/service/src/session/stateTransitionEvents.ts`：把端口适配为会话事件（`seq: 0` 交追加器原子分配），宿主 `hostWiring` 注入 `appendStreamEvent` |
| 目录声明 | 新字段 `audit`（`session-event{event,evidence}` / `exempt{reason}`）；`persistence !== 'none'` 共 17 台全部有结论 |
| 接入（6 台 `state/transition`） | `toolCall`（ExecutionManager `begin/end/settle/recover`）· `toolExecutionTransient`（`toolApprovalOutcome`）· `sessionState`（`SessionStateMachine` 的引擎 `onTransition`，覆盖 Bridge/ChatManager 全部入口）· `selfWake`（`WakeStore.updateEntry` + 批量扫描/启动复位）· `inboxApproval`（`reply`/TTL 过期/批量 dismiss/`expireByIds`/撤销/`resolveInboxApproval` CAS 与回滚）· `plan`（统一入口 `plan/planStatusAudit.ts`，覆盖 9 处写入 + 创建） |
| 复用既有事件（3 台） | `execution`（`execution/status_changed`）· `goal`（`goal/status_changed`）· `workflowStopReason`（`assistant/workflow_run_end` 含 `stopReason`） |
| 豁免（8 台，均带理由） | `budgetMode`（读时计算、无会话）· `dedupProcess`（会话创建前）· `appState`（全局 + SSE/快照）· `appInstall`（无生产写点）· `task`（无 sessionId，已有本地审计表/jsonl）· `effectQueue`（队列无 session 列）· `stream`（实例无 sessionId，引擎可订阅）· `backgroundTask`（全局后台机） |
| 新门禁 | `app/tests/state/stateAuditCoverage.test.ts`（R09-013）：持久化机必有 `audit`；`session-event` 事件名 ∈ `LIRI_EVENT_NAMES` 且 `evidence` 文件存在、符号出现；`exempt` 理由 > 10 字符；防空跑（≥12 台有声明、≥3 台走 `state/transition`） |

**口径说明（如实）**

- 方案 §6 原写"`plan` / `goals` / `pdca` / `effects` 终态与重试落 `session/*` 审计事件"：`goals` 已有专用事件（不重复造）；`effects`（effectQueue）与 `pdca` 中的 `stepVerdict` 无独立会话维度/持久状态 ⇒ 目录登记豁免并写明依据；`plan` 全量接入。
- 被豁免的不是"忘了做"，而是**没有可挂的会话维度或已有等价审计**；每条的 `reason` 均给出具体事实（字段缺失 / 写入点不存在 / 已有本地审计）。
- `plan` 的 9 处写入**没有**合并成 setter 重构（外科手术式修改），只在赋值前加一行 `auditPlanStatusChange`；`from` 由该函数读取旧值，`from === to` 不落事件。

**遗留**

- `selfWake` 的 `due` 态全仓无写入点（目录已登记但实际只用 `pending`）—— 属既有事实，后续可在目录 note 标注或收敛状态集。
- `inboxApproval` 的 `tryUpdateStatus` 是通用 CAS API（测试直调），生产路径的审计落在 `resolveInboxApproval`；若将来新增生产调用方，需同步补审计。
- `@deprecated` 死代码（`extractToolCalls` / `buildLogEvents` / `resolveGroupStatus`）已按 CD05/CD06 删除，见 §20。

**验证**：app 全量 `bun test` → **13829 pass / 42 skip / 0 fail**（1642 文件）；client `vitest run` → **1125 pass**（158 文件）；`bun run typecheck` 与 client `tsc --noEmit` 通过；改动文件 ESLint 通过；`lint:state-ratchet` 通过；`state-governance-report --check` 通过（转移审计 **17/17**，session-event 9 / exempt 8）。

---

## §20 P2-2 遗留清理：死代码删除（2026-11-24，CD05/CD06）

**删除对象**（均为 client 端"消息投影重建"旧路径，生产消费已统一到事件流 / `deriveGroupOutcome`）：

| 符号 | 位置 | 替代实现 |
|---|---|---|
| `extractToolCalls` | `client/src/utils/sessionLog.ts` | `buildLogEventsFromEvents`（事件流） |
| `buildLogEvents` | 同上 | 同上 |
| `resolveGroupStatus`（+ `ToolGroupStatus`） | `client/src/utils/toolHumanSummary.ts` | `stores/chat/toolOutcome.ts#deriveGroupOutcome` |

**CD01–CD04 核查结论（删除依据）**

- **CD01 静态 / 动态 / 配置**：全仓 `grep` 三个符号，除定义与注释外仅命中**自身测试**；`import(` / `require(` 动态载入 0 处；无字符串注册（无配置键 / 表驱动 key）。`packages/evals` 的同名 `extractToolCalls` 是**另一实现**（trace 解析），不在本删除范围。
- **CD02 构建 / 插件 / 运行时发现**：client 单入口（web/desktop 共用同一 `src`），无按名加载；两文件均不在插件 / 通道 / 技能注册表，`utils/` 无 barrel `index.ts` 再导出。
- **CD03 DI / 反射 / 外部协议**：纯函数工具，无装饰器 / `resolve<T>()` / HTTP 路由 / IPC 命令引用。
- **CD04 测试 / 变体 / 运行模式**：仅 3 个测试文件引用（`sessionLog.test.ts` 1 例、`toolDisplay29.test.ts` 6 例、`session-log-error.test.ts` 4 例）；CLI/REPL/MCP/DAEMON 均为后端，不消费 client 工具函数。

**执行顺序（CD05 两段式）**

1. `771854de7 test(client): 摘除 @deprecated 死派生的最后引用（CD05 第一步）`：移除三处测试入口；`extractError`（活代码）改为直接构造 `ToolCallRecord` 直测，**保留覆盖**。
2. 本提交：删除实现体 + 清理因删除而孤立的 `toolEvent` / `logger` / `Message` 等引用；同步更新两文件头注与 `ToolExecutionGroup` 的历史注释。

**回滚路径（CD06）**：删除集中在极少数文件，`git revert` 本提交即可完整复原；入口摘除提交可单独 revert（回滚后仅测试恢复，不影响运行）。

**验证**：client `tsc --noEmit` 通过；client `vitest run` → **1118 pass / 0 fail**（158 文件，较清理前 1125 减少 7 例——均为被删死路径的专属用例）；改动文件 ESLint 0 error。
