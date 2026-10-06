# Spec：统一协作编排契约（A10 —— Swarm / Council 的单一构造点与取舍策略）

> 版本 1.1 ｜ 创建 2026-10-06 ｜ 状态：🟢 **G1 已实施（2026-10-06，D1=b 最小实施）** —— 用户裁定 **D1=b / D2=a / D3=a / D4=a**（见 §5）；**G3（`CollaborationEngine` 端口）按 CS03 暂缓**（D1=b 下无消费者 ⇒ 死抽象），**G2/G4 未动**；详见 §9「如实偏差与边界」。
> **来源**：架构分析项目报告 09 §五 **A10**「协作引擎构造点分散（决策权错层复发）」+ §六-1「P0 编排决策上收」；登记于 `dev_docs/任务计划-20261004.md` §15.2 / §14.2-P0-1 / §11-A2。
> **关联规则**：GR15（Spec-Driven）· GR01（基础设施复用）· CS01（归一化：先查已有）· CS03（空实现/回退最小化）· CS05（根因优先）· R06-008（分层）· §1.3（无兼容包袱）。
> **口径（CS06）**：下列 `file:line` 均为 **2026-10-06 实测**。

---

## 0. 一句话定性

多智能体协作**已落地且已接线**（Swarm + Council 两引擎），但**缺"统一编排/取舍层"**：
`CouncilOrchestrator` 有 **2 处**独立 `new`（无共享工厂/单例）、Swarm 有 **1 处**；
且**无**"何时用 Swarm、何时用 Council"的统一策略（现状是 Council 侧一条**单向启发式**）。
本 spec 只做**契约定义 + 排期评估**，**不改任何运行时**。

---

## 1. 取证（2026-10-06 回仓实测）

### 1.1 两引擎与全部构造点

| 引擎 | 类（`file:line`） | 公开入口（实测签名） | 构造点 | 触发面 |
|---|---|---|---|---|
| **Swarm** | `tasks/swarm/AgentSwarm.ts:270` | `run(options: AgentSwarmOptions): Promise<AgentSwarmResult>`（**无状态，注释自述"可复用单例"**） | **1**：`tools/AgentTool/AgentTool.ts:1799` `new AgentSwarm().run({...})` | **工具驱动**（模型调 `agent` 工具的 swarm 路径） |
| **Council** | `workspace/CouncilOrchestrator.ts:188`（引擎 `workspace/CouncilEngine.ts:68`，单例 `getCouncilEngine()` `:412`） | `startCouncil(workspaceId, topic, context, agents?, config?)` / `runDebate(sessionId)` | **2**：`chat/ChatManager.ts:2630` `new CouncilOrchestrator(engine)` · `runtime/api/domainSnapshotOps.ts:1670` `new CouncilOrchestrator(getCouncilEngine())` | **回合后启发式**（`shouldTriggerCouncil`）+ **HTTP/工作区路径**（`runCouncilDebate`） |

### 1.2 取舍策略现状：**只有 Council 单向启发式，无统一选择**

- `chat/ChatManager.ts:1265-1268` `shouldTriggerCouncil(session, content, options)`：
  `session.metadata?.is_ultraplan_mode === true || containsComplexKeywords(content) || options?.metadata?.councilTriggeredManually === true`。
- 消费点：`chat/orchestrator/ChatOrchestrator.ts:1046`（**仅非流式** `sendMessage` 收尾；流式路径未见对应接线）。
- **Swarm 侧无对应启发式** —— 其触发完全由模型在 `agent` 工具内**显式选择** swarm 路径。
- 全仓 `selectCollaboration` / `chooseEngine` / `selectEngine` / `CollaborationOrchestrator` ⇒ **0 命中**（无既有统一层）。

### 1.3 三个具体缺口（A10 的"决策权错层"）

1. **构造点分散**：`new CouncilOrchestrator` ×2（`ChatManager` / `domainSnapshotOps`），**无共享工厂/单例** ⇒ 引擎实例化策略散落调用方。
2. **无取舍策略**：两条协作路径的"选谁"分散在 ① 模型（Swarm，不可控）、② `ChatManager` 启发式（Council，单向）⇒ **无单一决策点**。
3. **策略不完整**：`shouldTriggerCouncil` 只判 Council；无"该 Swarm 而非 Council"或"都触发"的判据。

---

## 2. 归一化检查（CS01）

