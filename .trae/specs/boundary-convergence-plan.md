# Spec：CHANGELOG 边界收口计划（全量排查 → 分级 → 触发条件）

> 版本 1.0 ｜ 创建 2026-10-10 ｜ 状态：📋 **计划（待执行，本文件不含代码改动）**
> 直接来源：`CHANGELOG.md` 全部显式边界行（`ℹ️ **边界（如实）**` / `⚠️ **未完成（如实登记）**` / `⚠️ **登记（非阻断，待触发）**` / `⚠️ **顺带发现（预存）**`）
> 权威台账：`.trae/architecture/fix-evidence-registry.json`（58 条）· `.trae/architecture/invariant-registry.json`（17 条）· `.trae/architecture/invariants.md`（§3 缺口 / §6 安全边界）
> 默认关开关单一事实源：`.trae/specs/default-off-switches-review-gates.md`（§2 登记表 + §2.2 Bash 姿态 + §2.3 复评裁定）
> 关联规则：**CS01**（归一化）· **CS03**（回退最小化）· **CS05**（根因优先）· **CS06**（证据驱动）· **CD01–CD07**（删除安全）· `development-workflow.md §2.14 规则 5`（搁置须附触发条件）
> **行号口径**：下文 `CHANGELOG.md` 行号以本文件写作时的 HEAD（`936fcdacb`，tag `v0.4.76`）为准；CHANGELOG 变更后需按**标题/条目文本**重新定位，不要硬依赖行号。

---

## 0. 一句话

CHANGELOG 中**显式边界共 20 条**（v0.4.74–v0.4.76）+ **历史 `⚠️` 登记 10 条**（v0.4.62–v0.4.72）；与台账交叉后**真正未收口者 15 条**（`fix-evidence` `testVerified=false`）+ **2 条 partial 不变量**。其中**只有 3 条需要写代码**（INV-EXEC-006 handler 用例 · L-9 残余 idx 回退 · 拆分残留 S2/S3/S5），**5 条需要文档订正**（含 2 处**已实测的失实数字/死引用**），**其余维持现状 + 触发条件登记**（复评节奏 2026-Q4 或事件驱动）。

---

## 1. 事实源与统计口径（先算清，再排计划）

| 源 | 总量 | 开放面（本次排查结论） |
|---|---|---|
| `CHANGELOG.md` 显式边界行 | v0.4.76 L34 · v0.4.75 L49 · v0.4.74 L64 · v0.4.73 L79/L80 · v0.4.72 L94 · v0.4.71 L107 · v0.4.70 L118/L122 · v0.4.62 L242 | 子项 **30** 条（去重后 **20** 条独立边界） |
| `fix-evidence-registry.json` | 58 items | `fixed=false` **4** · `testVerified=false` **15** · `e2eVerified=false` **55** · `postReleaseReviewed=false` **58** |
| `invariant-registry.json` | 17 invariants | `partial` **2**（`INV-EXEC-006` · `INV-SEC-003`）；`gap` **0** |
| `default-off-switches-review-gates.md` | §2 登记 **12** 项（含 1 项已翻转为基线）+ §2.1 已裁定排除 **5** 项 | 默认关 **11** 项，均已有可操作触发条件与复评节奏 |

**`fix-evidence` 15 条未收口清单**（`fixed=false ∨ testVerified=false`）：

| ID | 标题 | fixed | testVerified | coded |
|---|------|:--:|:--:|:--:|
| `PLAN-P2-4` | 灰度安全开关复评裁定 + 跨平台安全边界 | ✅ | ❌ | ✅ |
| `PLAN-P2-5` | Execution 生命周期死面登记与裁定 | ✅ | ❌ | ✅ |
| `PLAN-P2-9` | 跨路径评估入口裁定（**有意不做**） | ✅ | ❌ | ✅ |
| `MODE-A1` | 编排决策层错层 | ❌ | ❌ | ✅ |
| `MODE-A2` | 多智能体协作层缺失 | ✅ | ❌ | ✅ |
| `MODE-A3` | 安全/权限同名类双轨 | ✅ | ❌ | ✅ |
| `MODE-A4` | Loop/Orchestrator 家族失控 | ❌ | ❌ | ❌ |
| `MODE-A5` | 记忆域外同名 | ✅ | ❌ | ✅ |
| `MODE-A6` | 评估可观测性割裂 | ✅ | ❌ | ✅ |
| `MODE-A7` | Routing 分散（14 Router 无统一契约） | ❌ | ❌ | ❌ |
| `MODE-A8` | 模式层「描述而非可执行」 | ✅ | ❌ | ✅ |
| `MODE-A9` | 未提交改动堆积 | ❌ | ❌ | ❌ |
| `MODE-A10` | 协作引擎构造点分散 | ✅ | ❌ | ✅ |
| `MODE-A11` | 评估内嵌而非总线 | ✅ | ❌ | ✅ |
| `MODE-A12` | A2A 未接线 501 语义 | ✅ | ❌ | ✅ |

