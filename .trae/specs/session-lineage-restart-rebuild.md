# Spec：会话血缘**启动期从盘重建**（P3-1 裁定 A）

> **状态**：✅ **已实现**（T1–T5 完成；A/B 实得 3 红可归；门禁见 §5）
> **来源**：预存项 P3-1「Tier1 血缘链不跨进程存活」——[台账设计确认](file:///e:/PY/Documents/CODES/PY_APP/dev_docs/error_repairs/预存错误与待处理问题.md#L3902-L3940)（2026-09-26）
> **裁定**：2026-09-26 用户选定 **方案 A：启动期从盘重建**；同日追加裁定 **`parent-unknown` ⇒ 登记该边、视为链头**（理由：保住链形状与深度计数，避免跨重启绕过 `MAX_LINEAGE_HOPS`）
> **代码面**：`app/src/session/lineage/sessionLineage.ts` · `app/src/session/recovery/RecoveryOrchestrator.ts` · `app/src/chat/ChatManager.ts`（端口接线）
> **最后更新**：2026-09-26

---

## 1. 背景（复核事实，均带证据）

| # | 事实 | 证据 |
|---|---|---|
| 1 | 血缘链是**模块级内存 Map**（`子 → 父`） | `sessionLineage.ts` L26 `parentBySession` |
| 2 | **唯一写入点** = fork **成功后**登记 | `SessionGateway.ts:903`（`src/` 内仅此一处调用） |
| 3 | **数据已落盘**：fork 把 `metadata.parentSessionId` 写进子会话 | `SessionGateway.ts:807-815`（经 `createSession`） |
| 4 | **唯一消费点** = 控制面 `stopAgent` 的 Tier1，fail-closed | `AgentTool.ts:3086/:3099` |
| 5 | 恢复编排**只描述、不重建**，`rebuilt` 为字面量 `false` | `RecoveryOrchestrator.ts:55-56 / :72 / :77-79 / :156-171 / :188` |
| 6 | 契约已被用例固化（"非本进程 fork ⇒ 拒绝"） | `tests/tools/AgentTool/agentControlOwnership.test.ts:112-122` |
| 7 | **⚠️ 新发现**：`forkSession` 的**环/深度守卫读同一条链** ⇒ 重启后链空时**守卫被弱化**（可建出超深链；若 `childId` 实为 `sourceId` 的祖先，**可建出互为祖先的环**） | `SessionGateway.ts:790-798`（环）、`:799-805`（深链）；`wouldCreateLineageCycle` / `getLineageDepth` 均取自该 Map |

**为什么不再是"只保留现状"**：原记录把本项定性为"fail-closed **可用性**缺口"。但事实 7 表明它同时**弱化了一条安全守卫**（该守卫存在的意义正是阻止"互相授予控制权"）⇒ 用户裁定采用 **A**。

---

## 2. 目标与范围

**目标**：进程启动时**从盘重建**血缘链，使（a）重启后控制面 Tier1 能正确放行合法的祖先会话；（b）`forkSession` 的环/深度守卫在重启后**不再被弱化**。

**在范围**：血缘重建入口（纯函数 + 装配）、启动期接线、恢复报告字段从"写死 false"改为**真实结果**、`sessionLineage` 头注释的"失效边界"**声明改写**。

**不在范围**（明确不做）：
- ❌ 不为血缘**新增持久化载体**（复用已有 `metadata.parentSessionId`）；
- ❌ **不改**控制面同步签名（`stopAgent` 仍同步；重建发生在启动期）；
- ❌ **不改** `isAncestorSession` 的语义（仍 `max_hops=8` + 环保护 + 查不到即拒）；
- ❌ 不做运行期**实时跨进程同步**（仅启动期一次性重建）。

---

## 3. 设计

### 3.1 重建入口（`sessionLineage.ts`）

```ts
export interface LineageRebuildStats {
  scanned: number;      // 扫描到的会话数
  registered: number;   // 成功登记的边数
  dropped: Array<{ childId: string; parentId: string; reason: 'cycle' | 'too-deep' | 'parent-unknown' | 'self' }>;
  size: number;         // 重建后链规模
}
export function rebuildSessionLineage(
  entries: ReadonlyArray<{ id: string; parentSessionId?: string | null }>
): LineageRebuildStats
```
- **纯函数**（只依赖入参 + 模块状态）⇒ 可离线全量覆盖；
- 复用 `registerSessionLineage`（自动继承"自环忽略 + 幂等 + 空值忽略"语义）；
- 重建**前**先 `resetSessionLineage()`（幂等：重复调用结果一致）。

### 3.2 重建算法（**确定性**，含安全净化）

1. 建立 `id → parentId` 映射（忽略 `self` / 空值）；
2. **多轮稳定插入**：反复遍历未登记的边，凡是 `parent` 已在 Map 中或 `parent` 无父（链头）即可登记；这样**父在子先**，避免顺序依赖；
3. 每登记一条前用既有守卫判定（**与 `forkSession` 同一套判据**）：
   - `wouldCreateLineageCycle(child, parent)` ⇒ 丢弃，`reason='cycle'`；
   - `getLineageDepth(parent) + 1 > MAX_LINEAGE_HOPS` ⇒ 丢弃，`reason='too-deep'`；
   - `child === parent` ⇒ 丢弃，`reason='self'`（在收边阶段即拦）；
4. **`parent-unknown`（父会话不在入参里）⇒ 仍登记、视为链头**（**2026-09-26 裁定**）：保住链形状与深度计数（否则跨重启后深度恒 0 ⇒ 可绕过 `MAX_LINEAGE_HOPS`）；上溯到该链头即停，仍 fail-closed；
5. 多轮后仍无法推进的边只可能来自**环** ⇒ 末轮按插入顺序处理（能登记的先登记，成环的丢弃）；
6. **丢弃是 fail-closed 方向**：丢边 ⇒ 更可能判否（拒绝），**不会**误放行。

> 为什么需要净化而不是"信盘上数据"：盘上数据可能来自**旧版本**、手工编辑或历史漏洞 ⇒ 直接灌入会让 ①环②超深链在重建后**长期生效**，反而把守卫弱化固化成"新常态"。

### 3.3 数据源（含一处口径决定）

用**能拿到全部会话（含 `metadata`）**的入口读取 `{ id, parentSessionId }`。
- 现成入口：`SessionGateway.listSessions(filter?)` ⇒ `UnifiedSession[]`，元素带 `metadata`（同文件 L1095-1097 已在读 `metadata.temporary`）。
- ⚠️ **口径决定**：`listSessions()` **过滤掉 `temporary` 会话**。血缘判定与"是否显示在历史列表"**无关**，故重建应取**不过滤 temporary** 的全量（实现时优先用底层 `storage.listSessions()`，若其不可得则用 `listSessions({ includeTemporary: true })` 之类的显式开关；**不允许**静默漏掉 temporary 会话）。

### 3.4 时机与接线

- **端口契约**（`RecoveryOrchestrator.ts`）：把 `lineage: { describe(): { size: number } }` 扩为
  `lineage: { describe(): { size: number }; rebuild(entries): LineageRebuildStats }`；
- **④ 步骤**（`:156-171`）：改为调用 `ports.lineage.rebuild(...)`（数据由端口实现方提供，编排层不碰存储 ⇒ 维持 `session ↔ chat` 无环）；
- **报告**（`:72`）：`rebuilt: false` 字面量 → `rebuilt: boolean`；`reason` 改为**真实原因**（成功 = 已重建 N 条/丢弃 M 条；失败 = 具体错误）；
- **接线点**（`ChatManager.ts:4996`）：在构造 ports 处实现 `rebuild`（读全量会话 → 调 `rebuildSessionLineage`）。

### 3.5 声明改写（必须，否则代码与文档互相矛盾）

- `sessionLineage.ts` 头注释的"**失效边界**"从"只覆盖本进程内观测到的 fork"改写为：
  "**启动期从盘重建**（`metadata.parentSessionId`）；**重建不到**（元数据缺失 / 被净化丢弃 / 重建失败）的边仍 **fail-closed**（拒绝，不误放行）"；
- 删/改 `LINEAGE_NOT_REBUILT_REASON`（不再适用），恢复报告改用真实 reason；
- L11-16 三条理由中，**只有"fork 由进程建立、进程内即可观测"被推翻**（跨进程序列），需同步更正该条；另两条仍成立并保留。

### 3.6 失败与降级

| 情形 | 行为 |
|---|---|
| 重建读取失败（存储异常） | 报告 `rebuilt:false` + 真实错误；**行为回到今日**（链空 ⇒ 控制面误拒、fork 守卫弱化）**但报告如实**（不谎报已重建） |
| 单条边不合法 | 丢弃并计入 `dropped`（不中断整体重建） |
| 重建后仍查不到 | 控制面 fail-closed 拒绝（语义不变） |

---

## 4. 变更清单

| 文件 | 变更 |
|---|---|
| `app/src/session/lineage/sessionLineage.ts` | 新增 `LineageRebuildStats` + `rebuildSessionLineage()`（纯函数）；改写头注释的失效边界与 L11-16 第②条 |
| `app/src/session/recovery/RecoveryOrchestrator.ts` | 端口加 `rebuild()`；④ 步骤改调用；报告 `rebuilt: boolean` + 真实 reason（成功带"扫描 N/登记 M/净化丢弃 K（原因×条数）"）；删除 `LINEAGE_NOT_REBUILT_REASON`（改 `LINEAGE_PENDING_REASON` 占位）+ 新增 `describeDropped()` |
| `app/src/chat/ChatManager.ts` | L4997-5013 端口实现：读取全量会话（`includeTemporary: true`）→ `rebuildSessionLineage` |
| `app/src/session/types/UnifiedSession.ts` | **（实现期新发现，需此可选项才能不漏 temporary 会话）** `SessionFilter` 增 `includeTemporary?: boolean`。⚠️ **路径订正（2026-10-05）**：原写 `types/Session.ts`，该文件不存在；实际为 `types/UnifiedSession.ts` |
| `app/src/session/SessionGateway.ts` | `listSessions()` 兑现 `includeTemporary`（默认 `false` ⇒ 既有调用方行为不变） |
| `app/src/session/index.ts` | 桶导出 `rebuildSessionLineage` 与三个重建类型 |
| `app/tests/session/sessionLineageRebuild.test.ts` | **新建** 9 例（基本 / 顺序无关 / 空字段 / 自环 / 环 / 超深 / parent-unknown / 幂等 / 重建后 fork 守卫恢复） |
| `app/tests/session/recoveryOrchestrator.test.ts` | 夹子补 `rebuild`；新增 3 例（成功带明细 / 净化摘要 / **失败如实不谎报**） |
| `app/tests/tools/AgentTool/agentControlOwnership.test.ts` | 新增 2 例（重建后祖先可中止 / 重建≠放开） |
| `.trae/specs/session-lineage-restart-rebuild.md` | 本文件 |

---

## 5. 验收（**已完成**，2026-09-26）

> **落点（如实现与预期有差异，如实标注）**：用例 1–7 落于**新建** [sessionLineageRebuild.test.ts](file:///e:/PY/Documents/CODES/PY_APP/app/tests/session/sessionLineageRebuild.test.ts)（9 例，含拆出的"空字段"与"重建后守卫恢复"两例）；用例 8 落于 [agentControlOwnership.test.ts](file:///e:/PY/Documents/CODES/PY_APP/app/tests/tools/AgentTool/agentControlOwnership.test.ts)（2 例：重建后祖先可中止 / 重建≠放开）；编排层落于 [recoveryOrchestrator.test.ts](file:///e:/PY/Documents/CODES/PY_APP/app/tests/session/recoveryOrchestrator.test.ts)（3 例新语义）。**既有契约用例**「血缘链未覆盖 ⇒ fail-closed 拒绝」**未改且仍通过**（它不重建）。

**用例（离线，全量可跑）**：
1. **基本重建**：`c→b→a` 三条边 ⇒ 重建后 `isAncestorSession('a','c')===true`、`getSessionParent('c')==='b'`；
2. **顺序无关**：入参乱序（子先父后）⇒ 结果与有序一致（验证 §3.2 的多轮稳定插入）；
3. **净化·环**：入参含 `x→y, y→x` ⇒ 两条边都**不**登记（或仅登记不构成环的那条）且 `dropped` 含 `cycle`；
4. **净化·超深**：构造 9 跳链 ⇒ 超限边被丢弃且 `dropped` 含 `too-deep`；
5. **parent-unknown**：`c→ghost`（ghost 不在入参）⇒ 视为链头（可登记）**或**按设计丢弃 —— **以 §3.2 第 3/4 条的最终实现为准，用例锁定实现选择**；
6. **幂等**：连续调用两次 ⇒ `size` 相同、无重复边；
7. **自环/空值**：`x→x`、`parentSessionId: null/''` ⇒ 忽略，不计入 `dropped`（与既有 `registerSessionLineage` 一致）；
8. **解封控制面**（端到端语义）：重建后 `stopAgent(agentInChild, {requesterSessionId: ancestor})` 从"拒绝"变为**放行**（用既有 `agentControlOwnership.test.ts` 的 stub 手法；**新增**用例，**不改** L112-122 那条"未覆盖 ⇒ 拒绝"的既有契约 —— 它仍然成立，因为该用例**不重建**）；
9. **fork 守卫恢复**：重建后再走 `wouldCreateLineageCycle` / `getLineageDepth` ⇒ 与"重启前同一进程内"的判定一致（即事实 7 的两条弱化都消失）。

**A/B（可证伪）**：
- ① 去掉**净化**（直接把盘上边全灌入）⇒ 用例 3/4 变红；
- ② 去掉**重建调用**（回到只 `describe`）⇒ 用例 8/9 变红；
- ③ 让 `rebuilt` 写死 `true` ⇒ 重建失败场景的用例变红（防"谎报已重建"）。

**门禁**：`typecheck` **0** · `eslint`（本轮改动 9 文件）**0** · `lint:arch` **0 错 0 警** · `tests/session` + `tests/tools/AgentTool` **419 pass / 0 fail** · 全量 **3964 pass / 19 skip / 0 fail / 3983 tests / 405 files**（套件自报 74.27s，较上轮 +14 例 = 本 spec 新增）。

**A/B 实测结果（三项全部执行，如实记录实际红数）**：
- ① 去掉**净化**（不查环/不查深度）⇒ **恰 2 红**（环用例 + 超深用例）；
- ② ④ 退回"只 `describe`"（不调 `rebuild`）⇒ **7 红**（预估 3，实得 7）：其中 **3 例**是 ④ 语义断言（成功 `rebuilt=true` / 净化摘要 / 失败如实），另 **4 例是顺序断言** —— 因测试夹子把 `lineage` 顺序标记打在被变异的 `rebuild` 内，不调用它即无标记 ⇒ **两类一起红**（归属已核明）；
- ③ 失败分支**谎报** `rebuilt:true` ⇒ **恰 1 红**（"如实 rebuilt=false"）。

---

## 6. 合规检查表

| 规则 | 落实 |
|---|---|
| CS01（新增前先查已有） | 复用 `metadata.parentSessionId`（已有持久化）与 `registerSessionLineage`/`wouldCreateLineageCycle`/`getLineageDepth`（既有守卫）⇒ **不新增存储、不重写判据** |
| CS02（禁字符串匹配判状态） | 重建"是否成功"以**结构化 `rebuilt` 布尔 + 结构化 stats**表达，**不**解析日志文案 |
| CS03（回退最小化） | 唯一新增回退是"重建读取失败 ⇒ 保持今日行为"，属**真实场景**（存储异常）且**不掩盖**（报告 `rebuilt:false` + 真实错误） |
| CS05（根因优先） | 修的是"链不跨进程"这一根因（而非在控制面加特例放行） |
| R06-008（避免 `session ↔ chat` 环依赖） | 重建的**存储读取**留在 `ChatManager` 侧的端口实现内，编排层只调端口 ⇒ 不引入新依赖方向 |
| R04-001（文件行数） | 改动均在既有文件，`sessionLineage.ts` 仍远小于上限 |
| 项目 §1.9（错误处理） | 端口实现内失败经既有 `handleError`/编排 `failures[]` 上报，不静默吞 |

---

## 7. 未做 / 风险（如实）

1. **运行期不实时同步**：仅启动期重建；本进程运行中新 fork 的会话照旧走 `registerSessionLineage` ⇒ 语义一致，但**多实例/多进程并发写同一存储**时仍可能不同步（本仓为单进程 daemon，暂不覆盖）。
2. **`parent-unknown` 的处置 —— ✅ 已裁定（2026-09-26）**：**登记该边、视为链头**（见 §3.2 第 4 条），并由用例 `父会话已不在盘上 ⇒ 仍登记该边、视为链头` 锁定。
3. **✅ 真实重启验证已做（2026-10-04）**：本会话内因编辑后端文件，`--watch` 触发**多次真进程重启**（09:57 / 10:42×3 / 10:44 / 10:55 / 11:10 UTC 等）；每次 `session:recovery:orchestrator`「恢复编排完成」均带 **`lineage: {size:1, rebuilt:true}`**（结构化布尔，非文案）⇒ **启动期从盘重建成功且非谎报**。
   - **仍未做**：端到端「重启后父会话停子代理」**动作**（需真实 fork 序列 + agent 控制面动作）——该语义由既有单测（`agentControlOwnership.test.ts` 重建后放行）覆盖。详见台账 V-3。
4. **成本**：重建为启动期一次性全量扫描（会话数 × 元数据读取）⇒ 若会话数很大需关注启动耗时；实现时记录 `costMs` 进恢复报告（已有字段可承载）。

---

## 8. 任务清单（✅ 全部完成）

- [x] T1 `sessionLineage.ts`：`rebuildSessionLineage()` + 声明改写
- [x] T2 `RecoveryOrchestrator.ts`：端口 `rebuild()` + ④ 步骤 + 报告字段
- [x] T3 `ChatManager.ts:4997`：端口实现（全量会话含 temporary，为此新增 `SessionFilter.includeTemporary`）
- [x] T4 用例（单元 9 + 编排 3 + 控制面 2 = 14 例）+ A/B ①②③
- [x] T5 门禁 + 台账/方案回写（含 §7-2 定稿回写）
