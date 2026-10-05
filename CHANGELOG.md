# 更新日志 / Changelog

> 本文件是 Liri **版本变更的完整历史**（**单一事实源**）。
> `README.md` 的「🚀 版本更新记录」仅保留**最新一版摘要**并指向本文件 —— 避免同一份变更记录两处维护（双源漂移）。
>
> - 版本号遵循[语义化版本](.trae/rules/versioning.md)；发布流程见其 §四。
> - 条目**倒序**（最新在上）；`## [未发布]` 段用于累积下一次发版内容。
> - 条目格式沿用 `README.md` 原「版本更新记录」的写法（`#### vX.Y.Z (日期)` + 摘要 + `- ✅` 列表），**逐字迁移、未改写**（2026-10-05 建库）。

---

## [未发布]

---
#### v0.4.61 (2026-10-05)

**工作流运行记录（P1-19）全链闭环 + 工具链（Code Mode）升级 + 治理 G 组 §3 收口 + 测试盲区补齐**

- ✅ **工作流运行记录（P1-19 系列）** - ①**成员级事件实时化**：run 执行期即按序落盘（注入式 `WorkflowRunEventAppender`，去重判据 = 持久化布尔 `metadata.workflowRun.liveEmitted`，非字符串匹配）；②**前端专用卡片** `WorkflowRunCard`：`run_start`/`step_start`/`step_end`/`run_end` 四类事件**原地聚合**为单张卡 + 重放期中断合成；③集成/观察者测试 **14 例**（真实 `DocOrchestrator` / `EventLogStorage` 落盘 / `EventMessageDeriver` 派生）；④**中止链路闭环**：编排工具透传会话中止信号 + 注入 `gracePeriodMs: 0` ⇒ 中止**立即**结算 `cancelled`（在飞步骤被账本封闭丢弃），并跑通**会话级 e2e**（观测到 `run_end@+142ms(stopReason=cancelled)` 与卡片 `cancelled`）
- ✅ **工具链 · Code Mode（T-2）** - ① `code_run` **注入可调用工具清单**（由工具注册表按生效白名单生成轻量声明 `name(param: type) — description`，经 `description` getter 反映运行期注册表）；② **Tier2 opt-in 开关** `CODE_MODE_TOOL_TIER`（**Tier1** 本地只读默认 / **Tier2** 只读扩展 10 项需显式开启 / **Tier3** 写执行类**永不放开**，须走主循环逐次审批）
- ✅ **修复：冒号命名空间工具在模型侧不可见（N-45）** - 根因＝出站 **wire 安全名**（`office:workflow` → `office_workflow`）与**类别表真名**错配 ⇒ 落 `misc` 被按任务**静默裁剪**；已加 wire 名索引三级解析 + 补登记 `office:doc-pipeline`，并加**系统性不变量**测试（探针复核裁剪 43→41、形态不一致 1→0）
- ✅ **事件契约单一事实源（P1-18）** - 4 个联合下沉 `shared/types/goal-types.ts`；app↔client **字段级**契约校验（分配式条件类型）升级 + client 守卫用例；**顺带修复 2 处真实跨端漂移**（`user/message.attachments` / `assistant/status.phase`）
- ✅ **治理 G 组 §3 剩余 5 项收口** - ①**§3-2** bash Landlock 新增 `sandbox.landlock.bashExtraWritablePaths`（默认 `[]` ⇒ 与治理前策略逐条等价）；②**§3-5** 打包大小写校验（实证 `tsc` 报 **TS1261**；client 显式化 `forceConsistentCasingInFileNames`）；③**§3-6** 新增 `lint:case` 同名目录防回归守卫（仅大小写不同的同级条目，含**自检控制组**防"空集假绿"，已纳入 `ci`）；④**§3-7** G3 守卫化（隔离提示词工具名取自**注册表生成物**，漂移即 typecheck 报错）；⑤**§3-8** 删除 `BashTool.safeExecute`/`executeCommand` 死调用点及 `isDangerousCommand` 死静态方法
- ✅ **P1-10 测试盲区补齐 + 死注入面清理** - 新增 `checkpoint-handlers`（**6 端点 / 11 例**）· `auto-reply-handlers`（**4 端点 / 7 例**）· `MCPToolBridge`（**5 例**，含"未注入端口 ⇒ 明确抛 AppError"契约）；删除 `CompactServiceImpl` **AI 摘要死注入面**（全链不可达，运行期行为逐字不变）
- ✅ **P2-13 台账遗留清理** - `phase3.test.ts` 迁出 `src/`（迁移即**暴露被隐藏的类型漂移** `ToolExecutionError` → 订正为 `ToolErrorRecord`）· `ErrorCodeDef.level` **删 `INFO` 档**（不可表达档将编译期报缺键）· 4 项 stale 订正；修复 `lint:exit`（`gen:toolnames` 补显式退出，`ci` 链恢复全绿）
- ✅ **质量** - `typecheck` 0 错 · `eslint` 0 错 · `lint:arch` 违规 **0**（4 警告基线）· 全量测试 **4468 pass / 21 skip / 0 fail / 4489 tests / 472 files**

#### v0.4.60 (2026-10-05)

**文件规模债拆分收官（ChatManager / CoreAPIImpl / ReActToolLoop / AgentTool）+ 行数上限 1000→2000 + P1 遗留多项补齐**

