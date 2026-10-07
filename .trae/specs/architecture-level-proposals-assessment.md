# Spec：架构级新提案评估（旁路裁决 / MVCC 悲观预扣 / 在线红队自纠）

> 版本 1.0 ｜ 创建 2026-10-07 ｜ 状态：✅ **已评估 —— 三项终局裁定均为「不实施」，零代码改动**
> 来源：`dev_docs/20261007/google ai 建议.md` **§二 三项建议**（相对 20261006/20261005 报告的新面）
> 台账锚点：**§7.4**（建议三 红队自纠）· **§29.1**（§二 三项 · 细化三）· **§12-T-1 / §21.3**（AI-VFS，另立契约）
> 关联规则：GR15（Spec-Driven）/ **CS01**（归一化）/ **CS02**（状态判定）/ **CS03**（回退最小化）/ **CS05**（根因优先）/ **CS06**（证据驱动）/ `.trae/rules/development-workflow.md §2.14 规则 5`（搁置必须附触发条件）

---

## 0. 一句话

外部报告连续 3 日（2026-10-05/06/07）提出「架构级优化建议」，其中 **20261007 §二 的两项（旁路裁决 · MVCC 悲观预扣）为首见新面**。
本 spec 对三项**逐项回仓取证**（`file:line`），给出**终局裁定 + 触发条件**，并**明确不做**（CS03）。
**本 spec 零代码改动** —— 与 `cs03-abuse-forward-assessment.md` / `contract-layer-6-proposals.md` / `cross-path-evaluation-write-side.md` 同一手法。

---

## 1. 三项清单与出处（含台账口径订正）

| # | 提案 | 外部出处 | 台账现有处置 | 本 spec 动作 |
|:--:|---|---|---|---|
| **P1** | **旁路裁决（Out-of-Band Verifier）**：将 U4 可疑轮复核异步化，用**独立子进程 / Worker 线程**隔离大模型调用，避免阻塞主事件循环 | `dev_docs/20261007/google ai 建议.md` §二 建议一（`:17/:42`） | ⏳ §29.1「架构级新提案待裁定」 | §2.1 取证 → §3 裁定 |
| **P2** | **MVCC 悲观预扣隔离**：为后台冲突检测与未来自动修复升级**事务隔离与悲观锁**，防多会话并发写入导致数据覆盖 | 同报告 §二 建议二（`:18/:43`） | ⏳ §29.1 / §7.4-B | §2.2 取证 → §3 裁定 |
| **P3** | **在线对抗性红队自纠**：将自动派生的 JUnit 测试转化为**在线**红队，用 **OTel GenAI 日志流**构建生产语料回灌与漏洞修复**演进闭环** | `dev_docs/20261006/google ai 建议.md` §二 建议三（`:19`）+ `20261007` §细化三（`:521-545`）；台账 §7.4-B 建议三 | ⏳ §7.4「先立 spec 论证，不排期」 | §2.3 取证 → §3 裁定 |

> **AI-VFS（第三项之一）不重复评估**：`20261007` §二 建议三 = AI-VFS，已并入 **§12-T-1** 并**已立契约** —— 见 [ai-vfs-driver-contract.md](./ai-vfs-driver-contract.md)（4 系统调用 + `IVfsDriver` + D1–D5 + 触发条件，**裁定不实施**）。本 spec 不再覆盖。

### 1.1 台账口径订正（CS06，如实）

台账 **§29.1** 原文：「§二 三项建议（旁路裁决 · MVCC 悲观预扣 · AI-VFS）…… ➖ **同源**：= 20261006/20261005 报告的同三项」。
**实测不成立（部分）**：逐份比对三份报告的「§二 / 优化」清单 ——

| 报告 | §二 三项内容 |
|---|---|
| `20261005` | ① VFS 驱动契约 ② ACP→IPC/信号总线 ③ MMAP 零拷贝交换区（`:25/:38/:45`） |
| `20261006` | ① 零拷贝 VFS 句柄 + RRF ② A2A 动态 Agent Card 反向协商 ③ 在线对抗性红队自纠（`:17/:18/:19`） |
| `20261007` | ① **旁路裁决 Out-of-Band Verifier** ② **MVCC 悲观预扣隔离** ③ AI-VFS（`:17/:18/:19`） |

