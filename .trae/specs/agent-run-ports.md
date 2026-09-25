# Spec：Agent Run 台账接口契约（P2-6）

> 版本 1.0 ｜ 创建 2026-09-25 ｜ 状态：**待评审（未实施）**
> 来源：`多Agent与长程任务-对标分析报告.md` §五 **P2-6**「三套台账无统一接口抽象」；台账 N-64
> 关联规则：GR15（Spec-Driven）/ GR01（基础设施复用）/ CS01（归一化）/ CS03（回退最小化）/ CS04（零 Mock）/ R06-008（分层）
> 用户裁定：**范围 A（判据接口）** —— 不合并三个不同域的对象。

---

## 1. Problem Statement

P0-3 收敛后，**事实源已单一**（`AgentRunLedger` 为模块单例，磁盘 `AgentRunStore` 为落盘镜像，引擎 `activeAgents` 降级为句柄表）。但**消费方仍直接依赖具体类/单例**：

| 消费者 | 依赖形态 | 证据 |
|---|---|---|
| `AgentTool` | 实例字段 `private _ledger = getAgentRunLedger()`（**具体类**） | `AgentTool.ts:372` |
| `SubAgentEngine` | 直接 `getAgentRunLedger().xxx()`（**模块单例**） | `SubAgentEngine.ts:270`、`:698`、`:708` |
| `agent-control-handlers` | `getAgentRunStore().listRuns()`（**具体类**） | `agent-control-handlers.ts:106` |

后果：① 无**接口契约** ⇒ 替换/桩化实现须改动所有调用点；② "谁是判据源"仍靠注释与约定（P0-3 的收敛结论）而非**类型**表达；③ 新增消费者容易再次直连磁盘侧（P0-3 之前的老路）。

**注意（避免过度抽象）**：`AgentRunLedger`（run 生命周期事实源）、`AgentRunStore`（持久化镜像）、`SettlementOutbox`（**投递队列**，`enqueue`/`claim`/`markDelivered`/`markFailed`/`markDropped`）**属不同域**，其公共面交集极小 ⇒ **不合并、不造共同基类**（本 spec 明确排除）。

---

## 2. 目标 / 非目标

**目标**
- G1：新增 **`AgentRunLedgerPort`** 接口，**契约化 `AgentRunLedger` 现有公共面**（判据 + 变更），并让 `AgentRunLedger implements` 之（**零行为变更**）。
- G2：**消费方改为依赖接口**：`AgentTool._ledger` 字段类型、`SubAgentEngine` 的局部取用、`agent-control-handlers` 的读取点（若适用）⇒ "判据源"由**类型**表达。
- G3：给出**可注入假实现**的能力（接口存在的直接收益）：新增用例以**内存桩**替换台账，验证消费方对契约的使用（不引入 mock.module）。

**非目标（明确不做）**
- N1：**不合并** `AgentRunLedger` / `AgentRunStore` / `SettlementOutbox`，不设共同基类（域不同）。
- N2：**不改**磁盘侧 `AgentRunStore` 的方法面（B 项未采纳）。
- N3：不改任何运行时行为、日志、状态机语义（**纯类型层 + 签名层**改动）。
- N4：不新增模块/表/端点；不动 `AgentRunLedger` 的实现逻辑（仅加 `implements`）。
- N5：不做 DI 容器/全局注册表（避免框架化）。

---

## 3. 设计

### 3.1 接口面（契约化现有公共方法，**逐一对应**）

```ts
/** Agent run 台账的**判据面**（所有"是否有在飞 run / 归属是谁"的判定都必须走这里） */
export interface AgentRunFactsPort {
  isLive(status: AgentRunStatus): boolean;
  hasLiveRunsForSession(sessionId: string): boolean;
  liveCount(): number;
  recentCount(): number;
  view(agentId: string): AgentRunView | undefined;
  viewActive(agentId: string): AgentRunView | undefined;
  listActive(): AgentRunView[];
  ownerSessionId(agentId: string): string | undefined;
}

/** **变更面**（注册 / 预留 / 取消 / 终态收敛）—— 参数与返回值**均引用实现签名**（防漂移） */
export interface AgentRunMutatePort {
  register(params: Parameters<AgentRunLedger['register']>[0]): ReturnType<AgentRunLedger['register']>;
  tryReserve(params: Parameters<AgentRunLedger['tryReserve']>[0]): ReturnType<AgentRunLedger['tryReserve']>;
  ensureCoveredRun(params: Parameters<AgentRunLedger['ensureCoveredRun']>[0]): ReturnType<AgentRunLedger['ensureCoveredRun']>;
  requestCancel(agentId: string): ReturnType<AgentRunLedger['requestCancel']>;
  settle(agentId: string, status: 'completed' | 'failed'): ReturnType<AgentRunLedger['settle']>;
}

/** 消费方统一依赖的**单一台账契约**（= 判据面 + 变更面） */
export type AgentRunLedgerPort = AgentRunFactsPort & AgentRunMutatePort;
```