- ✅ **文件规模债拆分 · ChatManager（批 A1–A6）** - 6729 → **5238**（−1491）；新模块 `chat/manager/{requestPrep,rollback,promptAssembly,bootstrap,recovery,sessionTeardown}.ts` + `chat/pipeline/streamMessageLifecycle.ts`
- ✅ **三处宿主文件拆分收官** - `CoreAPIImpl` 5336 → **2521**（−2815；新 `domainSnapshotOps` / `sessionMessagesRead` / `messageMutation` / `sessionTitling`）· `ReActToolLoop` 3595 → **2543**（−1052；新 `toolTurnBudget` / `streamingLlm` / `toolResultPostProcess`）· `AgentTool` 3288 → **2652**（−636；新 `agentToolPool` / `agentTeammateIsolation` / `agentLedgerLifecycle`）；`ReActToolLoop` B2 经判据裁定「不建议拆」
- ✅ **R04-001 行数上限 1000/800 → 2000** - 并清理陈旧 `fileSizeExceptions`（161 → 16 条）
- ✅ **目标实体 X11** - 目标自动创建入口（后端 swarm 路径 `ensureGoalForBatch` + 前端聊天区目标条 `GoalBar` / `goalService`）
- ✅ **通道监控加固（P1-23③）** - `ChannelRealtimeMonitor` 探测超时 → 不确定态 + `consecutiveProbeFailures` 连续失败确认（≥2），消除忙时误判自愈
- ✅ **context-contract（P1-7）** - §5.2 全 **12 条**裸前缀拼接迁移为 `ContextualFragment` + `renderFragment()`（渲染文本逐字不变）；**#5 读取侧 CS02 改结构化标记** `FRAGMENT_KIND_FIELD`（移除 `startsWith` 判定）；新增**单条注入 token 上限运行时护栏**（>10K error / >1K warn，非阻断；动态 import 破环）
- ✅ **请求边界补齐（P1-16）** - 工具轮与非流式路径现均产 `request/start` 并透传 `requestId`；`CompactionSummaryEnvelope.usage` 聚合填充；**根因修正** `ToolLoopContext.appendStreamEvent` 返回类型（原 `Promise<void>` 与运行期不符，被 `as unknown as` 掩盖）
- ✅ **PDCA / WorkItem 检查点迁入 app.db（GAI-3）** - 新表 `pdca_checkpoints` / `workitems` + **写链串行化原子 UPSERT**，根治 read-modify-write 竞态；删除 `prewarm` 与文件 I/O；`list` 实测 **9.2ms**（旧首次 ≈1.1s）；WAL 经统一封装继承（未新增 PRAGMA）
- ✅ **P1 现状核对 sweep** - 26 项专项逐项 file:line 取证并订正文档（含 `plan-workspace-isolation` Phase 1–5 全部已落地）
- ✅ **质量** - `typecheck` 0 错 · `lint:arch` 违规 0（4 警告基线）· 全量测试 **4398 pass / 0 fail**

#### v0.4.59 (2026-10-05)

**R03-002 单一事实源专项收官 + 评测沙箱 Landlock 加固（capability-gated）+ WSL2 真机验证**

- ✅ **R03-002 模块出口单一 · 单一事实源（D-3-c 专项）** - `moduleRoots` 由**硬编码 45 项**改为**派生自 `modules-to-layers.json`**（消除漂移；一次性暴露存量违规以正式收口）；收口批次①②③共**移除 26 个登记键**（白名单引用 909 → 843）
- ✅ **门禁缺陷修复** - `TEST_FILE_EXCLUSIONS` 跨平台分隔符失效（Windows 反斜杠路径下 `__tests__` 排除**永不命中**）⇒ 消费点归一正斜杠
- ✅ **P0-4 ② 评测期强制 bash 走 Landlock（capability-gated）** - 新增意图开关 `LIRI_EVAL_BASH_LANDLOCK`：能力可用 ⇒ 真受限；不可用 ⇒ **回退 plain（绝不 `refuse`）**，不打断非 Linux 评测
- ✅ **Landlock 三处加固（WSL2 真机驱动）** - ①`LandlockDetector` LSM 预检改**三态**（securityfs 未挂载不再误判 `not-in-lsm`）；②只读放行 `/mnt/wsl`（WSL2 域内 **DNS 不再被拒**）；③`buildLandlockArgv` **统一按存在性过滤**规则路径（缺失路径不再令 helper `exit 125`、整只沙箱失效）
- ✅ **WSL2 真机验证** - 内核 `6.18.33.2`：门控路由 / 敏感路径拒绝 / DNS / 普通命令**全部符合预期**（`curl` HTTP:200、`~/.pyapp/config.json` EACCES）
- ✅ **质量** - `typecheck` 0 错 · `lint:arch` 违规 0（4 警告基线）· 定向测试全绿

#### v0.4.58 (2026-10-04)

**事件循环阻塞源收敛（A/B/C 三档收官）+ 对抗 Agent 形态 A（红队提案器）+ 预存缺陷修复**

- ✅ **阻塞源收敛 · A 档（死代码）** - 删除 7 个零消费者文件（`utils/git.ts`、`hooks/ShellHookDetector.ts`、`tools/ExpansionTools.ts`、`plugins/utils/{pluginVersioning,gitLoader}.ts`、`context/context.ts`、`modules/doc/execution/ResourceGuardian.ts`，**−3044 行**）并清理连带引用与例外清单
- ✅ **阻塞源收敛 · B 档（交互热路径）** - `execSync`/`spawnSync` → `promisify(exec/execFile)` 异步：doc（`OfficeCLIDetector`、`PdfPageExtractor` 60s、`DocGenerateTool`）· tools（`VideoAnalysisTool`、`AgentRunStore`、`ClipboardTool`）· monitoring+voice（`MonitoringService` 死分支、`audioFormatConverter` 60s）· worktree 工具 `isEnabled`（改同步 fs 探测，不再 spawn）· `recorder` 与 `recordingDetector.hasCommand`；并**放宽 `STTProvider.isAvailable` 公共契约为 `boolean | Promise<boolean>`**（`STTRegistry` 静态门面 async 化）
- ✅ **阻塞源收敛 · C 档（管理/安装）** - `DaemonService`（31 处）· 插件安装/分发（`NpmDistributor` / `PluginInstallManager` / `PythonPluginInstaller`）· `BackupCommand`
- ✅ **预存缺陷修复** - `recordingDetector.hasCommand` 原把 `where`/`which` 的非零退出误判为"命令存在"（导致无 ffmpeg 时仍选 ffmpeg 录音链）⇒ 按真实语义修正
- ✅ **对抗 Agent 形态 A** - 新增 LLM 红队**提案器**（proposal-only，裁决权仍归机械判据）+ 确定性半，`evals/cli` 接线
- ✅ **质量** - `typecheck` 0 错 · `lint:arch` 违规 0（4 警告基线）· 定向测试全绿