⇒ **仅 AI-VFS 一项在三份中同源**（`20261005`① ≈ `20261006`① ≈ `20261007`③）；**旁路裁决 / MVCC 悲观预扣为 20261007 首见**，**非**「20261006/20261005 的同三项」。
⇒ 台账 §29.1 该行**措辞失真**，本 spec 一并订正（记录见 §7）。

---

## 2. Problem Statement（逐项取证）

### 2.1 P1 旁路裁决（Out-of-Band Verifier）

**外部前提**：「U4 可疑轮复核**阻塞主事件循环** ⇒ 应以子进程 / Worker 隔离大模型调用」。

**回仓实测**（`app/src/evals/online/turnQualityEvaluator.ts` / `app/src/chat/orchestrator/ChatOrchestrator.ts`）：

| 事实 | 证据（file:line） |
|---|---|
| U4 **只在空闲期执行**；主链**零调用**（`streamMessageFlow` / `TAORLoop` 都不碰） | `turnQualityEvaluator.ts:178`（「空闲期调用；主链不得调用」）；`ChatOrchestrator.ts:512-524`（不可信注释：「主链**零调用**……不增 TTFB」） |
| 挂载点 = `IdleScaleMonitor.onIdle`，且为 **fire-and-forget**（`void Promise.resolve(...)` ⇒ 不 await、不进主链 promise 链） | `ChatOrchestrator.ts:484`（`onIdle`）+ `:525`（`void (async () => {...})()`）；`app/src/core/idle/IdleScaleMonitor.ts:126` |
| 已有**逐 20 轮让出事件循环**（CPU 纯函数打分段） | `turnQualityEvaluator.ts:37/86`（`YIELD_EVERY_TURNS=20` → `setImmediate`）；`:142-145` `yieldToEventLoop()` |
| LLM 复核是 **`await` 异步网络 I/O**（不是同步 CPU 块） | `turnQualityEvaluator.ts:290-296`（`await reviewer({...})`）；`app/src/chat/quality/turnQualityReviewer.ts:104-131`（`VerifierAgent.verify` → `chatStream` 异步） |
| 成本硬上限：单次空闲**最多复核 `MAX_REVIEWS_PER_IDLE = 5` 轮**（分数最低者优先） | `turnQualityEvaluator.ts:285-289`；`app/src/evals/online/weights.ts:98`（`MAX_REVIEWS_PER_IDLE = 5`） |
| 单会话级错误隔离（失败不中断整轮 pass，交调用方 `handleError`） | `turnQualityEvaluator.ts:38-39/197-207` |

**结论（前提不成立）**：复核**已在空闲缝 + 已让出 + 已限流 + 已错误隔离**；其 LLM 调用为 **I/O-bound 异步**。
`Worker` / 子进程隔离对 **I/O-bound** 工作是**零收益**（阻塞发生在网络等待、不在本进程 CPU），反而引入 IPC 序列化、跨隔离状态同步与调试复杂度。

**既有 Worker 用法（如实，非本项支持证据）**：本仓 Worker 仅用于 **CPU 密集 / 强隔离**场景 —— `app/src/tasks/dream/dreamWorker.ts:1`（`worker_threads`，梦境思考）、`app/src/sandbox/worker-script.ts`（沙箱执行）。二者均**非**为了"隔离网络 I/O"。

**唯一潜在收益**：若未来**评分/派生同步块**成为实测热点（当前已被分片让出处理），才需评估把**该 CPU 块**（非 I/O）移入 Worker。

---

### 2.2 P2 MVCC 悲观预扣隔离

**外部前提**：「多会话并发写入导致**数据覆盖** ⇒ 需事务隔离 + 悲观锁」。

**回仓实测**（会话事件日志 / 记忆存储 / DB）：