- 参数类型**直接引用 `AgentRunLedger` 的方法签名**（`Parameters<...>`）⇒ 避免手抄参数造成漂移（**契约不会与实现分叉**）。
- **实施校正（2026-09-25）**：初版变更面**手写**返回值，`typecheck` 立即抓到 `tryReserve` 的真实可空性（额度不足 ⇒ `AgentRunReservation | null`）⇒ 已改为 `ReturnType<…>` 引用，**参数与返回值都不再手抄** —— 这是 D3 的完整落实（契约只引用实现，不重述实现）。
- `AgentRunLedger implements AgentRunLedgerPort`（**单行改动**）。

### 3.2 消费方迁移（类型层）

| 位置 | 改动 |
|---|---|
| `AgentTool.ts:372` | `private _ledger: AgentRunLedgerPort = getAgentRunLedger();` |
| `SubAgentEngine.ts:270/698/708` | 局部取用加类型注记（`const ledger: AgentRunFactsPort = getAgentRunLedger();`）或保持直接调用（**不强制**，见 D2） |
| `agent-control-handlers.ts:106` | 保持 `AgentRunStore`（**属持久化读取**，非判据面；N2） |

### 3.3 可注入性（G3 的落地证据）

新增用例：以**内存桩**（实现 `AgentRunLedgerPort` 的最小对象）替换台账，断言消费方**只经契约**取数（例如 `SubAgentEngine.hasActiveAgentForSession` 的委托判定在桩下返回桩值）—— **不使用 `mock.module`**（上轮教训：进程级泄漏）。

---

## 4. 决策点（请评审确认）

| ID | 决策（建议） | 理由 |
|---|---|---|
| D1 | 接口拆为**判据面 + 变更面**两段，再合成单类型 | 判据面是最小必要契约（引擎/控制面只需判据）；变更面供工具层；拆开便于将来只依赖判据 |
| D2 | `SubAgentEngine` 的取用**仅加类型注记**，不重构调用 | 外科手术式修改；其调用已是 `getAgentRunLedger().xxx()` 单表达式 |
| D3 | 参数类型用 `Parameters<AgentRunLedger['xxx']>[0]` **引用**而非手抄 | 契约与实现**不可能漂移**（改实现即编译期提示） |
| D4 | **不给** `SettlementOutbox`/`AgentRunStore` 造接口 | 域不同（N1）；B 项未采纳 |
| D5 | 不引入 DI 容器，仅类型契约 | 避免框架化（N5） |

---

## 5. 影响文件（预计）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/tools/AgentTool/AgentRunLedger.ts` | **改**：新增 `AgentRunFactsPort` / `AgentRunMutatePort` / `AgentRunLedgerPort` + `implements`（**零行为变更**） |
| 2 | `app/src/tools/AgentTool/AgentTool.ts` | **改**：`_ledger` 字段类型改为 `AgentRunLedgerPort`（1 行） |
| 3 | `app/src/tools/AgentTool/SubAgentEngine.ts` | **改（可选）**：3 处取用加类型注记 |
| 4 | `app/tests/tools/AgentTool/agentRunLedgerPort.test.ts` | **新建**：契约完整性（`implements` 由编译器保证）+ 内存桩注入语义用例 |
| 5 | `.trae/docs/api-spec.md` | **本批不加**（无 HTTP/IPC 端点） |

---

## 6. 验收方案