#### v0.4.57 (2026-10-04)

**Agentic Design Patterns 对标推进（A3/A4/A8 闭环）+ Landlock 真机实测结案 + 组②/组⑥ 缺陷修复 + ChatManager 拆分首批**

- ✅ **A8 模式装配闭环** - 新增装配入口 `instantiatePattern`（描述 → 可执行路由），补上「模式清单」到「运行时装配」的最后一公里（B1）
- ✅ **A4 编排家族收敛（T-①04）** - 下线 **8 个零可达编排类**；存活者命名复核（无重名）；新增 **L2 窄契约 `SchedulerLifecycle`** 并让 4 个调度器（`DiscoveryScheduler` / `DreamScheduler` / `CronScheduler` / `KnowledgeCompileScheduler`）实现之（D1=a/D2=b/D3=a）
- ✅ **A3 权限命名消歧（T-①05）** - `security/PermissionManager.ts` 同名双轨收敛，类改名 `SecurityPermissionView`（文件路径保留系既定裁定）
- ✅ **记忆分层收敛（T-①07）** - 新建记忆窄端口 `MemoryPort`（Read/Write/Search/Forget）；`MemoryManagerImpl` 声明实现四端口；会话域另立 `SessionMemoryPort`；RAM 侧同名 `MemoryManager` 消歧；会话记忆三类型下沉 `session/memory/types.ts`；下线增强层与悬空实现（5 文件）及 2 处零消费者
- ✅ **Landlock 真机验证结案（T-③06/③07/③08）** - `native/main.c` 补 `<stddef.h>`（GCC 15 / glibc 2.43 隐式声明修复）；WSL2 Ubuntu 真机实测：网络两态（`--net-deny`）与文件系统侧（`~/.pyapp/config.json` EACCES 拒绝）**8/8 符合预期**（假阴性风暴根因为 PowerShell→WSL 引号污染，非应用缺陷）
- ✅ **组② 契约与单一事实源** - **T-②02** 目标监控闭环接线（新增 `goal/deviation` + turn 预算偏差判定）；**T-②04** 路由决策可观测性（`context/model-input` 补 `model/route`，resolve 出口落 INFO 决策）；**T-②05** 分流判据配置化（阈值 + 危险意图正则入 config）；**T-②06** 经验自动演化（写回面 + 自动回灌 + 可观测）
- ✅ **组⑥ 缺陷修复与取证** - **T-⑥01/⑥02** 导出侧去重与时间戳兜底；**T-⑥04** 工具卡失败原因可见（提取器按既有契约逐级取数）；**T-⑥05** 工具调用协议前缀形态漏解析修复（任意非 `>` 前缀 + 真实样本回归守卫）；**T-⑥08** 空回复兜底补结构化诊断；**T-⑥09** 402 余额不足归类与引导；**T-⑥11** 长任务静默心跳（45s 补发 status chunk）；**T-⑥12** 自唤醒续跑审计事件 `session/wake`（可回放）；**T-⑥14/④02** `write_project_file` 新文件被拒修复 + 写后回读校验
- ✅ **HTTP / 模型链路修复** - `/v1/chat/completions` 的 `model` 支持 DB UUID 解析；DeepSeek wire 名对齐；无工具回合终稿 mermaid 校验补齐（P0-1② 覆盖面）
- ✅ **ChatManager 拆分首批（文件尺寸债）** - 提取 `ChatEventLogStore`（批 1/3）→ 迁入流式写入三件套（批 2/3）→ 迁入读回族 7 成员（批 3/3），主类 **6729 → 6377 行**；出拆分路线图（4 巨型类优先序 + A1-A6 批次）
- ✅ **基础设施归一与门禁** - **D-241** SQLite 连接统一封装补齐（归一化 5 处直连）；**D-239/D-240** 工具结果二级/三级防御两侧形态订正（此前在生产整体空转）；**T-③01** `R03-002` 提升为 `error`（违规即阻断 pre-commit/CI）；`tests` 纳入 lint（一次性收敛 379 处 prettier）
- ✅ **死代码与资产清理** - 下线 `chronos/CronScheduler.ts`、daemon 队列/健康链（5 文件）与「存量未接线族」4 文件；更新 liri logo（根目录与 `client/public` 统一）
- ✅ **质量** - `typecheck` 0 错 · `lint:arch` 违规 0 · 定向 515 pass/0 fail · **全量 3883 pass / 9 skip / 0 fail（426 文件）**；预存问题逐项登记

#### v0.4.56 (2026-10-02)

**分层倒挂治理完全收官（`已豁免` 151 → 0 · 例外清单归零）+ 数据契约统一专项 + 门禁口径修正**

