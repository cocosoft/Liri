# Liri 升级方案（基于 Google AI 建议 × 代码实测核对）

- **来源**：`E:\PY\Desktop\google ai  建议.txt`（多轮对话汇总：CodeMidas 对标 / DSec 对标 / 架构级 6 条 / 企业级 4 条 / 英文 5 条）
- **方法**：**每条建议先对当前代码取证**，标为「已具备 / 部分具备 / 缺失 / 不适用」，只对**真增量**排期
- **口径声明**：本文件所有数字均来自本轮实测（命令或运行时 HTTP 真值）；凡未核实的**一律标注"未核实"**，不作结论
- **日期**：2026-09-28（**v2：并入 Google 第二轮建议 4 条**，见 §2.G）
- **理论出处**：`dev_docs/Agentic_Design_Patterns_Complete.pdf`（《Agentic Design Patterns》，Google 引用页码：112/229/231/301/355/358/420）；论文：arXiv **2609.22068v1**（CodeMidas）、**2609.22978v1**（DSec）

---

## 0. 任务状态总览（2026-09-29 复核）

| 项 | 状态 | 说明 |
|---|---|---|
| P1-1 Mermaid 自纠回路 | ✅ **已完成** | 同 `liri-optimization-plan-20260926.md` P0-1（① 前端降级 + ② 服务端预检/本轮内回喂） |
| P1-2 沙箱快照复用 | ❌ **不适用（前置已物理删除）** | 2026-09-29 取证：`SandboxPruner` **零消费者**、项目**无活的实例级沙箱生命周期**（台账 **D-16**）⇒ 无可挂目标；**随后（台账 D-25）沙箱「实例层」整层下线**（删 5 文件）⇒ **挂载目标已不存在**（由"阻塞"改判为"不适用"）；spec `sandbox-freeze-reuse.md` 已标阻塞 |
| P1-3 工具出参 schema 校验 | ✅ **A 档已完成** | 机制 + top-N 已接线 **7/10**（余 3 个多形态出口不宜声明）；层级核查 T1–T6 完成；门禁 **R15-001/R15-002** 已落地。**B/C 档**（主契约收敛、基座类型抽取）**未做**（另一议题） |
| P2-1 Token 悲观预扣 + 回滚 | ❌ **不实施** | 见 `liri-optimization-plan-20260926.md` P1-2（前提证伪 + 处方有反作用） |
| P2-2 通道进程隔离 | ⛔ **不实施（前置取证后裁定）** | spec：[`channel-process-isolation.md`](./channel-process-isolation.md)。**前置已量化为 0 条**：`app.log`（6.6MB / 2 天）中 `"module":"channels:*"` **零命中** + `failure-logs/` 目录不存在（`ChannelFailureLogger` 零消费者 ⇒ 台账 **D-17**）⇒ 本机**未启用任何通道**、收益无数据可证（违 CS03）。**且"守护自愈"已具备**（`ChannelRealtimeMonitor` 活的：5s 探测 + 五态机 + 退避 2s→300s）⇒ 转为"待真实通道数据"的观察项 |
| P2-3 工具名 codegen | ✅ **已完成** | runtime wire codec（`tool-name-wire-codec.md`，2026-09-14）+ **编译期枚举全链**（spec [`tool-name-compile-time-enum.md`](./tool-name-compile-time-enum.md)）：**T0** 清单参数化 → **T1** 生成物 `src/constants/toolNames.generated.ts`（71 名，`bun run gen:toolnames`）→ **T2** 4 处清单 `as const satisfies readonly ToolName[]` 收敛 → **T3-①②** 两条门禁；**顺带换出 7 例漂移**（`file_search` 及死类集群 D-32/D-33）并**收敛 D-15 待注册 4 名**（D-34）· **工具名统一 snake_case**（10 项 PascalCase 改名，去 `Tool` 后缀；spec [`tool-name-snake-case-rename.md`](./tool-name-snake-case-rename.md)，含"实际 10 个而非 9 个"的计数更正 **D-36-②**）⇒ 见台账 **D-29 ~ D-37** |
| P3-1 A2A 对外暴露 | ✅ **已完成（T0–T6）** | spec：[`a2a-external-exposure.md`](./a2a-external-exposure.md)。取证：模型**已就绪**（`buildAgentCard` / `computeAgentCardEtag` / `A2A_PROTOCOL_VERSION`），且 `capabilities.streaming/pushNotifications` **已如实声明 `false`**；**真缺口＝未接线**（三符号**零消费者**）+ 挂载点已定位（[`route-table.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/infrastructure/http/handlers/route-table.ts)）。**已实施**：T0 边界裁定（ACP 对内 / A2A 对外）→ 发现端点（ETag/304/405/401）→ 委派端点（`POST /v1/a2a/tasks`，有界等待 15s，超时 202+working）→ 鉴权（`A2A_API_KEY` **fail-closed**）→ 部署/轮换文档化；实现 `handlers/routes/a2a-{routes,delegator}.ts` + 测试 `tests/http/a2a{Routes,Delegator}.test.ts` |
| P3-2 工具链级 checkpoint + 原子回滚 | ⛔ **不实施（能力已具备）** | 前置取证发现**第三块拼图**：[`security/rollback/`](file:///e:/PY/Documents/CODES/PY_APP/app/src/security/rollback)（10 文件）**已实现且已接线** —— **轮粒度快照**（`RollbackIntegration.onRoundEnd`）+ **每工具调用前文件追踪**（`ToolExecutionService:602-620`）+ **undo/redo**（`UndoManager`/`RedoManager`）⇒ 原"缺口"判定**不成立**。**衍生项已闭环**：`snapshots/` 治理经取证为"**配额淘汰已在位**（5GB + 最旧优先，实测 527 文件 / 5007 MB 未超限）"，缺的是可观测性 ⇒ ✅ 已另立 [`snapshot-storage-governance.md`](./snapshot-storage-governance.md) 并完成补强 |
| P3-3 工作区卫生 | 🟡 **部分** | 逻辑排除已完成（`.gitignore:233` + 门禁 `R07-004`）；**物理搬迁待办**（用户裁定暂缓——目录被进程占用） |
| §5 未核实项 2–10 | ✅ **已全部回填** | #2/#3/#4/#5/#6/#7/#8/#9/#10 **均已核实并回填**（#6/#9 于 2026-09-29 结案，见台账 **D-35**；#6 残留风险见 **D-36-①**） |

**结论**：P1 三项中 **P1-1 ✅ / P1-3 ✅（A 档）**，**P1-2 ⛔ 阻塞（前提证伪）**；P2/P3 —— **P2-1 ❌ 不实施**、**P2-2 ⛔ 不实施（前置 = 0 条运行历史）**、**P2-3 ✅ 已完成（T0–T3 + 去重）**、**P3-2 ⛔ 不实施（能力已具备）**、**P3-1 ✅ 已完成（T0–T6）**、**P3-3 🟡 部分**。
**2026-09-29 汇总（本计划相关多轮累计，台账 D-16 ~ D-36）**
- 新出 spec **6 份**：[`pathguard-registry-driven-args.md`](./pathguard-registry-driven-args.md)（**✅ 已实施**）· [`channel-process-isolation.md`](./channel-process-isolation.md)（⛔ 前置 = 0 条 ⇒ 搁置）· [`toolchain-checkpoint-atomic-rollback.md`](./toolchain-checkpoint-atomic-rollback.md)（⛔ 能力已具备）· [`snapshot-storage-governance.md`](./snapshot-storage-governance.md)（**✅ 已实施**）· [`a2a-external-exposure.md`](./a2a-external-exposure.md)（**✅ T0–T6 全完成**：边界裁定 + 发现 + 委派 + 鉴权 + 部署/轮换说明）· [`tool-name-compile-time-enum.md`](./tool-name-compile-time-enum.md)（**✅ T0–T3 全完成**：清单参数化 + 生成物 + 4 处 `satisfies` 收敛 + 两条门禁；顺带换出漂移并收敛 D-15 待注册 4 名 **D-32~D-34**）
- 零消费者死代码删除（本计划相关轮次，共 **10 文件**）：`ChannelFailureLogger` / `MemorySnapshotService`（**D-20**）· 沙箱实例层 **5 文件**（**D-25**：`SandboxImpl` / `WorkerSandbox` / `SandboxPruner` / `PluginHealthMonitor` / `ToolSandboxRouter`）· `FileSearchTool` 集群 **2 文件**（**D-33**）· `SessionsHistoryTool` **1 文件**（**D-34**）
- 台账：**D-16 ~ D-36**（含多处对既有结论的**自我更正**，原文一律保留）

---

## 1. 实测基线（先立事实，再谈建议）

| 项 | 实测值 | 证据 |
|---|---|---|
| 代码规模 | `app/src` **4008** 文件 / **840,434** 行；`client/src` **702** 文件 / **171,995** 行（合计 ≈ **101 万行**） | 本轮 PowerShell 统计（排除 `tests`） |
| 运行时工具数 | **60** | `GET /v1/tools` 真值 |
| 运行时通道数 | **26** | `GET /v1/channels` 真值（与建议中的"26 通道"**一致**） |
| SQLite 并发 | **WAL 已开**：`PRAGMA journal_mode=WAL` + `busy_timeout=10000` + `temp_store=MEMORY` | [sqlite3.ts:158-160](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/external/sqlite3.ts#L158-L160) |
| 上下文分层 | **已开且默认启用**：`contextLayeringEnabled()`（`CONTEXT_LAYERING !== 'off'`）+ `REACT_LAYER_WINDOW_TOKENS` 默认 45000 | [MessageContextPipeline.ts:511-516](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/services/MessageContextPipeline.ts#L511-L516)、[ReActToolLoop.ts:534-544](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/ReActToolLoop.ts#L534-L544) |
| 工作区**含未跟踪参考副本** | `codex-main/`（`git ls-files` = **0** ⇒ 未被跟踪）、`REF/BA_REF/cc-switch-main/`（Rust 参考实现） | 本轮 `git ls-files` / 文件分布统计 |
| Liri **自身** Rust 规模 | **21 文件 / 3,919 行 ≈ 0.39%**（对比 TS ≈ 101 万行）⇒ 与建议中"Rust 0.4%"**一致** | **3 个 Cargo 工程**：`app/native/`、`app/native_test/`、`client/src-tauri/`（已排除 `codex-main/`、`REF/`、`node_modules`、`target`） |
| 已有原生边界（对建议四关键） | ✅ **Rust FFI 通道已存在**：`app/native/`（7 个 src 文件，Liri 自有原生模块） | 同上；说明"下沉 Rust"不是可行性问题，而是**收益问题** |
| 模块数 | **65** 个模块（与建议"65 个模块化子系统"一致） | `lint:arch` 输出：`已加载 65 个模块的分层映射` |

> ✅ **口径教训已闭环（2026-09-28 二次测量）**：我前两轮测出"Rust 193 万行 / 11.9 万行"**均混入工作区里的参考副本**（`REF/BA_REF/...`，`git ls-files` = **0**）。排除后的真值＝**21 文件 / 3,919 行**，反证建议里的"Rust 0.4%"是**准确的**。
>
> **参考副本的处理（2026-09-28 用户裁定：逻辑排除）**：
> - **git 层面早已排除**：`.gitignore:233` 已有 `REF/*`（故 `git ls-files REF` = 0）；`REF/` 物理体量 **82,168 文件 / 2,659 MB**。
> - **物理搬迁暂缓**：目录级 `rename` 被拒（`Move-Item` 与 `Directory.Move` 均报 `Access denied`，而 ACL 正常——无 Deny、属主为本人、非 junction、无只读 ⇒ 典型"**进程持有句柄/将其作为工作目录**"，最可能是 IDE 索引或后台 watcher）。
> - **2026-10-01 补充实测（AI 侧再次尝试，记录新发现的第二层限制）**：同卷 `[System.IO.Directory]::Move(仓库REF → E:\PY\REF_backup)` **仍报 `Access denied`**；**且另有一层硬限制** —— 工具链沙箱对该路径**直接禁止**（`TRAE Sandbox Error: Not allow operate files: …\REF`，`hit restricted`）⇒ **AI 无法代为执行**（已在沙箱内与"请求批准"两种方式下各试一次，均被拒）。⇒ **处置必须由用户侧完成**：① 在 **设置 → Permission & Approval → Custom Configuration** 中放开该路径后重试；或 ② 关闭 IDE/索引器后手动执行同卷 `Move-Item`。⚠️ 该 warning 为**登记性**（`lint:arch` 只扫 `app/src`）⇒ **不影响门禁/构建/测试**，可长期留存。
> - **约定（对所有人工统计与脚本生效）**：测量必须排除参考副本，例：
>   `Where-Object { $_.FullName -notmatch 'node_modules|\\target\\|REF\\' }`。
>   注：`lint:arch` 只扫 `app/src`（4008 个 TS 文件）⇒ **门禁不受影响**，该约定主要约束"人工/临时脚本"的口径。

---

## 2. 建议 × 现状核对表

图例：✅ 已具备｜🟡 部分具备｜❌ 缺失｜➖ 不适用/不建议

### A. CodeMidas / 多 Agent 测试类

| # | 建议 | 现状 | 证据 / 说明 |
|---|---|---|---|
| A1 | Fail-Closed 受阻机制（`cancel_requested` + 结构化挂起清单） | 🟡 | 已有**协商门**（缺信息时向用户提问并挂起）：[NegotiationState.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/chat/services/NegotiationState.ts)、`ReActToolLoop.addPendingQuestion/recordAnswer`。缺"结构化挂起清单 + 显式 cancel_requested 语义" |
| A2 | 对抗性 Rollout / Leakage Filtering（hacker agent 反证） | ❌（未核实） | 仓内有 `app/src/evals/` 模块，但**本轮未核**其是否含对抗用例 |
| A3 | 工具命令命名规范（MCP 禁冒号） | ✅ | **本轮已修**：`tools/toolNameCodec.ts`（出站 `toWireToolName` / 入站反解），并已入 `34e2cdf89` |
| A4 | OS 式内存水位回收 / 上下文分层开关 | ✅ | 见 §1（分层默认开）；另有 `monitoring/memoryPressure/` |

### B. DSec 类

| # | 建议 | 现状 | 证据 / 说明 |
|---|---|---|---|
| B1 | Agent Loop 与训练框架分离（常驻 daemon + 网络调用模型） | ✅ | 本项目本身就是 `daemon --http-port` 常驻 + provider 网络调用（`main.ts daemon`） |
| B2 | 防 `/proc` / 内核虚文件（AppArmor / 黑名单） | 🟡 | 已有 `/proc` 处理：[SandboxSecurityChecker.ts:166](file:///e:/PY/Documents/CODES/PY_APP/app/src/sandbox/SandboxSecurityChecker.ts#L166)、[PathRestrictions.ts:273](file:///e:/PY/Documents/CODES/PY_APP/app/src/sandbox/utils/PathRestrictions.ts#L273)、`SandboxImpl` 用 **bubblewrap + seccomp**（`--proc /proc`）。**deny 语义未逐条核**（是否"默认拒绝"） |
| B3 | 多层镜像按需加载（EROFS / Overlayfs / `pack_diff`） | ❌ | `sandbox/` 内 `overlayfs|packDiff|pack_diff|snapshot` **零命中** |

### C. Token / 上下文治理类

| # | 建议 | 现状 | 证据 / 说明 |
|---|---|---|---|
| C1 | 悲观预扣款 + 真实回滚（并发子代理瞬时超支） | **未核实** | 需先核 `monitoring/llm` 的记账实现（本轮未做） |
| C2 | 动态 MCP 工具代理映射（PathGuard 读动态注册表） | ✅ **已实施（2026-09-29）** | [`pathguard-registry-driven-args.md`](./pathguard-registry-driven-args.md) §7。**两处纠正**：`pathShield` 本就与工具名无关（无需改）；缺口在 `PathGuard` 的静态名单，方向是 **fail-OPEN**（漏拦），非"误拦" |
| C3 | 自动降级 + 长会话摘要上卷 | 🟡 | 已有分层/压缩（`CompactionOrchestrator`）与 `SessionSummaryAdapter`；"自动降级"策略未核 |

### D. 企业级 4 条

| # | 建议 | 现状 | 证据 / 说明 |
|---|---|---|---|
| D1 | **Self-Reflection Lint 回路**（Mermaid 语法自纠） | 🟡 **已有 spec，待实施** | [liri-optimization-plan-20260926.md:39-42](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/liri-optimization-plan-20260926.md#L39-L42)：① 前端降级（捕 `parseError` → 代码块展示）② 服务端校验 + 回喂；`client` 已依赖 `mermaid ^11.15.0` |
| D2 | 沙箱 `pack_diff` 增量快照 / 秒级复用 | ❌ | 同 B3 |
| D3 | Fail-Closed 访问控制（禁 `/proc`、socket、本地日志） | 🟡 | 同 B2；另需核"禁读 Liri 自身运行态/日志"是否已覆盖 |
| D4 | SQLite WAL + 台账写缓冲批量落盘 | ✅ / 🟡 | **WAL 与 busy_timeout 已开**（§1）；`AgentRunStore` **写缓冲/批量**未核 |

### E. 架构级 6 条

| # | 建议 | 现状 | 证据 / 说明 |
|---|---|---|---|
| E1 | 通道进程隔离（Master-Worker） | ⛔ **不实施**（前置：**0 条运行历史**） | 26 个通道与核心同进程（§1.14）；**"守护自愈"这半已具备**（`ChannelRealtimeMonitor` 是活的）⇒ 取证见 [`channel-process-isolation.md`](./channel-process-isolation.md) §3/§4 |
| E2 | Monorepo 拆分（`@liri/core` 等） | ❌ | 当前单仓 `app/ + client/ + shared/` |
| E3 | 外部 KV/图库缓存（RocksDB/Sled）+ MMAP 事件流 | ➖ **不建议** | 与 CS03/简洁优先冲突：现有 SQLite(WAL) + 分层已满足；先解决 §3 的实际阻塞点 |
| E4 | Rust 线程池接管 CPU 密集（规则引擎/分词/摘要） | ➖（**待量化**） | 本轮已把最大同步热点逐个定性/修掉（`statfs`、`spawnSync`、`tokenize`）；**未有数据支持**再下沉 Rust |
| E5 | 工具名 **codegen** 编译期守卫（消灭硬编码字符串） | 🟡 **已核实 → spec 已立项** | 取证：**仓内无编译期枚举**，而**手写工具名集合散落 ≥5 处**（`query/tool-constants.ts` / `PathGuard` 派生集 / `ToolExecutionService.IMAGE_TOOL_NAMES` / `MicroCompactionEngine.COMPACTABLE_TOOL_NAMES` / `constants/tools.ts`）；`featureFlags.TOOL_NAMES` 是**运行时**派生且**非全量**；`toolNameCodec` 只做 **wire 名转换**（无类型约束）。⇒ 立项 [`tool-name-compile-time-enum.md`](./tool-name-compile-time-enum.md)（含**三条边界**：与 `lint:arch` / wire codec / 生成输入源） |
| E6 | ACP 分布式传输层（WebSocket/gRPC） | ➖（无需求） | 单机为主；无多机调度需求前不投入 |

### F. 英文 5 条

| # | 建议 | 现状 | 证据 / 说明 |
|---|---|---|---|
| F1 | Test-Time Compute Scaling（自适应推理预算 + 后台 overseer） | 🟡 / ➖ | 已有 `maxIterations`/预算/收敛引导（`ReActToolLoop` 的 forced converge）；"动态思考预算"未做，收益未验证 |
| F2 | Google **A2A** 协议 / `/.well-known/agent.json` | 📝 **已核实 → spec 已立项** | 数据模型已有（[agentCard.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/agent/a2a/agentCard.ts) 的 `buildAgentCard` / `computeAgentCardEtag` + `a2aTaskStore`），且 `capabilities` **已如实声明**；**端点确不存在**（三符号零消费者）⇒ [`a2a-external-exposure.md`](./a2a-external-exposure.md) |
| F3 | Pydantic-first / Schema-driven tool chaining | 🟡 | **入参**已有 zod（各工具 `schemas.ts`）；**出参**无强制 schema（出参走 codec/字符串契约） |
| F4 | 事务性 Checkpoint & Rollback | 🟡 | 已有：会话 checkpoint 接口（`chat/types/checkpoint.ts`）、工作区影子 git 快照（[AutonomousRunner.ts:107](file:///e:/PY/Documents/CODES/PY_APP/app/src/workspaces/AutonomousRunner.ts#L107)）、`PlanDrivenLoop` 的 TAOR checkpoint。缺"**工具链级**自动 checkpoint + 失败原子回滚" |
| F5 | AI Contract 治理（契约 + 协商 + 授权门） | 🟡 | 已有协商门（同 A1）；缺"机器可读契约（预算/精度/边界）+ 授权门"的规范化 |

### G. Google 第二轮（v0.4.53 走查后 4 条）—— **全部与上表重叠，做去重映射**

> 本轮建议引用的既有实现**均已核实存在**：`CheckpointManager`（[README.md:139](file:///e:/PY/Documents/CODES/PY_APP/README.md#L139)「4 种检查点机制，长任务可落盘续跑」）、`useWaitState`（`client/src/components/ChatArea/useWaitState.ts` + spec `wait-state-visibility.md`）、`resolveEffectiveTurnModel`（台账 4704：`ChatHelper.resolveEffectiveTurnModel({explicitModel, client, sessionId})` 取值链）、`FileIOLoopDetector`（含回归测试 `app/tests/query/FileIOLoopDetector.test.ts`）。⇒ 建议对 Liri 现状的描述**与代码一致**。

| # | 第二轮建议 | 对应议题 | 增量判断 |
|---|---|---|---|
| G1 | Channel Worker 进程隔离（`Bun.spawn`/Worker + IPC，**热插拔 + 守护自愈重启**） | **E1** | ⛔ **不实施**（同 E1）。**更正**：本条新增要点里的"**守护自愈重启**"**已具备**（`ChannelRealtimeMonitor`，活的）⇒ 只剩"进程隔离"这一半，而它**无数据依据** |
| G2 | ACP → **A2A 标准契约**（`/.well-known/agent.json` 导出 Agent Card，声明 streaming/pending） | **F2** | 📝 **已并入 P3-1 并出 spec**：`capabilities.streaming` / `pushNotifications` **已如实声明 `false`**（[`agentCard.ts:95-99`](file:///e:/PY/Documents/CODES/PY_APP/app/src/agent/a2a/agentCard.ts#L95-L99)）；长任务 pending 用 **Task 状态机**表达；**前置 T0 ＝ 划 ACP/A2A 边界** |
| G3 | Type-Safe **Schema 契约治理层**（入参+出参强制 Schema，"边界处解析"） | **F3** | 🟡 入参 zod 已有、**出参缺** ＝ P1-3 核心；与 §3 P1-3 表述一致 |
| G4 | **Rust 原生 FFI** 原子级 Checkpoint/Rollback（重型写前快照 + `rollback()`） | **F4 + E4** | 🟡 已有 `CheckpointManager`（4 种机制）与工作区影子 git 快照；缺"**工具链级**自动快照 + 原子回滚"。**关键新事实**：Rust FFI 边界**已存在**（`app/native/`）⇒ 技术上可行；但建议**先复用现有快照能力**（P3-2），仅当"快照自身性能"成瓶颈时才引入 Rust（E4 结论不变） |

**核对结论（v2）**：**24 条建议（含第二轮 4 条）映射为 20 个议题** —— ✅ 4 已具备 / 🟡 9 部分具备 / ❌ 5 缺失 / ➖ 3 不建议；**第二轮 4 条全部落入既有议题，无新增议题**。即 **约 6 成已具备或部分具备** ⇒ 有价值的不是"照单全收"，而是下面这张**去重后的真增量清单**。

---

## 3. 真增量清单（按 ROI 排序，去重后 9 项）

### P1（收益明确、已有依据）

| 项 | 内容 | 改动面 | 验收判据 | 风险 |
|---|---|---|---|---|
| **P1-1 Mermaid 自纠回路** ✅ **已完成** | ① 前端降级（捕 `parseError` → 降级代码块 + 提示，止住红字刷屏）② 服务端：图表/`image_svg`/`doc` 类工具输出落盘前做语法校验，失败以错误日志回喂同一子代理（≤N 次），并落一条事件（对齐 §1.6「模型可见 ⇔ 已落盘」） | `client/src/components/ChatArea/BlockContent.tsx` + 工具输出前钩子 + 事件类型 | 注入坏语法图表：前端无红字、显示降级块；后端产生"校验失败→回喂→修正成功"事件链 | 需一个 mermaid 解析器（node/wasm）；**先做 ① 即可止血**；已有 spec 直接实施 |
| **P1-2 沙箱快照复用** ⛔ **阻塞（前提证伪，见台账 D-16）** | 基础环境（依赖装好、分支就绪）打成增量快照 → 后续任务/并行子代理直接挂载，免重复 `bun install`/`docker pull` | `app/src/sandbox/`（新增快照接口 + 挂载路径） | 新建任务环境耗时相对现基线下降 ≥50%，且任务结果不受影响 | 需 Docker/OverlayFS 兼容层；先做"同机单容器层"最小版 |
| **P1-3 工具**出参** schema 校验** ✅ **A 档已完成**（B/C 档未做） | 已有入参 zod；补出参：工具结果进入下一链前按 schema 校验/规整，杜绝 markdown 噪声进下游 prompt | 各工具 `schemas.ts` + 工具结果出口（`decodeToolResultContent` 一带） | 注入"带噪声出参"的工具：下游收到的载荷符合 schema；不一致时打 warn 并可回喂 | 60 个工具逐个补 schema 有工作量 ⇒ **先覆盖高频 10 个** |

### P2（需先核实或改动面较大）

| 项 | 内容 | 前置核实 |
|---|---|---|
| **P2-1 Token 悲观预扣 + 回滚** ❌ **不实施**（前提证伪） | 并发子代理瞬时超支防护 | 先核 `monitoring/llm` 记账（本表 C1） |
| **P2-2 通道进程隔离** ⛔ **不实施（前置 = 0 条运行历史）** | 26 通道剥离为 Worker，故障隔离 + 热插拔 | 见 [`channel-process-isolation.md`](./channel-process-isolation.md)：① **前置已量化 = 0 条**（无 `channels:*` 日志、failure-logs 目录不存在）⇒ 收益无依据；② **"守护自愈"已具备**（`ChannelRealtimeMonitor`）⇒ 只剩进程隔离 |
| **P2-3 工具名 codegen** ✅ **已完成（T0–T3 + 去重）** | 编译期生成强类型工具名枚举 + MCP schema 映射，消灭硬编码字符串 | 见 [`tool-name-compile-time-enum.md`](./tool-name-compile-time-enum.md)：清单参数化（`getAllBuiltinToolLoaders()` 全量视图）→ 生成物 `toolNames.generated.ts`（71 名 + `ToolName`）→ **4 处清单** `satisfies ToolName` 收敛 → **两条门禁**（生成物一致性 / 清单名字必须在生效注册面内）；顺带**去重 2 处同名工具**、**换出第 7 例漂移 `file_search`**（台账 **D-29～D-31**） |

### P3（方向正确但可选）

| 项 | 内容 | 前置核实 |
|---|---|---|
| **P3-1 A2A 对外暴露** 📝 **spec 已立项（待评审）** | `/.well-known/agent.json` + 任务委派端点（数据模型已就绪） | ✅ 已核并出 spec（[`a2a-external-exposure.md`](./a2a-external-exposure.md)）：模型已就绪、**零消费者 ⇒ 无端点**、挂载点 = `route-table.ts`；**前置 T0 ＝ 划 ACP / A2A 边界** |
| **P3-2 工具链级 checkpoint + 原子回滚** ⛔ **不实施（能力已具备）** | 在多步工具链前自动 checkpoint，失败原子回滚到已验证点 | 已核（[spec](./toolchain-checkpoint-atomic-rollback.md) §1.3）：`security/rollback/` 的**轮快照 + 工具级文件追踪 + undo/redo** 已接线 ⇒ 无需新建；剩余 `snapshots/` **4.4 GB 无淘汰** = 存储治理，另立 spec |
| **P3-3 工作区卫生** 🟡 **部分**（逻辑排除已完成；物理搬迁待办） | 参考副本 `REF/`（2.6GB / 82k 文件）的排除：**逻辑排除已完成**（`.gitignore:233` 早有 `REF/*`；门禁 `R07-004` 已落地；§1 已写入口径约定）；**物理搬迁待办**（2026-09-28 用户裁定暂缓——目录被进程占用导致 rename 被拒，见 §1） | 待你择机关闭 IDE/索引器后，用同卷 `Directory.Move` 秒级完成 |

### v2 增补要点（来自第二轮 4 条）

| 议题 | 增补内容 |
|---|---|
| P2-2 通道进程隔离 | 除"故障隔离/热插拔"外，加**守护自愈重启**（Worker 崩溃自动拉起）与 **IPC 选型**（本地端口/Unix socket；通道→Master 仍走既有 `routeChannelMessage()` 语义） |
| P3-1 A2A 对外暴露 | Agent Card 需声明 **streaming** 与**长任务 pending** 能力（对齐 A2A 规范的 capability 字段） |
| P3-2 工具链级 checkpoint | 分两级：① 复用 `CheckpointManager` + 影子 git 快照的**既有能力**做工具链级自动 checkpoint；② 仅当快照开销成瓶颈，才评估 Rust（`app/native/` 边界已在，但**无数据支持**先做） |
| P1-3 出参 schema | 明确原则："**在边界处解析，而非在业务中验证**"（《Agentic Design Patterns》App.A p.355/358）—— 校验点收敛到工具结果出口，不散落到各业务分支 |

### 明确不做（并说明理由）

| 建议 | 不做的理由 |
|---|---|
| E3 RocksDB/Sled 外部 KV | 现有 SQLite(WAL)+分层已满足；引入新存储违背 CS03/简洁优先，收益未证 |
| E4 Rust 线程池接管 | 本轮已定位并修掉最大同步热点；**无数据**支持再下沉（先做 P2-1 的量化再议） |
| E6 ACP 分布式传输 | 无多机调度需求 |
| F1 动态思考预算 | 与现有预算/收敛机制重叠，收益未验证 |

---

## 4. 建议的实施批次

1. **批次 1（止血，最小）** ✅ **已完成**：P1-1 ① 前端 Mermaid 降级；P1-3 出参 schema 覆盖高频工具（**7/10 已接线**，余 3 个为多形态出口、经取证不宜声明）。
2. **批次 2（能力）** 🟡 **部分完成**：P1-1 ② 服务端校验 + 回喂 ✅；**P1-2 沙箱快照最小版 ⬜ 未开工**（spec `sandbox-freeze-reuse.md` 已立项）。
3. **批次 3（治理）** ⬜ **未开工**：**P2-1 ❌ 不实施**（前提证伪）；P2-2 / P2-3 —— **每项先出短 spec 并核实前置项**（P2-3 runtime 部分已实施）。
4. **批次 4（可选）** ⬜ **未开工**：P3-1 / P3-2 未开工；P3-3 逻辑排除已完成、物理搬迁待办。

**统一验收原则**：每批必须给出**运行时可观测判据**（如"无红字 + 事件链完整"、"环境就绪耗时下降 ≥50%"、"下游载荷符合 schema"），并在台账记录实测值；`typecheck` / 相关测试 / `eslint` / `lint:arch` 必须为 0 违规。

---

## 5. 未核实项（如实列出，不得当作结论）

1. ~~Liri **自身** Rust 规模~~ ✅ **已澄清**（21 文件 / 3,919 行 ≈ 0.39%；3 个 Cargo 工程，含 `app/native/` FFI 边界）——见 §1。
2. ~~Token 记账是否已有"预扣/预留"机制（C1）~~ ✅ **已核实 → 不实施**：见 [`liri-optimization-plan-20260926.md`](./liri-optimization-plan-20260926.md) P1-2 —— 现账务为**对称记账**，判定点恒落在「上一轮完整真实值已记账」之后 ⇒ 无"窗口期"；"预扣"只能靠估算（实测偏 6.4×）⇒ 必然复现误杀。
3. ~~PathGuard 与 MCP 动态工具注册表的联动现状（C2）~~ ✅ **已核实 → 缺口成立**：`app/src/query/PathGuard.ts` 全仓无 `mcp` / 工具注册表引用 ⇒ 即升级方案 **P2-2**（**未开工**）。
4. ~~`app/src/evals/` 是否已含对抗性/泄漏过滤用例（A2）~~ ✅ **已核实 → 已落地**：`app/src/evals/antiCheatAudit.ts`（5 条机械攻击向量）+ `tests/evals/antiCheatAudit.test.ts`（8 例），见 [`liri-optimization-plan-20260926.md`](./liri-optimization-plan-20260926.md) P1-1 形态 B。
5. ~~`agent/a2a/` 是否已对外暴露 HTTP 端点（F2）~~ ✅ **已核实 → 无端点**：全仓 grep 仅命中 `agent/a2a/taskStore.ts` 的 `a2aTaskStore`，无 `/.well-known/agent.json` 路由 ⇒ P3-1 未开工。
6. ~~沙箱对 `/proc`、socket、Liri 运行态日志的 **deny 语义**是否"默认拒绝"（B2/D3）~~ ✅ **已核实（2026-09-29，台账 D-35/D-36）→ 结论：不是"默认拒绝"**：`/proc` 被**显式放行**（bash 的 `SYSTEM_READ_EXECUTE_PATHS` 含 `/proc`；code_run 有 `{path:'/proc',allow:['read']}`）；socket **无该语义**（`--net-connect` 实现与注释相反，未请求 net 时**完全不受限**，见台账 **D-36-①** ⚠️ 需 Linux 实测）；**仅** `~/.pyapp`（含 Liri 日志）满足"未列即拒"，且**只在真走 Landlock 时成立**（bash 默认 `bashEnabled=false` 不成立，兜底仅命令文本黑名单）。**✅ 已处置（2026-09-29，台账 D-38）**：权威依据（内核 `landlock.h`）确认 net 规则**只能授具体端口**（无"任意端口"通配）⇒ "按协议放行"内核不可表达 ⇒ 网络已**收敛为两态**（`--net-deny` = 全禁 / 不 handle = 不受限），spec：[`landlock-net-policy-two-state.md`](./landlock-net-policy-two-state.md)。
7. ~~`AgentRunStore` 是否已有写缓冲/批量落盘（D4 后半）~~ ✅ **已核实 → 不实施**：`AgentRunStore` 为模块级单例单连接、全仓统一 `busy_timeout=10000`、`prune` 不在写入路径 ⇒ 原设前提证伪；原验收判据已固化为回归守卫，见 [`liri-optimization-plan-20260926.md`](./liri-optimization-plan-20260926.md) P0-2。
8. ~~`chat/types/checkpoint.ts` 现有能力边界（F4 / P3-2）~~ ✅ **已核实（2026-09-29）→ spec 已立项**：**会话/生成器态**的"每 `tool_call` 后自动 checkpoint + 可恢复"**已存在并已接线**（`StreamingAutoCheckpoint`：`ChatManager.ts:3980/5244`、`streamMessageFlow.ts:42`、`ChatOrchestrator.ts:295`）；`SessionCheckpoint` = `messages + metadata + state`（**不含文件系统**）。**文件系统级**快照存在但**仅限隔离 worktree 且破坏性**（`WorkspaceSnapshot`：`git add -A` + `reset --hard`，唯一消费者 `AutonomousRunner:71/131`）⇒ **不可搬进真实仓库**。"工具链级 + 原子回滚"的缺口**重定义**与前置条件见 [`toolchain-checkpoint-atomic-rollback.md`](./toolchain-checkpoint-atomic-rollback.md)。
9. ~~**工具数口径**：运行时 `/v1/tools` = **60**，而建议两轮均称 **81**~~ ✅ **已核实（2026-09-29，台账 D-35）→ 81 无本仓口径支撑**：实测**生效 = 60**（与运行时 `GET /v1/tools` 逐数吻合）· **全量 = 71**；差额 **11** = 默认关闭的条件工具（`browser`/`code_run`/`lsp`/`mcp_resource`/`notebook`/`repl`/`tungsten`/`ListMcpResources`/`ListPeers`/`MCPTool`/`ReadMcpResource`）。"81" 全仓仅在本条与 `architecture-benchmark-20260928.md:283`（**core 层倒挂 81 处**，与工具数无关）出现 ⇒ 判为**外部分析的计数口径**，**本仓无需对齐**。
10. ~~A2A 是否已有对外 HTTP 端点（`agent/a2a/` 是否有路由注册）~~ ✅ **已核实 → 无端点**（同 #5）。

> 建议：~~下一轮先把 §5 的 2–10 逐条核实并回填本文件~~ ✅ **已完成（2026-09-29）**：§5 全部 10 项**均已核实回填**（#1–#10 无遗留）。**残留待办已登记**：① 台账 **D-36-①**（Landlock `--net-connect` 语义与注释相反，⚠️ 需 Linux 实测）；② 台账 **D-36-③**（4 个"类里声明但不在注册面"的 PascalCase 类，处置属独立议题）。