> `testVerified=false` 的共同语义：**已裁定的设计决策/边界，缺一项可复跑的自动化证据**（并非"未修"）。⇒ 收口动作多数是"**补一条断言或就地登记为有意不做**"，而非改产品行为。

---

## 2. 边界收口总表（核心）

分级：**P0 = 安全/正确性/阻断项，须明确动作** · **P1 = 有真实价值、可排期** · **P2 = 维持现状 + 触发条件登记（有意不做）**。

### P0 —— 必须给出明确动作

| # | 边界原文（来源） | 类别 | 现状核查（证据） | 收口动作 | 触发条件 | 门禁/证据落点 |
|---|---|---|---|---|---|---|
| P0-1 | 两个新增开关**默认关**（`CODE_RUN_DEEP_SCAN_STRICT` / `CLIENT_STREAM_EXECUTION`），翻转须经用户裁定 <br>— CHANGELOG L34① | 默认关治理 | 两者均已入 `default-off-switches-review-gates.md §2`（#12/#13）并写有触发条件；`§2.3` 复评裁定 = **维持** | **维持现状**；按 §2.3 于 **2026-Q4** 复评 | #12：深扫不可用期间出现危险调用漏检 / `scanStatus='ran'` 达 100%；#13：客户端出现未记账工具调用或崩溃后重复副作用 | `lint:doc-code`（开关表断言）· `SAFETY_SWITCHES` 契约测试 |
| P0-2 | 跨平台（Windows/macOS）**无强隔离后端**仍属边界 <br>— CHANGELOG L34④ · `INV-SEC-003` partial · `PLAN-P2-4` | 安全边界 | `invariants.md §6` 已如实画出 Linux vs Win/macOS 能力矩阵；CI `sandbox-negative` job（Linux + helper + `SANDBOX_NEGATIVE_REQUIRE=1`）已落地 | **维持现状**（不造假后端）+ **订正 1 处死引用**（见 §4-B） | 到达 2026-Q4 复评节奏；或任一沙箱配置被翻转 | `lint:invariants` · `.github/workflows/ci.yml` `sandbox-negative` |
| P0-3 | `executionId` 仅由渠道 Router 注入，client 路径未接入 Execution（不记账/不拒绝）<br>— CHANGELOG L80 | 执行一致性 | **代码侧已收口**（v0.4.76 接入 `/v1/chat/stream`，`acquire` 注入 + 写前记账 + fail-closed + 断开 `FAILED: client_disconnected`）；**缺口在测试**：`INV-EXEC-006` 的 **handler 级**行为无自动化用例 | **补 HTTP harness 用例**（记账/终态结算/断开结算三断言）—— 这是翻转 `CLIENT_STREAM_EXECUTION` 的**前置条件** | 翻转 #13 默认值前**必须**完成 | `invariants.md §3` · `.trae/specs/client-stream-execution.md §5.1` · `tests/chat/chatManagerToolLedgerFailClosed.test.ts`（邻域参考） |
| P0-4 | `dev_docs/` 移出版本控制后，仓内溯源引用在 GitHub 上成死链 <br>— CHANGELOG L34③（原文称「约 **68** 处」） | 文档溯源 | **实测订正**：`git grep` 得 **399 次 / 241 个文件**（见 §4-A）—— 与原文**量级不符** | ① **订正 CHANGELOG 数字**；② 在 `.trae/docs/路径使用规范.md` 增一段「`dev_docs/` 已出库 ⇒ 溯源引用须标注『本地台账，未入库』」；③ **不加**死链门禁（已核实无脚本读盘 ⇒ 不影响构建） | 出现"新增/修改溯源引用"时；README/规范同步 | `.trae/docs/路径使用规范.md` · `lint:doc-code` |
| P0-5 | `L-9` 残余：`events.idx` **缺失/落后**时回退路径仍 ≈O(N²/PAGE) <br>— CHANGELOG L94 | 性能正确性 | 主因已定位并证否误判（v0.4.72：真因为夹具绕过 append 缺 idx）；`bench-longrun` 补 idx 后 F1 ×11.9 近线性；**回退路径未收口** | **排期修复**：`EventLogStorage` 续页起点在 idx 缺失/落后时改为"**按已知页边界线性续扫**"而非从 0 重扫 | 真实暴露窄（仅 idx 缺失/落后）；**出现用户可感卡顿**时升 P0 | `scripts/bench-longrun.ts` F1 · `EventLogStorage` 测试 |