- ✅ **分层倒挂治理完全收官** - `lint:arch` 的 `已豁免` 由 **151 → 0**（**首次归零**），`layer-exceptions.json` 的 `bulkExceptions` / `perModuleExceptions` **全部清空** ⇒ 今后任何跨层**值边**一律**直接报违规**（不再有沉默容忍）。四类手法：**物理归位**（`AttachmentManager` → `services/file/`）· **层再分类**（`tokenBudget` / `compaction` 归 app、`scripts` 归 entry）· **端口注入**（`CoreAPIImpl` 依赖反转：新增 `setCoreApiAppDeps()` 注入缝 + 组合根注册；8 符号注入 / 7 符号动态化）· **删死码**
- ✅ **死码清零** - `commands/builtin/**/*UI.tsx`（**90 文件**整棵零引用子树）· `core/flows/`（5 文件）· `analytics/CostTrackerPassesHook.ts` · `streaming/StreamEventInk.tsx` · `commands/tools/remote/remote-session.ts`
- ✅ **数据契约统一（跨模块同名簇消名）** - `Message` 7→1 · `SessionContext` 3→1 · `Context` → `HelpContext` · `Tool` 2→1 · `CheckpointStorage` → `TAORCheckpointStorage` · `PermissionMode` → `ToolPermissionMode` · `parseContextLimitFromError` → `parseContextOverflowSignal` · `core/types Message` → `ProtocolMessage`
- ✅ **会话链路类型归一（B11/B14）** - `chat/types/*` **拍平**迁入 `session/types/`；`Context` 家族下沉 `types/context.ts`；`ContextWindowResolver` 解除对 `ai` 的静态耦合（改 infra 缓存 + 同步推入）
- ✅ **门禁口径修正与可见化** - `R00-001` **不计纯 `type-only`** 跨层引用（改为**仅上报**）；测试文件在 `R00-001/003` 与 `R03-002` **同口径排除**；`R05-013` 落点口径（工具契约改落 `utils/toolContract`）⇒ 类型中心冲突 **20 → 0**；`R02-002` 同名导出冲突清零
- ✅ **B18 工具端口化** - 工具契约下沉 `utils/toolContract/`（原址 9 转发）+ 工具端口注入 ⇒ `services -> app` 归零
- ✅ **质量** - `typecheck` 0 错 · `lint:arch` **违规 0 / 已豁免 0**（type-only 6 · 动态 33，**均仅上报**）· 启动路径冒烟通过 · 预存问题逐项登记（`project_rules §1.16` 表述不准 · `batch-test-all` 的 `INDEX_PATH` 失效 · `cli.tsx` 无 `import.meta.main`）

#### v0.4.55 (2026-09-30)

**分层倒挂治理收官（A/B/C 类）+ 门禁盲区可见化 + 通道清单归一 + 死代码与陈旧副本清零**

- ✅ **分层倒挂治理收官（C1）** - 静态面 `已豁免` 逐批收敛至 **220**；动态面新增门禁 **`R00-003`**（动态 `import()` 造成的跨层引用，warning 级上报）并把它从 **95 → 28**；**三类真实错层（⑥ 真倒挂 / ⑤ 装配本体错层 / ② SPI 家族）全部归零**，余下均为"设计即如此"或测试文件（详见 `.trae/specs/layer-inversion-a-class-inventory.md`）
- ✅ **`core` 下沉与门面化** - `abortReason` / `errorCodes` / `errors` / `errorHandler` / `lazySingleton` / `loggerFacade` / `profilerFacade` / `pricing` / `tracingFacade` 下沉 `core` 模块根；core 对 infra 的消费改走**门面 + SPI**（日志门面化 + SPI 延迟绑定 / 注册前缓冲回放），消除 `core → infra` 倒挂
- ✅ **SPI 家族扩建至 8 个（引入"推送模型"）** - Logger / OTel / Profiler / Broadcast / PluginSystem / AiAccess / DiagnosticsProbe / Knowledge；实现体集中到 `entrypoints/spiWiring.ts`，由**入口侧装配后推入**容器 ⇒ 消除 SPI 自身反向导入产生的跨层对；未注册一律 noop / 空值降级
- ✅ **服务层端口化（`runtime/api/*OpsPorts`）** - 新增 **12 个端口文件**（ai / buddy / commands / knowledge / pluginAdmin / project / query / skills / task / thirdPartySkill / tools / workspace），替代 `runtime → app` 的直接领域依赖
- ✅ **门禁盲区可见化（`core/LazyModuleStrategy`）** - 字符串路径表改为**字面量 thunk 表**：把"藏起来的依赖"变为门禁可见（`R00-003` 18 → 28，**数字变差但真实** —— 该规则设计目的即让盲区可见）；并删除 4 条失效条目（`remote` / `doc` / `mail` / `calendar`）
- ✅ **通道清单归一（4 份 → 1 份）** - 新建单一事实源 `channels/ChannelCatalog.ts`（存**位置无关的惰性 thunk**），删除 `setupChannels` / `LocalHTTPServiceHelpers` / `channel-handlers` 四处重复清单；顺带修复 `tryDynamicRegister()` 对 whatsapp / signal / matrix **恒返回 false** 的漂移缺陷
- ✅ **死代码与陈旧副本清零** - 删除 `ExtensibilityService` / `StateMigrator` / `NotificationService` / `StartupPreloader` / `MemorySnapshotService` / sandbox 旧实现（4 文件）/ `EnterPlanMode` / `ExitPlanMode` / `FileSearch` / `SessionsHistory` 等 **27 个跟踪文件**；并删除 `LocalHTTPServiceHelpers` 中 `tryDynamicRegister` 的**陈旧死副本**（**P0-4 之前**版本，会**明文落库凭据**，属"复制函数致安全修复只落一份"的典型）
- ✅ **工具名编译期枚举** - 新增 codegen 产物 `constants/toolNames.generated.ts` + `scripts/gen-tool-names.ts`，工具名收敛为单一来源（含回归用例）
- ✅ **对外 Agent 协议（A2A）** - 新增 `a2a-routes` / `a2a-delegator` 与契约测试；环境变量 `A2A_ENABLED` / `A2A_API_KEY` / `A2A_PUBLIC_URL` / `A2A_DELEGATE_MAX_WAIT_MS`
- ✅ **沙箱与安全** - Landlock 网络策略两态（+ 测试）；快照存储配额治理（+ `snapshotQuota` 测试）；`PathGuard` 注册表驱动化（+ 测试）；通道进程隔离规格登记
- ✅ **错误处理与监控收敛** - 错误处理 core sink（`core/errorHandler.ts`）；监控 Logger core SPI；`shared/events/` 事件名单一来源（奇偶门禁保障两端一致）
- ✅ **回归守卫** - 全量 `bun test` = **4251 pass / 21 skip / 0 fail**（4272 用例 / 447 文件）；`typecheck` 0 错；`lint:arch` 违规 0 / 错误 0（2 条警告均为既有存量）