| 检查项 | 结果 |
|---|---|
| 已有"协作编排/选择"实现？ | ❌ `CollaborationOrchestrator`/`selectCollaboration`/`chooseEngine` 全仓 **0 命中** |
| 已有编排族规范？ | ✅ `orchestration-family-convergence.md`（A4 本体 ✅ 2026-10-03，家族 28→20）· `orchestration-lifecycle-contract.md`（L1/L2/L3 三分法 + `SchedulerLifecycle`）—— **两者均不含"协作引擎取舍"**（本 spec 是**净增量**） |
| 已有 spec 声明归属？ | `pattern-executable-assembly.md:43` 明示「`CollaborationOrchestrator` … **不在本 spec**（T-①06/07/08，大工程各自立项）」⇒ **需新建** |
| 可复用的既有底座 | `getCouncilEngine()`（Council 单例）· `AgentSwarm`（无状态，天然可单例）· `ChatOrchestrator` 的 host 端口（`shouldTriggerCouncil`/`triggerCouncilDebateAsync`）· `globalEventBus`（已有 `COUNCIL_START/END`） |

⇒ 本 spec 为**唯一新增**，且**不新造第二套引擎**（复用既有两引擎，仅加**契约 + 单一入口**）。

---

## 3. 目标 / 非目标

**目标**
- G1 ✅ **已实施**：**单一构造点** —— 消除 2 处散落的 `new CouncilOrchestrator`，统一由 `getCouncilOrchestrator()` 提供。
- G2：**统一取舍策略** —— 定义 `selectCollaboration(request)` 纯函数，把"何时 Swarm / 何时 Council / 何时都不"从散落启发式收敛为**可测的单一判据**。（**未实施**：属 D1=c）
- G3 ⚠️ **按 CS03 暂缓**：**统一入口契约** —— 定义窄端口 `CollaborationEngine`（`name` + `run()`），两引擎适配后同形。（D1=b 无统一派发 ⇒ 端口无消费者，落地即死抽象；见 §9）
- G4：**零行为变更前提** —— 现状行为（Council 启发式 + 模型选 Swarm）在启用契约后**逐条等价**，不做隐式策略变更。✅ **已达成（G1 范围内）**

**非目标**
- N1：**不新建第三套协作引擎**（CS01；复用现有 Swarm/Council）。
- N2：**不改 `AgentSwarm` / `CouncilEngine` / `CouncilOrchestrator` 的执行语义**（本契约只在"选择 + 构造"层）。
- N3：**不改流式路径的协作触发**（现状流式无 Council 触发 ⇒ 是否补齐属另一议题，见 §6-U3）。
- N4：不动 HTTP/IPC 契约、不动 DB、不动 `~/.pyapp/**`。
- N5：不为不存在的触发场景造代码（CS03）。

---

## 4. 设计（契约草案，待 §5 裁定后细化）

**落点建议**：`app/src/tasks/collaboration/`（app 层）—— 两引擎分别处 `tasks`（swarm）与 `workspace`（council），契约需同时可见二者且不引入 `chat → workspace` 直连；最终落点以 T1 分层取证为准（见 §6）。

```ts
/** 窄端口：两引擎适配后同形（G3） */
export interface CollaborationEngine<In, Out> {
  readonly name: 'swarm' | 'council';
  run(input: In): Promise<Out>;
}

/** 取舍判据（G2，纯函数，无 IO） */
export type CollaborationKind = 'none' | 'swarm' | 'council';

export interface CollaborationRequest {
  /** 触发面：工具驱动 / 回合后启发式 / 工作区路径 */
  surface: 'tool' | 'post-turn' | 'workspace';
  ultraplan?: boolean;         // 迁移自 is_ultraplan_mode
  complexKeywords?: boolean;   // 迁移自 containsComplexKeywords
  manual?: boolean;            // 迁移自 councilTriggeredManually
  taskCount?: number;          // Swarm 适用性信号
}

/** 单一决策点（替换 §1.2 的散落启发式） */
export function selectCollaboration(req: CollaborationRequest): { kind: CollaborationKind; reason: string };

/** 单一构造点（G1）：内部持有 Council 单例 + Swarm 单例 */
export function getCollaborationOrchestrator(): {
  runSwarm(options: AgentSwarmOptions): Promise<AgentSwarmResult>;
  runCouncil(sessionId: string): Promise<void>;
  startCouncil(workspaceId: string, topic: string, context: string): Promise<CouncilSession>;
};
```

**关键约束**：`selectCollaboration` 必须**逐条复现**现状判据（§1.2）并将其**显式化**；未覆盖的情形返回 `'none'`（**fail-safe**：不擅自触发协作），与「不擅自变更模型/行为」原则一致。

---

## 5. 决策点（**待用户裁定**）