### P1 —— 有真实价值、可排期

| # | 边界原文（来源） | 类别 | 现状核查 | 收口动作 | 触发条件 |
|---|---|---|---|---|---|
| P1-1 | `L-12.1` 干净环境「安装→**启动**→**卸载**」e2e（需容器/打包机）<br>— CHANGELOG L94 | e2e 覆盖 | **半收口**：`release.yml` 已有 clean-env smoke（解包 → 首启 → `healthcheck` 退出码 + 版本断言 → 清理），**「卸载」面与容器化安装未做** | 拆两半：① ✅ 已做（首启）；② **排期**：卸载/清理断言 + 容器化安装 | 需要发行可信度证据时；打包机/容器可用时 |
| P1-2 | 事件名/载荷**去 `any` 类型化**经评估为**破坏性**（39 文件 / 87 处）⇒ 另立项<br>— CHANGELOG L118 | 类型安全 | 已如实另立项；**未建 spec** | **建 1 页 spec**（改动面清单 + 分批顺序 + 编译期穷尽断言收益），**不在小版本夹带** | 排期"类型化专项"时 |
| P1-3 | P2-1 拆分后 **S2/S3/S5 多数动作受 `continue`/`break`/`yield` 约束仍留编排函数**（判据/载荷/装配单元已抽净）<br>— CHANGELOG L34② | 规模债 | `runStreamMessage` 2532→2203 行、复杂度 309→262；残留为**语法约束所致**（非漏抽） | **维持现状**（再抽需状态机化，收益未证）+ 在 `file-size-debt-partition-plan.md` 记「残余原因」 | 出现"必须再降复杂度"的硬指标时 |
| P1-4 | `MODE-A9` 未提交改动堆积（`fixed=false` `coded=false`）<br>— registry | 工程卫生 | `reopenWhen` = n/a（非代码缺陷） | **就地收口**：以"工作区干净"为验收（当前 `main...origin/main` 同步、无未提交） | 持续（每次发版复查） |
| P1-5 | `PLAN-P2-5` Execution 生命周期**死面登记与裁定** | 台账 | 已登记 DCX-1..DCX-4 触发条件 | **维持现状**（登记即收口） | DCX-1 需持久化等待 / DCX-2 长任务被误判孤儿 / DCX-3 台账膨胀 / DCX-4 确认 `settleToolCall` 全覆盖 |
| P1-6 | `MODE-A4`（Loop/Orchestrator 家族失控，`coded=false`）· `MODE-A7`（14 Router 无统一契约，`coded=false`） | 架构收敛 | 两者 `reopenWhen` 均为「**出现真实需求**」——当前**无第二消费者**（CS03：不为不可达形态建抽象） | **维持现状**（有意不做）+ 由 `.trae/specs/orchestration-family-convergence.md` 承接 | A4：需运行期统一生命周期语义；A7：≥2 个可替换路由实现的真实消费方 |
| P1-7 | 未做**端到端沙箱攻击验证**（与审查原文口径一致）<br>— CHANGELOG L80 | 安全验证 | 已有：`spawnPathRestrictions` 9 例、`sandbox/negativeEnforcement`、CI `sandbox-negative`（真负向、环境不满足即失败）；**"端到端攻击链"仍未做** | **维持现状**（真负向已覆盖"越权被拒"红线）+ 记入 `ast-family-phased-plan.md` | 出现真实攻击面/合规要求时 |

### P2 —— 维持现状 + 触发条件登记（有意不做）

> 统一口径：这些**不是欠账**，是**已取证后的有意不做**；收口动作 = **确保触发条件在册**（多数已在 `default-off-switches-review-gates.md §2.1` 或 registry `reopenWhen` 中）。