#### v0.4.54 (2026-09-29)

**工具层死代码清理与命名 / 错误契约修复 + PDCA 检查点性能与留存 + DAEMON 启动路径死角修复**

- ✅ **工具死实现清理（D-15 / 另案①②）** - 删除**未注册进运行时**的 `TaskTool` 4 个工具类及其 8 个孤儿文件（`TaskStorage` / `types` / `constants` / `TaskOutputUI`）、以及**零消费者**的 `tools/guardrails/` 整模块（4 文件）；并摘除 `ToolUIRegistry` 中指向已死 UI 的 4 条注册 ⇒ 源码扫描文件数 **3984 → 3972**
- ✅ **工具别名冲突 + 注册期守卫（另案③）** - 修复 `todo_write` 抢占**真实工具名** `create_task_list`（实测 `tool_search(select:create_task_list)` 指错工具、模型连续 3 轮 **0 次**成功调用）与 `video_generate` 抢占 `video`；`findToolByName` 改为**真实名优先**；`ToolRegistry.registerTool` 新增**双向别名守卫**（撞真实名 ⇒ 跳过 + warn；真实名被先前别名占用 ⇒ 摘除该别名）
- ✅ **工具入参归一化 + 失败可判定（另案④）** - `create_task_list` 复用同族文本字段兜底链（新增 `ToolUtils.pickTaskText`，与 `TodoWriteTool` **同一实现**）；失败分支统一落 `success / error / errorLevel`；`ToolExecutor.processResult` 补**顶层 `error` 回退** —— 原先只读 `metadata.error`，而该字段**全仓无人写入** ⇒ 失败原因从不进入模型视野（模型只看到 `{}`）
- ✅ **PDCA 检查点性能（另案⑥）** - 列表链路由"每次请求 `readdir` + **逐文件** `readFileSync`+`JSON.parse`"改为**文件级 `mtime`/`size` 记忆索引**：真实目录 3394 文件实测 **1032ms → ≈32ms（≈30×）**；并把 handler 内 **3 处重复内联扫描**收敛到同一索引（GR02）
- ✅ **启动异步预热（另案⑥ 补）** - 新增 `prewarmPdcaCheckpointIndex()`：**分批 + 每批让出事件循环**（预热 1.2s，事件循环**最大阻塞仅 62ms**，对比同步做法 ≈1138ms），预热后首个请求 ≈35ms
- ✅ **检查点留存策略（另案⑥ 补）** - 启动时清理"**终态或超期孤儿** + 超 **30 天**"（在跑 / 待审批**一律保留**）；真实目录 **2860 → 2798**（删 62）；判据收敛为单一事实源（`PDCA_TERMINAL_STATUSES` / `PDCA_ACTIVE_STATUSES` / `PDCA_AWAITING_APPROVAL_PHASES`）
- ✅ **DAEMON 启动路径死角修复（另案⑦）** - `launchDaemon` 末尾 `await new Promise(...)` 永久挂起 ⇒ `launch()` 尾部（「启动完成」汇总、`_appReady` 兜底、PDCA 启动扫描、`profileReport()`）在 **DAEMON 下从未执行**；抽出 `reportBootCompletion()` 并由 DAEMON 就绪点调用 ⇒ daemon 侧**首次产出**「启动完成 + 阶段耗时」（实测 `启动完成 (929ms)`）
- ✅ **会话水合死分支清理（c2）** - 删除 `SessionStateHydrator.extractTodos()`（实测**恒不命中**）及其专属辅助 `parseToolResult`、`HydratedState.todos`、两处**只写不读**的 `metadata.hydratedTodos`
- ✅ **测试隔离修复 + 夹具清理** - `pdca-list` 契约测试原为**假隔离**（模块级路径常量被 preload 链冻结 ⇒ 单测实读真实 3394 文件 ⇒ 两次调用必然越过 5s 超时 ⇒ 偶发红灯）；改**惰性解析**后该用例 **1225ms → 2.9ms**；并清理真实数据目录里被测试写入的夹具（`pdca_ck_a/b`、`d5-test-*` 529 个、`pdca_st_*` 3 个）
- ✅ **回归守卫** - 新增 `toolNameResolution` / `taskOrchestratorToolsOutput` / `pdcaCheckpointRetention` 等用例（含"删除后索引同步""守卫不误伤"等边界）；全量 `app` 侧 **4201 pass / 21 skip / 0 fail**（439 文件）、`typecheck` 0、`lint:arch` 0 错 1 警
- ✅ **工程治理** - `.trae/rules/` **13 个规则文件纳入版本控制**（原被 `.gitignore` 吞掉，现与代码同仓可 review）