| 层 | 现状 | 证据（file:line） |
|---|---|---|
| 会话事件日志 | **per-session 独立文件**（一实例一会话）+ **append-only**；跨会话**物理隔离** ⇒ 不存在"跨会话互相覆盖" | `app/src/session/storage/EventLogStorage.ts:8`（路径 `…/sessions/<worktreeHash>/<sessionId>/events.jsonl`）、`:162`（「一个实例对应一个会话」）、`:18`（`fs.appendFile` O(1)） |
| 会话内并发写 | **同实例 `append` 经 mutex queue 串行化**（Promise 链），保 seq 单调与到达序 | `EventLogStorage.ts:22`（「同一实例内 append 串行化（mutex queue）」）、`:261`、`:1343-1351`（`queueAppend`） |
| 单文件原子写 | `tmp + rename` 原子替换（会话快照 / 记忆文件同法） | `app/src/session/persistence/AtomicWriter.ts:42`；`app/src/memory/adapters/FileSystemAdapter.ts:67-70` |
| DB | 全局 **SQLite WAL**（`app.db`），写事务串行、读为快照 | `.trae/rules/`（§1.5 数据库统一约定）；GAI-3 复核（§7.3）：PDCA 已迁 `app.db` |
| **后台冲突检测**（外部所指） | U3 记忆冲突检测 —— **只检测与记录，不改写任何记忆**（不删除/不更新/不写 metadata） | `app/src/memory/MemoryManager.ts:493-497`（注：「只检测与记录」）、`:534`、`:536-556` |
| 已知 RMW 竞态 | 已由 `PdcaWorkItemBridge` 的 `writeChain` **串行化**消解（P1-26 / GAI-3，commit `c095f3336`） | `app/src/tasks/PdcaWorkItemBridge.ts`（写经 `writeChain`） |

**结论（前提不成立）**：
1. 报告所指的「后台冲突检测」是 **read-only**（U3 明确不改写）⇒ **不存在**要加锁的写冲突；
2. 会话数据模型是 **per-session 文件 + append-only**，**结构上排除**"多会话并发写入互相覆盖"；
3. 「**未来自动修复**」**尚未实现**（0 命中）⇒ 为其预建 MVCC / 悲观锁属 **CS03**（为不存在/未证实的场景加机制）；
4. MVCC / 悲观锁面向的是 **多进程共享同一可变存储** 的 lost-update 场景，与当前**单进程 + 分文件 + WAL** 的事实**不匹配**。

---

### 2.3 P3 在线对抗性红队自纠

**外部前提**：「把**自动派生的 JUnit 测试**转化为**在线**对抗性红队，用 **OTel GenAI 日志流**构建**生产语料回灌与漏洞修复**的演进闭环」（`20261007` §四 `:558` 自问：「要不要挂载在主链 `onIdle` 上？」）。

**回仓实测 —— 离线红队底座**已落地（≠ 在线闭环）：

| 组件 | 现状 | 证据 |
|---|---|---|
| 形态 B（机械反作弊） | 5 向量 + 三态（`blocked`/`exposed`/`knownGap`）+ `--cheat-gate` fail-closed | `app/src/evals/antiCheatAudit.ts`；`.trae/specs/adversarial-agent-form-a.md` §1.1（`:26`） |
| 形态 A（LLM 红队提案器） | **提案与裁决分离**：LLM 只提案（`adversarialProposer.ts`），机械裁决复用形态 B（`adversarialAgent.ts`）；默认关；**e2e 已实测**（提案 4 条） | `app/src/evals/adversarialProposer.ts` / `app/src/evals/adversarialAgent.ts`；同 spec §10.1/§10.2（`:292-340`） |
| 域边界 | 评测 harness 是**黑盒 HTTP 客户端**（`streamChat(sandbox.baseUrl, …)`），与主会话轨迹**不同域**（离线） | `adversarial-agent-form-a.md` §5.1（`:173-177`） |
| ASR 指标 | **离线**有成对测量 + 聚合 ASR（Max 口径） | `app/src/evals/types.ts`（`aggregatedAsr`）/ `app/src/evals/scoring.ts`（§7.4-A-3） |
| 在线侧 | 仅 **U4 `turn/quality` 事件**（质量打分/复核），**无**"从生产日志派生攻击语料 / 自动修复" | `turnQualityEvaluator.ts:328`（落 `turn/quality` 事件） |