| 项 | 通过标准 |
|---|---|
| 类型/架构 | `typecheck` 0；`lint:arch` 不增加告警（当前基线 0/0） |
| 契约 | 接口由 `AgentRunLedger implements` **编译期**保证；用例断言桩实现可被消费方接受（可注入性） |
| 零行为变更 | 全量 `bun test` 0 fail（当前基线 **3646 pass / 19 skip / 0 fail**）；`tests/tools/AgentTool` 重点回归 |
| 不做 | 不合并三对象；不给磁盘侧造接口；不引入 DI 容器 |
| 诚实边界 | 本项为**类型层**改动 ⇒ **运行时行为零变化**（不需重启 daemon 生效） |

---

## 6.5 实施结果（2026-09-25）

| 项 | 结果 |
|---|---|
| G1 契约 | ✅ `AgentRunLedger.ts` 新增 `AgentRunFactsPort`（判据 8 项）/ `AgentRunMutatePort`（变更 5 项）/ `AgentRunLedgerPort`（交叉类型），`AgentRunLedger implements AgentRunLedgerPort`（**零行为变更**） |
| G2 消费方迁移 | ✅ `AgentTool._ledger` 字段类型改为 `AgentRunLedgerPort`（`AgentTool.ts:372-374` + import 补 `type AgentRunLedgerPort`）；`SubAgentEngine` 注记**未做**（D2 标为可选，其调用已是单表达式 ⇒ 未改，如实标注） |
| G3 可注入 | ✅ `app/tests/tools/AgentTool/agentRunLedgerPort.test.ts` **4 例**：契约方法齐全（实例 + 单例）、**内存桩替换判据面**（消费方 `summarize(facts)` 取桩值）、真台账经同面读数 |
| 验证 | ✅ `typecheck` 0；改动文件 `eslint` 0；`lint:arch` **0 错 0 警**；全量 **3667 pass / 19 skip / 0 fail**（3686 tests / 365 文件） |
| **实施校正（D3 的完整落实）** | ⚠️ 初版变更面**手写**返回值 ⇒ `typecheck` **立即**报 `TS2416`：`tryReserve` 实际返回 `AgentRunReservation \| null`（额度不足）⇒ 已改为 `ReturnType<AgentRunLedger['…']>` 引用，**参数与返回值都不再手抄**。（这正面验证了 D3 的理由） |
| 未做（如实） | `SubAgentEngine` 类型注记（D2 可选）；不给磁盘侧/outbox 造接口（N1/N2）；不引入 DI（N5） |

> **诚实边界**：本项为**类型层**改动 ⇒ **运行时行为零变化**；接口面较宽（13 个方法全量契约化）是"如实覆盖现有公共面"的代价（§8.2）。

---

## 7. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先于实现 |
| GR01 基础设施复用 | ✅ 直接契约化**既有**公共面，不新增能力、不改实现 |
| CS01 归一化 | ✅ 已检索：无既有 `AgentRunLedgerPort`（零命中）；不新增第二套台账 |
| CS03 回退最小化 | ✅ 无新增回退分支（纯类型） |
| CS04 零 Mock | ✅ 测试用**显式内存桩**（可注入契约的正当用法），非 mock.module |
| R06-008 分层 | ✅ 接口定义在既有文件内，不新增依赖边 |
| PY_APP §3 外科手术式修改 | ✅ `AgentTool` 1 行 + `SubAgentEngine` 类型注记（可选） |

---

## 8. 风险与边界（如实）

1. **收益形态**：本项**不修 bug**，收益是"判据源由类型表达 + 可注入 + 防止新增消费者直连磁盘侧"。若评审认为价值不足，可只做 G1（接口 + implements）不做消费方迁移。
2. **接口面较大的取舍**：`AgentRunLedger` 公共面 13 个方法全量契约化（判据 8 + 变更 5）⇒ 接口较宽；这是"如实覆盖现有公共面"的代价；**不做**进一步裁剪以免丢能力。
3. **`SubAgentEngine` 迁移可选**：其调用点已是单表达式 `getAgentRunLedger().xxx()`，加注记属文档性收益（D2）。
4. **对 D3 的依赖**：若将来 `AgentRunLedger` 方法签名变更，`Parameters<...>` 会**自动跟随**（无漂移）；但接口语义（哪个方法属判据面）仍需人工判断。