| ID | 决策项 | 选项 | 建议 |
|:--:|---|---|---|
| **D1** | 是否立项实施本契约 | (a) **仅立 spec 留档，不实施**／(b) 实施 G1+G3（单一构造点 + 窄端口，**零行为变更**）／(c) 实施 G1+G2+G3（含策略收敛） | **(a) 或 (b)** —— (b) 是纯重构、可证伪；(c) 会动"何时触发"，需先有"Swarm 适用性"需求证据 |
| **D2** | `selectCollaboration` 是否**纳入 Swarm 判据** | (a) 仅复现 Council 判据（保行为不变）／(b) 新增 Swarm 判据 | **(a)** —— 无"该 Swarm"的实测需求（§6-U1） |
| **D3** | 契约落点 | (a) 新建 `tasks/collaboration/`／(b) 并入既有 `workspace/` | **(a)**，以 T1 分层取证定夺 |
| **D4** | 是否顺带补齐**流式路径**的 Council 触发（N3 反向） | (a) 不补（保持 N3）／(b) 补齐 | **(a)** —— 属独立需求，避免夹带 |

> **✅ 用户裁定（2026-10-06）**：**D1=b · D2=a · D3=a · D4=a**（最小实施 = G1 + G3，零行为变更）。执行结果与如实偏差见 **§9**。

---

## 6. 任务分解（T1–T4，D1=(b)/(c) 时才执行）

| 编号 | 步骤 | 产出 | 前置 |
|:--:|---|---|---|
| **T1** | 分层 + 依赖取证：契约落点须能被 `chat`（ChatManager）/`runtime`（domainSnapshotOps）/`tools`（AgentTool）**共同引用**且不引入新跨层边（对照 `scripts/modules-to-layers.json`） | 取证清单（`file:line` + 层判定） | D1/D3 |
| **T2** | 新增 `CollaborationEngine` 端口 + 两引擎适配器（**纯类型 + 转发，零语义变更**） | 1–2 新文件 | T1 |
| **T3** | 新增 `getCollaborationOrchestrator()` 单一构造点；把 `ChatManager.ts:2630` / `domainSnapshotOps.ts:1670` 的 `new CouncilOrchestrator` 改走该入口 | 3 处改动 | T2 |
| **T4** | 若 D1=(c)：`selectCollaboration` 接线 `shouldTriggerCouncil`；契约用例（判据逐条 + 证伪控制组） | 测试文件 | T3 |

**未取证（如实列出，不作结论）**

| # | 项 | 说明 |
|:--:|---|---|
| U1 | 是否存在**真实"该 Swarm 而非 Council"**需求 | 未取证；无证据则 D2=(a) |
| U2 | `shouldTriggerCouncil` 的**命中率/误报率** | 无运行期数据；`containsComplexKeywords` 属**字符串匹配**（CS02 邻域，需评估） |
| U3 | 流式路径（`streamMessageFlow`）**为何无** Council 触发 | 未取证：是有意（避免流式打断）还是遗漏 |

---

## 7. 合规（对照 workspace rules）

| 规则 | 落实 |
|---|---|
| **GR15** Spec-Driven | ✅ 先 spec，§5 裁定后再动码 |
| **GR01** 基础设施复用 | ✅ 复用既有 Swarm/Council/`getCouncilEngine`/`globalEventBus`；不新造引擎 |
| **CS01** 归一化 | ✅ §2 已检索：统一层 0 命中；既有编排 spec 不含协作取舍 ⇒ 净增量 |
| **CS02** 状态禁字符串匹配 | ⚠️ **本 spec 暴露**：`shouldTriggerCouncil` 的 `containsComplexKeywords` 属字符串匹配；T4 若动策略须一并评估（见 U2） |
| **CS03** 空实现/回退最小化 | ✅ `selectCollaboration` 默认 `'none'`（fail-safe）；不为无需求场景造 Swarm 判据（D2=a） |
| **R06-008** 分层 | ✅ 落点以 T1 取证为准，禁新增跨层边 |
| **§1.3** 无兼容包袱 | ✅ 可直接改 2 处构造点调用，无需兼容层 |

---

## 8. 验收（可证伪，D1≠a 时适用）

1. `bun run typecheck` → **0 错误**；
2. `bun run lint:arch` → **错误 0**（警告回基线）；
3. `grep -rn "new CouncilOrchestrator" app/src` → **仅 1 处**（= 单一构造点 `getCouncilOrchestrator()` 内部；其余命中均为**注释**）⇒ **模块外构造点 0**；
4. `selectCollaboration` 判据**逐条等价**于 §1.2 现状（契约用例 + 证伪控制组）；
5. 全量 `bun test` → **0 fail**（当前基线：4606 pass / 21 skip / 0 fail / 4627 tests / 486 files）。