#### v0.4.53 (2026-09-27)

**聊天区渲染与导出链路修复（P0–P2）+ ChatArea i18n 全量迁移**

- ✅ **工具结果信封 JSON 泄漏（三条路径）** - 工具卡合并入口统一走 `decodeToolResultContent` 解码；导出侧把 tool 消息合并进助手消息并解包 ⇒ 修复前导出件 `tool_result` 20+ 处、`🛠 role:tool` 单独成节 12+ 个、字面 `\n` 转义，修复后全部为 **0**（42KB → 10.7KB）
- ✅ **表格空单元格丢列** - `splitCells` 不再丢弃空 cell，按表头列数补齐；单测 + 突变验证覆盖
- ✅ **表格列错位 / 导出完整性** - JSON 透传块级结构化载荷（原 `any` 化丢失 `questionData` 等）、超长内容改**带标注截断**（原静默截断 5000 字）、md/json 补会话元数据（会话 ID / 消息数 / 轮数 / 导出时间）
- ✅ **导出结构保护** - 闭合未配对的代码围栏（原奇数个 ``` 会把其后 5 条消息的角色标题吞进代码块，md/html/word 三格式同源受影响）
- ✅ **会话导出新增 HTML / Word** - 复用既有 `exportMessageAsFormat`（不另立实现），导出菜单 2 项 → **4 项**
- ✅ **长会话滚动位置恢复（D5=B）** - 锚点改由 **DOM 几何**判定顶部可见项并**延后一帧**读取（原读 `getVirtualItems()[0].index`：含 overscan 且为上一帧范围，实测偏差约 9–10 条）；真机 A（重载贴底）/ B（切走切回恢复阅读位置）/ C（手动滚动不被抢回）三项全通过
- ✅ **轮次导航在虚拟列表下可达** - 改走 `highlightedRoundId` / `scrollToMessageId`，不再依赖离屏 DOM 的 `querySelector`（原点击较远轮次静默无反应）
- ✅ **会话切换整表重排（P2-9）** - 排序主键 `lastEventSeq` 缺失者不再按 `0` 兜底顶到最前（改为"全体具备才用该主键，否则回退 timestamp 序"）
- ✅ **ChatArea i18n 全量迁移（P2-1）** - 用户可见 UI 文案全量迁至 `react-i18next`（zh/en 成对维护，`chat` 段按轮次分组）；**未登记枚举一律回退后端原值**，不臆造映射；ChatArea 内已无裸中文文案
- ✅ **可访问性（P2-5 剩余）** - hover-only 操作改键盘可达（`focus-visible` / `group-focus-within`）、补可访问名、`ChatMessage` "⋯" 菜单完整键盘导航（Esc 关闭并归还焦点 / ↑↓ 移动 / 关闭态 ↓ 打开）、`DAGFullScreen` 与 `SaveKnowledgeModal` 补 `dialog` 语义、`StatusFloatBar` 展开指示改真 `<button>`（`aria-expanded`）
- ✅ **导出性能与规模（P2-7）** - 后端导出改**边分页边 `res.write`**（jsonl 逐行）+ `writeWithBackpressure` 背压控制（客户端断开即停止，避免无界缓冲与悬挂连接）；前端导出逐条累加、**每 20 条让出事件循环**（JSON 产物与 `JSON.stringify(…, null, 2)` 逐字符一致）
- ✅ **零散修复（P2-8）** - `InboxBlock` 过期倒计时改 30s 心跳（原渲染期一次性快照）、`OfficePreview` docx 暗色滤镜链修正（图片不再被一起反色）、`DebugBlockInfo` 无界 `title` 截断、回复引用截断补 `title`、`SessionHeader` 标题输入宽度类化
- ✅ **死代码清理（P2-3）** - 删除 5 个零引用文件 + `PdcaActivityStrip` 组件本体（保留仍被复用的具名导出）
- ✅ **工程修复** - 导出 Diff 文案「接受/拒绝」改「复制 diff / 忽略此改动」并提示不会自动改动文件；`GroupStatusLine` 收敛为结构化 `status` 精确匹配（CS02）；`exportMessage.ts` 源码裸 NUL 字节改 `\u0000` 转义（原被 git 判为二进制、**无法逐行 review**）
- ✅ **回归守卫** - 新增 `exportFenceBalance` 等用例，关键用例做**突变验证**（还原旧实现即转红）；门禁 `client` 49 文件 / 471 用例全绿、`app` 相关子集 291 用例 0 失败、双端 `tsc --noEmit` 0

#### v0.4.52 (2026-09-27)

**长等待期可见性（等待态）+ 自发轮次模型归属修复（记账 / 窗口 / 估价）**

- ✅ **长等待期"仍在干活"可见性** - 后端 `/v1/sessions/:id/streaming` 增 `pendingWake`（自唤醒待触发项按会话过滤 / 排序）；前端新增 `useWaitState` 派生等待态，浮动栏第 4 态显示「⏳ 等待中，预计 N 秒后自动继续」（静态蓝点、倒计时实时递减），`YieldNoticeBar` 收敛为仅展示未决 yield；已真机端到端复现（真实工具 + 真实端点 + 真实浏览器）
- ✅ **自唤醒丢唤醒修复** - 四处登记改为 load → 追加 → save 的**合并写**（原整文件覆盖会在并发登记时丢失唤醒）
- ✅ **用量归因 `model=unknown`** - 三处记账点改取 provider 回显模型（复用既有 `extractModelFromResponse`，未新增实现）；修复前回落兜底价 `$3/M in · $15/M out` 使**金额高估约 7.8×**（真机 `unknown … $0.0747` → `deepseek-v4-flash … $0.0096`）
- ✅ **发送前模型归属（窗口 / 压缩 / 估价）** - 新增只读 `resolveEffectiveTurnModel({ explicitModel, client, sessionId })`：取值链「显式 → provider 级默认模型 → 路由档位（`skipJudge`，不进 LLM Judge）」，**零额外模型调用**、不改实际请求路由；StreamPipeline 与 orchestrator 三路径（`sendMessageFlow` / `streamMessageFlow` / `preSendContextProtection`）的窗口 / 阈值 / 压缩 / 估价站点统一解析一次后复用 —— 自发轮次（续跑 / 自唤醒 / PDCA / 空闲续接）不再回落硬编码 128k，避免长会话过压 / 过截或保护不足
- ✅ **回归守卫（含突变验证）** - 等待态派生、`resolveEffectiveTurnModel` 取值链、用量归因与**窗口 / 估价归属防漂移**（还原旧写法即转红）
- ✅ **CI 修复** - ubuntu 的 `PYAPP_DATA_DIR` 跨用例污染（收尾恢复 env）；`globAsync` 的 `beforeAll` 显式 30s 预算（Windows runner 上偶发超出 hook 默认 5s）

#### v0.4.51 (2026-09-26)

**长任务被误杀（token 预算）根因修复 + 工具名漂移家族收口 + 可诊断性**

- ✅ **长任务误杀根因（流式 + batch 双路径）** - `reActLoop:budget_exhausted` 在长任务中途反复出现（实测 `iteration 114 / maxIterations 190` 即被掐断）。根因是**预算记账量纲错**：用 `estimateMessagesTokens` 估算，实测与 provider 真实 `prompt_tokens` 相差 **6.4×**（真实 29,143 vs 记账 185,195 / 200,000 = 93%），且该值在长会话中**单调不降**（压缩期间零回落）⇒ 对称记账的"退款"分支永不触发。现两条路径均改用 provider **真实 `usage.prompt_tokens`**：流式取 `ChatResponse.usage`；batch（TAORLoop / PDCA / 子代理）从 `callModel` 块的 `usage` 捕获（此前被 `...lastChunk` 展开丢掉，这正是"只能退回用估算"的原因）。无 usage 时**不记账**（fail-open：宁可少一道兜底，也不误杀）。
- ✅ **窗口口径统一** - 两条路径的 `total` 原取**价格表**（实测 200,000），与 `UnifiedTokenTracker` 的 `resolveContextWindow`（实测 128,000）不一致 ⇒ 阈值线失准。现统一为后者（用户显式 `budgetConfig.maxTokens` 仍优先）。⚠️ 单独回退窗口会**放大**误杀，务必与量纲同批评估。
- ✅ **可诊断性** - `reActLoop:budget_exhausted` / `budget_grace_call` 补 `sessionId`（此前同级日志都带、唯它不带 ⇒ 只能靠时间戳反推会话）。
- ✅ **工具名漂移家族收口** - `PathGuard`（路径守卫曾对真实工具名**完全不生效**）、`query/tool-constants`（含调用链入参键）、`tools/orchestration`、`promptSuggestion`、`tools/sandbox` 等处的工具名清单统一为真实注册名；三份同名 `WRITE_TOOLS` 按「共享取值 + 各自命名」收敛（`SPECULATION_WRITE_TOOLS` / `SERIALIZING_TOOLS`），并删除 lint 中随之失效的同名豁免。
- ✅ **测试** - 新增回归守卫：单轮记账量纲、**长任务端到端不误杀**（loop 级，用生产同款预算）、batch 侧量纲、`FileIOLoopDetector` 生效断言、工具名清单防漂移（原 3 红转绿）；关键用例均做**突变验证**（还原旧实现即转红）。
- ℹ️ 本次发布同时包含工作区内其他并行改动（`sandbox` / `evals` / `session` / `modules/doc` 等），明细以本版本 commit 为准。

#### v0.4.50 (2026-09-21)

**多 Agent 协作优化（B6/B7）、专项缺陷修复与工程护栏**
- ✅ **AgentTool 台账与描述符解析链（B6）** - AgentRunLedger 改共享单例 + 显式状态机 `canTransition`（`running → cancel_requested`、`running|cancel_requested → completed|failed`）；AgentRunStore 持久化新增 `descriptor_source` 来源列与 PID 复用判定（比对 `owner_started_at`，容差 5s）；四级描述符解析链（DB 角色 → 运行时注册表 → 内置类型 → **fail-closed 拒绝**）
- ✅ **委派授权与控制面归属** - `agent_roles.can_delegate` 双判据合取（角色策略 ∧ 父侧深度上限），模型不可自选；控制面归属校验 fail-closed（owner 缺失即拒绝）；新增 Tier1 血缘链 `sessionLineage`（fork 即登记，支持多跳祖先判定）
- ✅ **Agent 统一管理界面与运行态 API（B7）** - 新增 `/v1/agents/control`、`/v1/agents/runs`（字段裁剪守隐私边界）、`pause`/`resume`/`stop` 路由；角色 HTTP 层补 model 三道判据校验；前端角色页模型下拉（按 `modelId` 口径）+ `canDelegate` 授权位 + 「运行态」面板；`CouncilAgentRolesPage` 超限拆分出 `AgentRuntimePanel`（969 → 735 行）
- ✅ **嵌套委派真机实证** - 以真实 provider 驱动「顶层 → architect → security」两级嵌套，OTel 证据 `tools.count 59 / 58` 量化授权位生效（父被授权持 Agent、子未授权被剔）；修复**子代理工具池恒为空**（N-41，归一至唯一注册表 `getToolRegistry()`，真机 `tools.count` 0 → 59）
- ✅ **media 工具名规范化（N-42）** - 15 个工具 `media:<域>:<动作>` → `media_<域>_<动作>`，修复其冒号违反 MCP 命名规范导致 DeepSeek 返回 400 并拒绝**整个 tools 数组**（子代理与顶层非流式路径均受影响）；顺带修复 `MediaDelete` 审批键与注册名不一致（审批永不命中）
- ✅ **工程护栏** - 新增 `lint:exit`（入口脚本显式退出）与 `lint:refs`（引用可达性）两项 CI 检查，上线即查出 3 处引用断裂（`memory`、`bin.liri-memory`、`test:reporter`）；`build:update:win` 原指向从未存在的脚本，改用 `package.ts --update-only`
- ✅ **启动性能** - `extended.ts` 惰性化重量级依赖，`i18n:check` **9.37s → 0.21s**（约 **44 倍**）；根因为静态 import `@modules/error` 连带拉起 DB 建表 / OAuthService / TaskComplexityClassifier
- ✅ **稳定性修复** - 连接状态机 `start()` 幂等判定与真实资源脱钩致健康检查停摆（N-47，修复后后端真掉线可正常转 `disconnected`）；长任务编排误调 `AIService` 上不存在的 `chat()`（N-44）；代码执行器改用进程组终止消除孙进程残留（O4）；测试写入隔离避免污染生产台账（N-46）
- ✅ **CI 全绿** - `bun run ci` 全链 EXIT=0 · 3029 tests / 0 fail · 双端 typecheck 绿 · client 244 passed

#### v0.4.45 (2026-09-02)

**上下文治理与内存水位机制（OS 内存管理式）**
- ✅ **上下文分层治理落地** - D7 事件索引（events.idx 二分定位 + UTF-8 偏移 + 损坏行区间降级）；A text-batch 正文聚合（64KB/2s，事件数 10K→169/622）；B0/B1 滑动窗口快照 + 热窗 ≤10K + 缓冲下沉存储层；C 请求分层（token 动态分页点 + `session_lookup` 按需取回 + CONTEXT_LAYERING 开关）；D 摘要事件化（session/summary）+ 跨会话记忆上卷与检索适配器
- ✅ **会话中断与内存尖峰排查修复** - 优雅关闭防 torn（全会话缓冲先落盘）、图谱提取节流、MEM_PROFILE 内存画像插桩、单轮长任务 45K 分层压缩触发、MemoryStore flushBatch 竞态根治
- ✅ **内存水位触发机制** - OS kswapd 式 L0/L1/L2 分级回收（flush 脏页/后台让位/窗口收紧 45K→32K），内置事件循环滞后探针（GC STW ≥2s→L1 / ≥5s→hard）+ 反向放宽（thrashing 防护）+ 压力期自动逐点采样
- ✅ **基准验收** - P3-7f 同源长任务真实重测：事件数 PASS、单请求 inputTokens 封顶 ≈45K（较基线 124,475 降 64%）、会话数据内存 4-24MB/会话达标
- ✅ **D5② 代码/长文档取回增强** - 代码/文档类任务分层切窗时注入更强"原文可取回"提示，`session_lookup` 页预算 8K→16K chars（判定 `isCodeContextMessage`，stream/send 双路径；内存仍受 ctx 压缩点保护）

#### v0.4.39 (2026-08-15)

**安装与打包修复**
- ✅ **安装目录启动崩溃修复** - 安装到 Program Files（只读）后 EPERM 崩溃，会话存储迁移至 `~/.pyapp/data/chat_sessions`
- ✅ **SOUL_PATH 数据分散修复** - pyapp.ts 延迟加载 handleError，消除 paths.ts 在 LIRI_HOME 设置前的早期求值
- ✅ **external 依赖检测修复** - `~BUN` 虚拟路径判断失效改用 `process.execPath`；sharp/pdfjs-dist 改为文件级探测（probeExternalModule），消除编译产物误报
- ✅ **发布单元机制** - 新增 `build:win:coding:dist` 打包脚本，exe + node_modules 整体分发

#### v0.4.38 (2026-08-15)

**稳定性与 CI**
- ✅ **CI 全绿** — E2E 故障注入测试、三平台 Test Suite、静态检查全通过
- ✅ **E2E 适配新 UI** - Agent 任务管理迁移至 /agent 页面，重写对应测试
- ✅ **版本号一致性** - sync-version.ts 统一同步 6+ 版本文件

#### v0.4.37 (2026-08-14)

**会话链路与稳定性**
- ✅ **会话链路排查** - TAORLoop 污染、水位告警降噪、估算系数校准、删除 404 修复
- ✅ **压缩超时根治** - 超时保护收敛到 Tier3、保留 Tier2 成果、60s 上限、2560 摘要窗口
- ✅ **会话不物理删除** - SSE 鉴权白名单、fetch 补充 Bearer
- ✅ **知识库编码支持** - GBK/GB18030 编码自动检测

#### v0.2.0 (2026-06-05)

**新增核心能力**
- ✅ **知识库语义索引** - 支持文档向量化、语义检索
- ✅ **MCP 断线重连** - 流式传输 + 自动重连机制
- ✅ **Cron 定时任务调度** - 完整的计划任务系统
- ✅ **Agent 任务中心** - PDCA 长程编排、Kanban 看板
- ✅ **消息通道扩展** - QQ/飞书/微信等 26+ 平台接入
- ✅ **查询上下文引擎** - 智能上下文管理与修复工具

**架构升级**
- 路径管理架构重构，部署更安全
- 梦境引擎与守护进程分离