| # | 边界原文（来源） | 现状 | 触发条件（重开） |
|---|---|---|---|
| P2-1 | 未建 `VfsKernel`、未改 provider / 通道契约（外部建议所引路径与 API 经取证**在仓内不存在**）<br>— CHANGELOG L34⑤ + L49 | 外部建议与本仓实际不符 | 出现"跨驱动统一内核语义"的**真实消费者**时 |
| P2-2 | A2A sidecar 端口**独立于主进程**（单端口无法被两进程同时监听，无前置代理） | 架构选择 | 引入前置代理 / 单端口聚合需求时 |
| P2-3 | sidecar 委派端点**未在卡片广告**（卡片仍指向主进程 RPC） | 有意 | 外部客户端需直连 sidecar 时 |
| P2-4 | A2A **JSON-RPC / SSE 面未搬运**到 sidecar | 有意 | sidecar 需独立承载协议面时 |
| P2-5 | `killProcessTree` **未复用**（`sandbox` 属 moduleRegistry 受管模块，跨层直连被拦） | 架构约束 | 解除 moduleRegistry 受管边界时 |
| P2-6 | **Tier3 无字符级截断**（P2 落点仅 Tier2 单条截断） | 有意（Tier3 走后台摘要） | 出现"Tier3 也需结构闭合"的真实需求时 |
| P2-7 | ② P2 度量为**结构闭合**代理指标，非"语法幻觉下降"直接证明 | 如实的度量口径 | 需直接证明"幻觉下降"时（另立度量） |
| P2-8 | `PLAN-P2-9` 跨路径评估入口裁定（**有意不做**） · `MODE-A6` 评估可观测性割裂 · `MODE-A11` 评估内嵌而非总线 | 有意（R1–R3 皆不成立） | R1 单 agent/工具路径需查同源质量 / R2 三路 verifier 需交换质量结论 / R3 质量口径不一致致用户可见缺陷 |
| P2-9 | `MODE-A1` 编排决策层错层 · `MODE-A2` 协作层缺失 · `MODE-A3` 安全/权限同名双轨 · `MODE-A5` 记忆域外同名 · `MODE-A10` 协作引擎构造点分散 | 有意（阶段收敛已完成） | 见各自 `reopenWhen`（新增协作引擎/合并裁决入口/记忆再增子模块…） |
| P2-10 | `MODE-A8` 模式层「描述而非可执行」 | 有意（`patternAssemblerClosure` 2 ready + 3 unavailable 守卫） | 为 unavailable 模式接线时（见方案 P2-7） |
| P2-11 | `MODE-A12` A2A 未接线 **501 语义** | 有意 | A2A 对外启用时 |
| P2-12 | A5 跨会话资源治理「**抢占 / 排队**未做（用户裁定最小范围）、**优先级透传**未做（生产侧恒 `interactive`）」<br>— CHANGELOG L242 | **已收口**：v0.4.67 `P26-1` 已实现抢占 + 排队（优先级交接 + 时限兜底）+ 优先级透传 + SSE 暴露 | —（如需复核，见 `resource-governance-default-and-granularity-assessment.md`） |

---

## 3. 已收口复核（防重复登记 —— 逐条撤回）

排查中确认 **以下历史 `⚠️` 条目已闭环**，本计划**不再重复排期**：