**缺口实测（0 命中）**：①「生产 OTel 日志 → 攻击语料派生器」（无）；②「onIdle 红队突变派生器」（未挂载）；③「在线 ASR 自动门禁」（无，ASR 仅离线）；④「自动修复（LLM 自动改代码）」（不存在）。

**结论（前提成立，但处方越界）**：
- "在线化" 是**新架构面**（跨 `evals`(离线) → 主链/生产日志/自动修复），收益**未证**（CS03）；
- 报告自身在 §四 `:558` 仍在**询问**是否挂 `onIdle` ⇒ **方案未定**；
- "**自动修复**"（LLM 决策直接改代码）与项目既有纪律冲突：CS04（Mock 零容忍）精神 + `model-usage.md`（模型不得擅自决策）+ 变更需人审（本会话所有落地均"用户裁定后实施"）；
- 生产语料回灌涉及**隐私取舍**（同 P26-2 P4 的 `OUTPUT_GUARD_KEEP_ORIGINAL`：默认只记元数据、原文入日志需显式开关）⇒ 未评估隐私即回灌**不可接受**。

---

## 3. 终局裁定（CS03 / R12-1 规则 5）

| # | 提案 | 裁定 | 理由（归一化 + 根因） |
|:--:|---|:--:|---|
| **P1** | 旁路裁决 Out-of-Band Verifier | ❌ **不实施** | 前提"阻塞主事件循环"**不成立**（空闲缝 + 让出 + 限流 + 异步 I/O）；Worker 对 I/O-bound **零收益**，违 CS03 |
| **P2** | MVCC 悲观预扣隔离 | ❌ **不实施** | 冲突检测是 **read-only**（`MemoryManager.ts:534`）；会话为 **per-session 文件 + append-only**；"未来自动修复"**不存在** ⇒ 为未证实/不存在场景加锁，违 CS03；与同族已证伪项（**§7.2 P2-1 / GAI-6**「Token 悲观预扣 + 回滚」）**同源** |
| **P3** | 在线对抗性红队自纠 | ❌ **不实施** | 离线红队底座已落地（形态 A/B）；"在线化 + 自动修复"是**新架构面**且**收益未证**、**方案未定**（报告自问）、触**隐私**与**模型不得擅自决策**红线；另行评估 ⇒ **先不立项**（与 `adversarial-agent-form-a.md` §8.1「收益不确定、可只评审不实施」一致） |

> **同源去重**：P2 ≈ §7.2 **P2-1 / GAI-6**（悲观预扣，已证伪）；P3 ≈ **R11-2 / §11-A6**（跨路径评估）的**邻近面**但不同体（R11-2 = 评估写入端收口，已在 `cross-path-evaluation-write-side.md` 裁定不立项）；P3 的"新手法登记闭环"已在 `adversarial-agent-form-a.md` §8.6 规定（**保持离线**）。

---

## 4. 触发条件（可复评，R12-1 规则 5）

| # | 仅当满足以下**全部**条件时才重新评估 |
|:--:|---|
| **P1** | ① 出现**实测**事件循环滞后告警（`TurnLivenessWatchdog` / `IdleScaleMonitor` 采样超阈，见 `project_memory` 的 watchdog 口径）；且 ② 归因于空闲 pass 的**同步 CPU 块**（非 I/O）—— 此时**只评估把该 CPU 块移入 Worker**（**不移 I/O**） |
| **P2** | ① 引入**多进程 / 多机共享同一可变存储**（如多实例共用一个 `app.db` 或新的跨会话共享可变文件）；且 ② **实测到 lost update**（写覆盖）—— 此时才评估事务隔离级别 / 悲观锁 |
| **P3** | ① **离线**对抗 harness 长期无法覆盖**线上真实失败分布**成为**实测痛点**（有失败样本统计佐证）；且 ② 完成**隐私评估**（生产语料回灌的脱敏/开关，参照 `OUTPUT_GUARD_KEEP_ORIGINAL`）；且 ③ 明确**边界 = 只提案、不自动修复**（自动改代码不纳入） |