---

## 9. 实施记录

| 日期 | 事件 | 详情 |
|---|---|---|
| 2026-10-06 | **立项（未动码）** | 本 spec 创建（来源报告 09 A10）。取证：两引擎 × 3 构造点 + 无统一取舍（`selectCollaboration` 0 命中）。**状态=待评审**，实施须先答 §5 D1–D4 |
| 2026-10-06 | **T1 分层取证** | ① `tasks`/`workspace`/`chat`/`tools` 均 **app** 层，`runtime` = **service** 层（`scripts/modules-to-layers.json:36/43/50/68/80`）；② `workspace` 与 `tasks` **互不导入**（各 0 命中）⇒ 无环；③ `@modules/workspace/CouncilOrchestrator` **已在 R03-002 白名单**（`lint-architecture.ts:2201`）⇒ 复用该入口**零门禁改动**；④ Swarm 已只有 1 个构造点（`AgentTool.ts:1799`）⇒ 无缺口 |
| 2026-10-06 | **G1 实施（D1=b）** | ① 新增单一构造点 `getCouncilOrchestrator()`（`workspace/CouncilOrchestrator.ts:681-686`，模块内单例，复用 `getCouncilEngine()`）；② `chat/ChatManager.ts:2619-2628` 与 `runtime/api/domainSnapshotOps.ts:1665-1670` 两处 `new CouncilOrchestrator(...)` 改走该入口 ⇒ **模块外构造点 2 → 0** |
| 2026-10-06 | **验证（四证）** | `typecheck` **exit 0** · `lint:arch` **错误 0 / 警告 4（基线）**，且 **违规 0 / 已豁免 0 / type-only 9 / 动态跨层 41 处（36 组合）与改动前逐数一致 ⇒ 零新边** · `eslint`（3 改动文件）**0 problem** · 全量 `bun test` **4606 pass / 21 skip / 0 fail**（4627 tests / 486 files）**与基线逐数一致** |

### 9.1 如实偏差与边界（CS06）

1. **G3（`CollaborationEngine` 窄端口 + 两引擎适配器）未实施 —— 按 CS03 暂缓**。理由：D1=b **不含统一派发**（G2 未做）⇒ 端口无任何消费者，落地即**死抽象**（违 CS03「不为不存在的场景造代码」与 `PY_APP.md §2` 简洁优先）。且两种落点均有代价：① 放 `tasks` ⇒ 需新增 `@modules/tasks/collaboration` 门禁白名单，或走 tasks 桶（会把 `@modules/ai` 等重依赖拉入全部 tasks 消费者，叠加载入序风险）；② 放 `workspace` ⇒ 引入 `workspace → tasks` 新静态边。**收益为零、代价非零** ⇒ 暂缓。**端口应在 D1=c（统一派发）时随消费者一并落地**。
2. **Swarm 未纳入任何新入口**：其唯一构造点（`tools/AgentTool/AgentTool.ts:1799`）**本就单一**，包一层只增边、无收益（N1/CS03）。
3. **D4 保持**：未触碰流式路径（§6-U3 仍为未取证项）。
4. **`getCouncilOrchestrator()` 为模块内单例**：与 `getCouncilEngine()`（`CouncilEngine.ts:410`）同法；两处原调用**本就**取同一引擎单例，且 `setCouncilEmitter()` 作用于引擎（非 orchestrator）⇒ **单例化不改变 emit 语义**（零行为变更）。
5. **未加单测**：G1 是「构造点收敛」的纯重构，无独立可观测行为（原有 Council 无专测）；验证以 `typecheck` + `lint:arch` 零新边 + 全量回归逐数一致为准。

---

## 10. 与既有 spec 的关系

| Spec | 关系 |
|---|---|
| `orchestration-family-convergence.md` | **前置**：A4 本体家族收敛已完成（28→20）；本 spec 处理其**未覆盖**的"协作引擎取舍" |
| `orchestration-lifecycle-contract.md` | **平行**：该 spec 定义 L1/L2/L3 **生命周期**三分法；本 spec 定义**协作**取舍契约，互不重叠 |
| `pattern-executable-assembly.md` | 其 §43 明示 `CollaborationOrchestrator` 不在其范围 ⇒ 本 spec 承接 |
| `pattern-trigger-surfaces.md` | 同族"触发面"议题；本 spec 的 U3（流式触发）与之交叉，须去重 |