| 历史条目（来源） | 收口证据 |
|---|---|
| `L-10` `runStreamMessage` 309 / 2532 行（CHANGELOG L94） | v0.4.76 L30：2532→**2203** 行 / 复杂度 309→**262**（残留见 P1-3） |
| `L-6` `commonId.test.ts` flaky（`generateId` 6 位 hex ≈12% 碰撞）（CHANGELOG L107） | v0.4.72 R1：`generateId` **6→10 hex**；测试已加**防回退契约** `expect(generateId('x')).toMatch(/^x_\d+_[0-9a-f]{10,}$/)`（[commonId.test.ts:46-48](file:///e:/PY/Documents/CODES/PY_APP/app/tests/utils/commonId.test.ts#L46-L48)） |
| prettier 存量 56 warnings 待专项清理（CHANGELOG L122） | v0.4.71 L105：人工清理 56 条 ⇒ `bun run lint` **0 error / 0 warning** |
| 专项 A #7 / §九 / 专项 B §十七-5 / 专项 C 8 项「未做」（CHANGELOG L79） | v0.4.74 L62：四组全落地（`crossLayerSecurityConsistency` 17 · `spawnPathRestrictions` 9 · `recoveryFaultInjection` 5 · `specialCResilience` 12）；v0.4.76 再补进程崩溃注入真负向夹具 |
| 预存问题：`batch-test-all` 的 `INDEX_PATH` 失效（CHANGELOG L326） | **已解析**：`INDEX_PATH = join(SCRIPT_DIR,'..','pyapp.ts')` ⇒ `app/src/pyapp.ts`（该文件存在） |
| 预存问题：`cli.tsx` 无 `import.meta.main`（CHANGELOG L326） | **已解析**：入口已迁至 `app/src/cli/index.ts`，`import.meta.main` **存在** |
| `D2 迁移评估 dependsOnMode` 生产不可达（CHANGELOG L192） | 同条目自带订正：**两步均已落地（2026-10-06）**，最终状态 = 已翻转 |
| v0.4.69 沙箱/隔离死面清理（CHANGELOG L135） | v0.4.71 已**整体回滚**（24 文件恢复）；并落为规则 `code-deletion.md`（CD01–CD07） |

> ✅ **已核（B1，2026-10-10）**：CHANGELOG L325 的 `project_rules §1.16 表述不准` **已收口** —— [project_rules.md:327](file:///e:/PY/Documents/CODES/PY_APP/.trae/rules/project_rules.md#L327) 已含 **2026-10-02（D-229）订正块**（原文「二者为同一实例」与实测不符 ⇒ 已订正为须经 `getInner()`），本计划**不再排期**。

---

## 4. 事实订正（**已实测的两处失实/死引用**，必须改）

### 4-A `dev_docs/` 引用规模：原文「约 68 处」→ 实测 **399 次 / 241 文件**

- 实测命令：`git grep -o -- "dev_docs/" ":!dev_docs"` ⇒ **399** 命中；`git grep -l -- ...` ⇒ **241** 文件。**细分**：根级 `dev_docs/` **394** + `app/docs/dev_docs/` **5**（**两者均 0 入库** ⇒ 全部为死链）。
- 分布前列：`fix-evidence-registry.json` 43 · `.gitignore` 14 · `.trae/rules/architecture-compliance.md` 7 · `.trae/specs/distributed-vfs-proposals-assessment.md` 5 · `.trae/specs/goal-entity.md` 5 · `.trae/docs/路径使用规范.md` 5。
- 处置：**订正 `CHANGELOG.md` v0.4.76 段（L34③）** 的数字；若不愿改历史段，则在 `.trae/docs/路径使用规范.md` 增「实测基数」小节并回指。
- 口径提示：CHANGELOG 写于 `dev_docs` 出库**当批**，之后仍有新增引用 ⇒ 数字是**快照**，须标注"截至 v0.4.76"。
- ✅ **B1 已执行（2026-10-10）**：① `CHANGELOG.md` v0.4.76 段已加 **订正块**（原「约 68 处」→ 实测 399/241，含 394+5 细分与"快照"标注）；② `.trae/docs/路径使用规范.md` 新增 **§2.4 未入库目录的引用口径（`dev_docs/`）**（来源标注 / 禁止读盘依赖 / 实测基数 / 复核命令）。

### 4-B `invariants.md §3` 指向 **不存在** 的 `.trae/architecture/security-boundaries`

- 原文（[invariants.md:63](file:///e:/PY/Documents/CODES/PY_APP/.trae/architecture/invariants.md#L63)）：`…仍属边界（**P2-4** 记入 `security-boundaries`）`
- 实测：`git ls-files "*security-boundaries*"` ⇒ **0 文件**；全仓仅 `invariants.md` 自身 1 处提及。
- 处置：把 `security-boundaries` 改为 **`invariants.md §6`**（该节即为跨平台隔离姿态事实源）；与 CHANGELOG L34④ 已写对的落点一致。
- ✅ **B1 已执行（2026-10-10）**：已改为 **「记入**本文件 §6**」**；全仓再无 `security-boundaries` 引用（`git grep -l` ⇒ 0）。

---

## 5. 触发条件与复评节奏（汇总，避免散落）

| 类别 | 项 | 节奏 | 单一事实源 |
|---|---|---|---|
| **季度复评**（2026-Q4） | `BASH_INTERPRETER_GUARD` · `BASH_APPROVAL_STRICT` · `EXECUTION_TWO_PHASE_CANCEL` · `CODE_RUN_DEEP_SCAN_STRICT` · `CLIENT_STREAM_EXECUTION` · `PLAN-P2-4` | 2026-Q4 | `default-off-switches-review-gates.md §2.3` |
| **事件驱动**（即时响应） | `OUTPUT_GUARD` 系列 · `RESOURCE_GOVERNOR` · `PRO_SECURITY_SUITE` · `UNATTENDED_MODE` · `SELF_VERIFY_PATTERN` | 事件触发 | `default-off-switches-review-gates.md §2` / `§2.1` |
| **需求驱动** | `MODE-A1..A12`（除 A9）· `PLAN-P2-9` · P2-2..P2-11 | 出现真实消费者 | registry `reopenWhen` |
| **持续**（每次发版） | `MODE-A9` 工作区干净 · `dev_docs/` 死链不新增 | 每版 | 本文件 §2-P1-4 / P0-4 |

---

## 6. 执行顺序（建议批次，按"零风险 → 有代码"排序）

| 批次 | 内容 | 风险 | 门禁 |
|---|---|---|---|
| ✅ **B1 文档订正（零代码）· 已完成 2026-10-10** | §4-A 订正 `dev_docs` 计数（CHANGELOG v0.4.76 订正块 + `路径使用规范.md §2.4`）· §4-B 修 `security-boundaries` 死引用 · 核 `project_rules §1.16`（**已收口**，见 §3） | 极低（纯文档） | `lint:doc-code` · `version:check` |
| **B2 测试补齐（1 项）** | P0-3：`INV-EXEC-006` client 路径 **handler 级** HTTP harness（记账 / 终态 / 断开三断言） | 低（仅新增测试） | `lint:invariants`（`INV-EXEC-006` 由 partial → verified 需同步 `invariants.md §2/§3`） |
| **B3 性能收口（1 项）** | P0-5：`events.idx` 缺失/落后时的续页起点改为线性续扫 | 中（恢复路径） | `scripts/bench-longrun.ts` F1 · `EventLogStorage` 测试 |
| **B4 工程卫生** | P1-4（`MODE-A9` 验收口径）· P1-2（去 `any` 专项 spec 立项，**不动码**） | 低 | 无 |
| **B5 Q4 复评批** | §5 季度项逐条读观测判是否满足（O1–O5） | 低 | `default-off-switches-review-gates.md §5` 清单 |
| **B6 存量债（按需）** | P1-1 卸载 e2e · P1-3 拆分残留（如需） | 中 | 各自 spec |

**台账同步（每批完成后）**：`lint:fix-evidence` / `lint:invariants` 会自动校验 `stages`/`flags` 与 `sources`/`tests` 路径存在性；**`postReleaseReviewed` 58 条为 false**，须在**发布后复评**批（B5）统一过一遍，避免台账长期停在"未复评"。

---

## 7. 不做清单（明确排除，防"顺手改"）

- ❌ 不为 `MODE-A1/A2/A4/A7` 等**无真实消费者**的项建抽象（CS03）；`coded=false` 是**裁定结果**，非欠账。
- ❌ 不新建 `security-boundaries` 文件（已被 `invariants.md §6` 承担，新建即重复事实源，违反 R02）。
- ❌ 不为 `dev_docs/` 死链**加门禁**（已核实无脚本读盘 ⇒ 不影响构建与门禁；加门禁会制造无价值阻断）。
- ❌ 不因"边界登记"而**翻转默认关开关** —— 翻转**唯一**路径 = §2.3 复评 + 用户裁定。
- ❌ 删除任何"未接线"实现前**必须**走 `code-deletion.md` CD01–CD07 六步核查（v0.4.69 沙箱事故的教训）。

---

## 8. 验收（本计划"完成"的判据）

1. §2 表中**每条 P0/P1** 均有：明确动作 **或** "维持现状 + 触发条件" 二选一，**无悬空项**；
2. §4 两处事实订正**已落盘**（`dev_docs` 计数 / `security-boundaries` 死引用）；
3. §3「已收口复核」中每条的**撤回依据链路**可在仓内复跑（测试/命令）；
4. `lint:doc-code` · `lint:invariants` · `lint:fix-evidence` 全绿；
5. 台账 `postReleaseReviewed` 在 B5 后逐条推进（不再长期 58/58 false）。