---

## 5. 合规（对照 workspace rules）

| 规则 | 落点 |
|---|---|
| GR15 Spec-Driven | ✅ 本 spec 先行；**零代码**（评估类文档） |
| **CS01 归一化** | ✅ 三项均先查已有（U4 空闲缝 / per-session 存储 / 离线红队底座）⇒ **不另起炉灶**；P2 与 P2-1 同源去重 |
| CS02 状态判定 | ✅ 裁定以**持久化事实**（文件模型 / 事件 / 只读语义）为据，非文案 |
| **CS03 回退最小化** | ✅ 三项均**不加机制**（未证实场景）；P3 明确**不做自动修复** |
| **CS05 根因优先** | ✅ 指出 P1 根因是"报告误判阻塞面"、P2 根因是"存储模型与建议不匹配"、P3 根因是"在线化无触发场景" |
| **CS06 证据驱动** | ✅ 每项结论均附 `file:line`；**并订正台账 §29.1 口径失真**（§1.1） |
| R12-1 §2.14 规则 5 | ✅ 本 spec 即"≥2 轮同因 ⇒ 一次前瞻评估 + 终局裁定"的**执行实例** |
| `.trae/rules/versioning.md` | ✅ 不改版本（无代码/接口变更） |

---

## 6. 风险与边界（如实）

1. **不做 ≠ 永久否决**：三项均有**触发条件**（§4），达标即重评；本 spec 只关闭"当下无据"的立项。
2. **P1 的边界**：本 spec **未**声称 U4 空闲 pass "绝不产生任何卡顿" —— 仅指**当前无证据**表明它阻塞主链；若未来有实测证据，按 §4-P1 处理。
3. **P2 的边界**：本 spec 基于**单进程 + 分文件 + WAL** 事实；若架构演进为多进程共享存储，结论**自动失效**。
4. **P3 的边界**：**不**否定"在线红队"的长期价值；仅指出其**当前收益未证 + 方案未定 + 触隐私/自动化红线** ⇒ 需先立新 spec 专评估。
5. **外部报告可信度（如实）**：`20261007` §一/§二/§三**逐字出现两次**，有效新内容仅"发布建议"一项；其 §二 首次出现的两项（旁路裁决 / MVCC）**未附本仓证据**，属推测性建议。

---

## 7. 实施记录（2026-10-07 · 零代码）

| 项 | 结果 |
|---|---|
| 回仓取证 | P1：`evals/online/turnQualityEvaluator.ts` / `chat/orchestrator/ChatOrchestrator.ts` / `core/idle/IdleScaleMonitor.ts` / `chat/quality/turnQualityReviewer.ts`；P2：`session/storage/EventLogStorage.ts` / `session/persistence/AtomicWriter.ts` / `memory/adapters/FileSystemAdapter.ts` / `memory/MemoryManager.ts` / `tasks/PdcaWorkItemBridge.ts`；P3：`evals/adversarialAgent.ts` / `evals/adversarialProposer.ts` / `evals/antiCheatAudit.ts` / `adversarial-agent-form-a.md` |
| 代码改动 | **0**（纯评估） |
| 台账订正 | **§29.1**：20261007 §二 三项「同源」措辞**失真** ⇒ 订正为「**仅 AI-VFS 同源**；旁路裁决 / MVCC 为 20261007 **首见**」（§1.1） |
| 台账回填 | **新增 §30**：三项终局裁定表（不实施）+ 触发条件指针 + 本 spec 链接 |
| 门禁 | 不涉及代码 ⇒ `typecheck` / `lint:arch` / `lint:size` / `bun test` **无需重跑**（未改源文件）；`lint:doc-code` 仅断言 `project_rules §1.4` × `featureFlags.ts`，与本 spec 无关 ⇒ 不受影响 |
| 推送 | 本 spec 变更（`.trae/specs/**` 入库）随本批提交 |

**未做（明确）**：未按报告落地任何一项（P1 子进程隔离 / P2 MVCC+悲观锁 / P3 在线红队+自动修复）；未改任何源文件；未升版。
