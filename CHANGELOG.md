# 更新日志 / Changelog

> 本文件是 Liri **版本变更的完整历史**（**单一事实源**）。
> `README.md` 的「🚀 版本更新记录」仅保留**最新一版摘要**并指向本文件 —— 避免同一份变更记录两处维护（双源漂移）。
>
> - 版本号遵循[语义化版本](.trae/rules/versioning.md)；发布流程见其 §四。
> - 条目**倒序**（最新在上）；`## [未发布]` 段用于累积下一次发版内容。
> - 条目格式沿用 `README.md` 原「版本更新记录」的写法（`#### vX.Y.Z (日期)` + 摘要 + `- ✅` 列表），**逐字迁移、未改写**（2026-10-05 建库）。

> **说明（2026-10-06 补录）**：标「（git 历史补录）」的段落由**版本 tag 区间的真实 git 提交**归纳生成
> （精炼版：最多 6 条，按 `feat > fix > perf > refactor > 其它` 排序；全文见 `git log <prev>..<tag>`）。
> 与 2026-10-05 由 README **逐字迁移**的条目**来源不同**；要点为**原提交描述**，未改写、未编造。
> 该标记的完整约定（触发条件 / 事实统计 / 顺序 / 异常标注 / 工具与粒度红线）见 [`.trae/rules/versioning.md`](.trae/rules/versioning.md) **§3.1**。
>
> - 本次补录 **38** 个此前缺失的版本 tag（自 `v0.1` 起），使本文件覆盖 **56 个版本 tag / 1843 次提交**（局部历史见 `https://github.com/cocosoft/PY_APP`，即转入 Liri 仓库前的提交）。
> - ⚠️ **已知 tag 日期异常**：`v0.1.0` 的 tag 日期（2026-05-30）**晚于** `v0.1.1`（2026-05-28）。本文件统一按**版本号**降序（故 `v0.1.1` 在 `v0.1.0` 之前）；两段各自的提交区间为 `v0.1..v0.1.1` 与 `v0.1.1..v0.1.0`。

---

## [未发布]

---

#### v0.4.72 (2026-10-09)

**第九轮外部审查「复查任务计划」R1–R18 落地 + 事件日志恢复超线性定位（L-9）+ 门禁/质量治理补强**

- ✅ **确定性缺陷与恢复语义（R1–R5）** - **R1** 统一 ID 熵源补齐（`generateId` 6→10 hex；`generateMessageId` / `generateAttachmentId` 7→10）· **R2** 沙箱能力矩阵 + **负向集成测试**（权限不足 / 并发隔离 / 越权读·写·子进程**真拦截**，3 文件 18 pass / 6 skip）· **R3** 崩溃窗口恢复：未结算工具调用标 **`unknown`**（不可知副作用不误判成败）+ 审计计数 · **R4** `messageRouter` 时序契约矩阵（6 契约）+ **去重键作用域收敛**（`渠道:发送者:messageId`，修**跨账号误去重**）· **R5** 门禁自证（违规控制样例 ⇒ 命中 `R00-001` 实为 warning ⇒ **已提升为 error**，零回归）
- ✅ **补证 / 补测（R6–R9）** - **R6** 多 Agent 状态所有权五问核查（**无新增缺口**，产出 1 守则 + 1 契约边界）· **R7** 压缩**语义保真** 6 维 + 派生性（7 pass）· **R8** 评测 **skip 分级**（26 位点 / `security·env·platform·perf·pending`）+ 判分器边界样例 · **R9** 长期运行与恢复基准（`scripts/bench-longrun.ts`：F1 恢复分布 / F2 并发加速比 / F3 长跑内存趋势）
- ✅ **治理 / 质量基础设施（R10–R14）** - **R10** 状态复杂度门禁（**最小启用** `complexity warn 40`；6 指标可行性矩阵，分支覆盖率因工具链不产出**不可行**）· **R11** 通道能力契约矩阵 **147 pass**（**命中真缺陷**：`msteams` `exportKey` 大小写漂移 ⇒ 通道永不注册，**已修**）· **R12** 依赖**许可证扫描**（`lint:license`，1335 依赖分级）+ CI 步骤 · **R13** 删除代码安全流程落为规则 **`code-deletion.md`（CD01–CD07）** · **R14** 质量指标**分层**（CI 摘要 5 层分列 · **不合成单一分数**）
- ✅ **谷歌输入补证（R15–R18）** - **R15** 自唤醒重启恢复：定位并修复**重启后重发链路失效**（`WakeStore` 内存索引未重建 ⇒ `fire()` 不续跑、`fired` 不幂等）· **R16** 每日 Token 预算**统一**（进程共享单例 + 记账收敛 + **原子预留** `reserveFor`/`settleFor` + 子代理/任务侧记账；预算仍建议式）· **R17** OTel 背压核查（`BatchSpanProcessor` 有界队列**已提供背压**；实测 ~1.46µs/span **无数量级回归** ⇒ 不优化）+ 清理 `OTelTracing` 陈旧死导入 · **R18** 压缩语法感知核查（粒度 = 消息/轮次，**不做代码字符切片**）+ 分片器**结构感知**（围栏成对 + 括号深度）+ 工具结果**安全预览**（行/块边界、围栏收尾）
- ✅ **L-9 事件日志恢复超线性定位** - 扫尺度 + 首页/续页分解，**证伪**原候选根因（`filterSnapshotEvents` 受 10K 热窗限 ⇒ **非主因**），定位主因 = 夹具绕过 append **缺 `events.idx`** ⇒ 续页从 0 重扫 ≈O(N²/PAGE)；`bench-longrun` 夹具**按 append 同义补写 idx** 后 F1 **×11.9 ✅ 近似线性**（旧 ×13.9~15.1 ⚠️）
- ✅ **质量** - `typecheck` **0** · 全量 **5414 pass / 42 skip / 0 fail** · `lint:arch` 违规 **0** · `lint:size` **0 错** · `lint:doc-code` ✅ · 新增门禁脚本 `lint:license` / `audit:complexity` / `bench:otel`（后两者非 CI 阻断）
- ⚠️ **登记（非阻断，待触发）** - `L-10` `runStreamMessage` 单函数复杂度 **309 / 2532 行**（待专项拆分）· `L-12.1` 干净环境「安装→启动→卸载」e2e（需容器 / 打包机）· `L-9` 残余：`events.idx` 缺失/落后时回退路径仍 ≈O(N²/PAGE)（真实暴露窄）

---

#### v0.4.71 (2026-10-09)

**沙箱回滚恢复与接线（S5/S1/S7）+ `messageRouter` 拆分达标（1290→816）+ 存量 lint 警告清零**

- ✅ **沙箱子系统恢复** - 回滚 v0.4.69 的三笔"死面清理"提交：恢复 24 个文件（`IsolationManager` / `EnhancedSandboxManager` / `PTYSandbox` / `SSHSandbox` / `docker/**` / `WorkspaceManager` / `ProcessRegistry` / `ResourceLimitManager` 等 + 5 项测试）并回滚 21 个存活文件的配套改动（SPI/HTTP handler/client/landlock）；同批**订正**因回滚被带回的失实陈述（`runWithLandlock` 接线落点、spec/台账）
- ✅ **沙箱接线（S5 / S1 / S7）** - **S5**：`runWithLandlock` 补齐 `maxBufferChars`（`appendWithinLimit` 软限）/ `timedOut` / `error` 三态，并**纠正**「spawn 错误误归因 exit 125」；bash 的默认 helper runner **改为委托** `runWithLandlock`（去重复；code_run 因需 **RPC 子进程句柄**保留自身 spawn）。**S1**：组合根启动期创建 `default` 工作区 ⇒ `ISandboxPort` 的 `hasWorkspacePermission` / `isWorkspacePermissionDenied` / `activeWorkspaceCount` 由 `config.sandbox.permissionLevel` **真实驱动**（此前恒取"工作区不存在"分支）。**S7**：bash（plain/landlock 两路径）与 code_run 在进程 spawn 处登记 `ProcessRegistry` ⇒ `GET /v1/sandbox/status` 的 `processStats` 由**恒空**转为真实；`ResourceLimitManager` 维持 D5「观测面」裁定（不接执行路径）
- ✅ **C3-S3 `messageRouter` 拆分（1290 → 816 行）** - 子 spec [`.trae/specs/message-router-split.md`](.trae/specs/message-router-split.md)：**S1** 外围迁出（契约/常量、串行化助手、帧验证、内容去重、文本审批、出站投递 → 6 个 <500 行子模块，`validateInboundFrame` 等经重导出保 API）；**S2** 流式消费循环迁出（`streamConsumption.ts`：空转计时器 / `requestCancel`+`abort` / `done` 分支 `finishExecution` / `tool_call` 记账 / 工具进度通知 / 长任务占位），**两段式取消的 `catch` 留原文件**保时序。`routeChannelMessage` **保留原文件**（R03-004 渠道入站唯一入口）
- ✅ **存量 lint 警告清零** - `bootstrap/*` · `compaction/*` · `tokenBudget/*` 共 **56 条 warning**（`no-unused-vars` ×44 / `no-explicit-any` ×12）人工清理（删死导入 / `_` 前缀 / 类型化）⇒ `bun run lint` **0 error / 0 warning**
- ✅ **质量** - `typecheck` **0** · 全量 **5178 pass / 36 skip / 0 fail** · `lint:arch` 违规 **0**（警告 4 = 基线）· `lint:size` **0 错**（`messageRouter` 退出 >1000 行组）· `lint:doc-code` ✅
- ⚠️ **顺带发现（预存，台账 L-6）**：`tests/utils/commonId.test.ts`「C1 唯一性」为 **flaky**（`generateId` 6 位十六进制 ≈1670 万空间，批量 2000 ⇒ 按生日悖论约 **12%** 碰撞）—— 非本版引入，已登记台账

---

#### v0.4.70 (2026-10-09)

**Bash 安全面收口（A1–A5）+ Execution 生命周期所有权体系（PR1–PR5）+ 统一 ID 熵源收口与 EventBus 三语义 + `CoreAPIImpl` 拆分达标（清豁免）**

- ✅ **Bash 安全（批次 A，A1–A5）** - 审计 `sessionId` 由 `toolUseId` 订正为真实会话（A1）· 已批准命令**不再豁免全部安全检查**（A2，灰度 `BASH_APPROVED_REVALIDATE`）· `spawn` **剥离敏感环境变量**（A3，单一事实源 `security/sensitiveEnv.ts`：子串族 + 具名集，`ScriptHookExecutor` 同批去重）· **高能力解释器**（node/bun/npm/python/pwsh…）纳入需确认判定（A4，`BASH_INTERPRETER_GUARD`）· 批准**严格模式**（A5，`BASH_APPROVAL_STRICT`：禁命令名级放行，仅精确 hash）⇒ 安全开关清单 **11 → 14**
- ✅ **Execution 生命周期（批次 B，PR1–PR5）** - **PR1 Execution Identity**：`execution/*`（branded `ExecutionId`/`Generation` + 集中状态机 `canTransition` + `ExecutionManager.acquire` 原子占用 + generation fencing）；**PR2 真取消**：两段式 `CANCEL_REQUESTED → CANCELLED`（未确认**保留 lease**）+ `AbortSignal` 端到端贯通（Router → CoreAPI → ChatManager 中继既有取消链路）+ 空转超时改抛类型化 `ExecutionAbortedError`；**PR3 Session safety**：`activeExecutionId` 记名 + `cleanIdle` 跳过执行中会话；**PR4 Dedup 语义收敛**：`RECEIVED/ADMITTED/REJECTED` 单一状态图（替代 inflight+processed 双结构）+ 超时不再"伪造已处理"（改真实 `REJECTED`）；**PR5 Durable Execution**：**新增 3 张表**（`executions` / `execution_events` / `tool_calls`，仅新增）· `ExecutionManager` 写穿 + 启动期 `recover()`（陈旧心跳孤儿 ⇒ `STALE` + `generation++`，**跨重启 fencing 不回退**）· execution 生命周期**会话事件三处同批**（编译期强制）+ `tool_calls` 记账接线 · **Router 级准入**（会话占用 ⇒ 有界等待，超时 `SESSION_BUSY` 且**不吞消息**）· 去重处理态**落盘**（`DedupStore` + 启动 hydrate，跨重启阻断重传 ⇒ 防重复计费）
- ✅ **C1 统一 ID 收口（生产零弱随机）** - 全仓 `Math.random().toString(36)…` ⇒ `randomIdSuffix()`（`crypto.randomUUID` 派生），**生产代码归零**（约 151 处 / 50+ 文件；仅余测试白名单）；新增 `core/ids.ts` 承载单一实现（解 `core → infra` 倒挂，`utils/common` 再导出 ⇒ 既有 import 零改动）
- ✅ **C2 EventBus 三语义显式化** - `publish`（fire-and-forget，零行为变更）与 **`publishAndWait`**（按序 await、返回 `{delivered, failed}`、单监听器失败不中断）分工明确；`once()` **幂等守卫**（重入/并发至多触发一次）；历史**快照**（防外部原地改数组污染）；wildcard 顺序契约文档化。⚠️ 事件名/载荷**去 `any` 类型化**经评估为**破坏性**（39 文件 / 87 处）⇒ 如实**另立项**，不夹带
- ✅ **C3 `CoreAPIImpl` 拆分达标（清掉一个豁免巨头）** - **2522 → 1898 行**：外迁 `sessionAgentOps.ts`（工具查询/`executeTool`/会话 CRUD 与查询/代理任务/文件类型，~680 行）与 `llmChatOps.ts`（LLM 懒初始化/`resolveSmartModel`/非流式 `chat`，~256 行），宿主仅留**薄转发** + 惰性 deps 端口（读写端口保持宿主状态权威）⇒ **移除 R04-001 豁免 FSZ-007**（例外 **8 → 7**）
- ✅ **配套**：`HEARTBEAT_STALE_MS` 等阈值经 `configManager.env` 单一入口；新增灰度开关 `EXECUTION_TWO_PHASE_CANCEL`（默认关 = 零行为变更）⇒ R07-2 安全开关断言 **14 → 15**（代码/断言表/规则表三处同批）
- ✅ **质量** - `typecheck` **0** · 全量 **5137 pass / 36 skip / 0 fail**（5173 tests / 553 files）· `lint:arch` **违规 0 · 警告 4（基线）** · `lint:size` **0 错**（例外 8 → **7**）· `lint`(eslint) **0 errors**
- ⚠️ **顺带发现（预存）**：`bun run lint`（prettier）在本仓**存量**违规（`bootstrap/*` · `compaction/*` · `tokenBudget/*` 等，非本版引入）——本版已把**触碰文件**清零；余 **0 errors / 56 warnings**（均为 `no-unused-vars` 类警告）待专项清理

---

#### v0.4.69 (2026-10-08)

**MCP 客户端双轨收敛（C-1/C-2/C-3）+ AI-VFS 从只读试点到用户可配置挂载面（P2 → T3）+ 沙箱/隔离死面清理（P1 / S1 / S6 / S7）+ 任务步骤证据链机械化**

- ✅ **MCP 客户端单链化（双轨收敛）** - `mcp_tool` / `mcp_resource` 改走**已连接的 SDK `Client` 顶层方法**（与 `mcp__*` 主路径**同一条链**）；删**增强层 `MCPManager` 重实现**（528 行）及其 `MCPCommandLoader`、删 `MCPClient.ts`（577 行）；`MCPServerManager` 改为**投影化**（`setProjection`/`clearProjection`），`MCPConnectionManager` 去掉 `connectAll`
- ✅ **MCP 实测缺陷修复（P0 + 资源泄漏）** - `client.capabilities.get()` 实为**不存在的属性** ⇒ 每次 `TypeError` 被 catch 吞成 `failed` ⇒ **整条 SDK 链不可用**（静态检查不可见）⇒ 改 `getServerCapabilities()`；诊断面按**真实 `status`** 映射（不再一律 `pending`）；`closeAll()` 逐个 `cleanup()` 修**进程泄漏**
- ✅ **AI-VFS 落地（P2 只读试点 → T3 用户可配置）** - 新增 `app/src/vfs/`（`IVfsDriver` + `VfsMountRegistry` + `DevDocsDriver` / `McpResourcesDriver`）与 **4 个系统调用工具**（`read_vfs` / `list_vfs` / `stat_vfs` / `write_vfs`）；`mcp://` 复用既有 SDK 链（**不复制**协议投影）；`GlobalConfig.vfs.mounts` 由 `buildMountPlan()`（纯函数）驱动装配；`list_vfs` 支持 **scheme-only 发现**（契约 v1.5）
- ✅ **VFS 前端管理面 + HTTP API** - 新增 `GET/PUT /v1/vfs/mounts`（**fail-closed** 校验：未知 scheme / `mcp` 缺 server ⇒ 400 且**绝不写盘**；**无热更新**，`requiresRestart` 如实上报）；客户端「设置 → VFS 挂载点」面板 + `vfsService`（挂在**既有「设置」模块**，未新建顶层路由）；接口清单 `api-spec.md` → 2.11.0
- ✅ **VFS 循环依赖 TDZ（P0，生产装配路径实证）** - `@modules/vfs` 桶**冷启动** import 抛 `Cannot access 'McpResourcesDriver' before initialization`（环的闭合边 = `MCPResourceTool` **模块作用域 `new`**）⇒ `registerVfsMounts()` 失败 ⇒ **全部挂载点启动注册不上**；根因修复为**惰性单例**（探针 `PROBE ERROR…` → **`PROBE: registerVfsMounts OK`**）
- ✅ **沙箱 / 隔离死面清理（P1 盘点 → S1/S6/S7）** - 删 `IsolationManager` / `EnhancedSandboxManager` / `docker/**` / `PTYSandbox` / `SSHSandbox` / `runWithLandlock`、`SandboxManager.execute()`、**workspace 子系统**、`ProcessRegistry` / `ResourceLimitManager`、未接线的 `SandboxConfigBuilder` 策略库；`createAdapter` 收敛为 **Local-only**；订正 `landlockSensitivePathGuard.test.ts` **测了不存在的路径**
- ✅ **工具注册表归一（P1 审计 D1–D4）+ 工具分类** - 注册表经**单一写入口**（弃 `new ToolRegistry()` 覆盖全局）；保证**每个已注册工具都有类目**（模型可见）；删桩化 MCP 资源工具只留真实实现；修「空注册表漂移」
- ✅ **任务步骤证据链机械化** - 步骤**机械回读**写入产物（证据不再依赖模型自觉）· 验收标准由工具输出**可证** · 证据喂入 verifier 的 `toolResults` 契约（REVIEW 不再恒 `ESCALATE`）· `/v1/pdca/start` 亦注入步骤 TAORLoop · LRTO/PDCA 步骤获**真实工具**（长任务可执行）· 阻塞工具改为**逐步引导**而非丢步
- ✅ **会话与工具口径修正** - steering 注入**落为 `context/steering` 事件**（可重建）· 删**第二套 steering 实现** · grep 60s 重复短路**不再伪装零命中** · 删孤立的消息命令队列 / 上下文修饰队列 · 删废弃 `resolve-module-aliases` 脚本
- ✅ **质量** - `typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **违规 0 · 警告 4（基线）** · 全量 **4617 pass / 24 skip / 0 fail**（4641 tests / 511 files）；前端 vitest **535 passed**（62 files）· 本版 **170 文件 +9340/−10174**

---

#### v0.4.68 (2026-10-08)

**用户工作流模板从"清单"到"可执行"（P1-19 ①②③ / P0-2）+ 路径护栏家族收口（S27 / D-244~D-247）+ 轨迹与检查器口径修正（S17 / S21 / S28）+ 工具描述中文化（P2-2）与裁定归档**

- ✅ **工作流模板持久化（S24 ①）** - 用户模板从模块私有内存 Map 改为**落唯一 `app.db`** 的 `workflow_templates` 表（对齐 `AgentRoleStore` 模式；进程重启不再丢失）；5 个 CRUD 路由经**服务层端口**取用（避免 service→app 静态倒挂）
- ✅ **模板↔执行器绑定（S24 ②，spec 推荐形态「①+②」）** - `WorkflowStep` 增**可选 `tool`**（缺省 = **显式不可执行**，不猜不降级）；新增装配层 `templateToDefinition()`（定义名 `template:<id>` 防撞名）+ `WorkflowTemplateProvider`（seam 的**同步** `listWorkflows()` 由 store 同步快照供数；逐步执行 + 步骤边界取消）
- ✅ **执行入口与权限边界（P0-2 / S24 ③）** - 新增 `POST /v1/workflows/templates/:id/run` **与模型可见工具 `workflow:run-template`**（`list`/`run`；**不用 enum** —— 模板是运行期 CRUD 的动态目录，未知 id 回列可用清单）；**执行前权限预检**：仅允许**非破坏性工具**（事实源 `tools/toolEffects.ts`，**未声明工具亦拒**，fail-closed），越界**整体拒绝**且**不静默跳过**；`assist` 类目放宽到 `coding`/`agent`
- ✅ **内建 4 模板 = 人工方法论清单（明确化）** - 取证确认"补 `tool`"不可行（每步含 `manual`/`review`、seam 无人工确认点、`WorkflowStep` 无 per-step `params`、破坏性步骤会绕过任务裁剪 ⇒ 权限提升）；`/run` 对 `builtin:*` 由 **404 not-found 改为 400 + 准确原因**
- ✅ **路径护栏家族（S27 / D-244~D-247）** - `.env` **模板白名单**（`.env.example`/`.sample`/`.template`/`.dist`/`.defaults`/`.tmpl` 放行，**真实密钥仍拒**）· PathGuard 拦截改为**只跳过命中调用**而非终止整轮（`ReActToolLoop` / `TAORLoop` 同族收口）· 路径护栏**折叠 `.`/`..` 段**关闭绕过
- ✅ **口径修正（S17 / S21 / S28）** - `tokenBudget` 抽**叶子常量模块**打断循环初始化 TDZ · 轨迹 `context/model-input` 读端改**逐单元回溯**（修"每面板每轮只呈现其一"）· 检查器窄视口可**手动展开**（根因 = effect 依赖 `isOpen`，**非**阈值）
- ✅ **评测与对抗提案阶段（D-244 / D-245 / D-247）** - 空提案轮**重试**而非中断阶段 · 提案 id 唯一 · 压缩 token 口径**如实**（不再把不同源数值相减）· 路径改写技术登记为**机械反作弊向量** · 逐目标提案分布输出
- ✅ **编排模式（pattern）与协作端口** - `self_verify` 触发接线 + **未接线原因如实上报** + 模式目录持久化；新增**协作端口（SPI）与通道适配器**（scope A，薄端口，不新建编排运行时）
- ✅ **工具描述中文化（P2-2）+ 裁定归档** - 工具 schema 描述 **6 批**中文化；死代码降债（删 4 处已裁定死面）；台账 stale-pass（23 项"待裁定"中 **11 项其实早已闭环**）与多项 spec 裁定归档（文档/规则订正、依赖收敛）
- ✅ **质量** - `typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **违规 0 · 警告 4（基线）** · 受影响测试目录 **683 pass / 0 fail**（`tests/tools` + `tests/workspace`）

---

#### v0.4.67 (2026-10-07)

**A2A v1.0 协议面收口（T4 A–E）+ 资源治理与输出护栏接线（P26-1/P26-2）+ 会话黏性路由与任务依赖硬阻断 + 死代码降债与文件拆分（C1–C14）+ 提示词中文化（P2-2 B1–B8）+ settings 权限接线**

- ✅ **A2A v1.0 协议面（T4 A–E）** - 新增 v1.0 JSON-RPC 协议类型 → 在 `/v1/a2a/rpc` 提供绑定 → SSE 流式任务更新（并声明 streaming）→ Agent Card 重塑为 v1.0 并恢复 binding → JSON-RPC 绑定从 `a2a-routes` 拆出；配套：**多 API Key + 可选过期**（零中断轮换）· 共享密钥**常量时间比较** · Agent Card 未接线时**不再广告** JSONRPC binding · 声明 `stateTransitionHistory` + 就绪探针
- ✅ **资源治理（P26-1）** - 请求优先级从 HTTP/通道入口**透传**到 governor → 超限时**抢占**低优先级跨会话流 → 超限请求**排队**（优先级交接 + 时限兜底）；抢占/排队状态经 **SSE** 暴露给前端
- ✅ **输出护栏双侧（P26-2 / PC-1）** - 护栏结果**回显到消息**（PC-1）· 改写审计**默认只记元数据**（动作 / 护栏名 / 原文长度 / 原文 SHA-256）· 秘密检测**收窄到真实值形态**并对 MIT 协议头**免报**（FP 修正）· 不可见 Unicode 表**收敛为单一事实源**（并集口径，加宽由测试锁定）
- ✅ **安全姿态钉死（R07 系列）** - R07-1 `long_task_pdl` 保持**装配不可达**（防误修）· R07-2 安全开关默认值升格为 **CI 断言事实**（doc-code 断言 5→15）· R07-3 **非幂等工具重试需审批** · R07-4 A2A 默认关 + 认证 fail-closed 钉死（断言 16→18）· R07-5 省略验收标准**永不可通过**（+3 用例）
- ✅ **会话黏性路由** - `SessionRouterStore` 单例接线（`main` 注入，benchmark 路径有意不注入）+ **上界保护**（长消息 + 低档位黏性不复用，交回 Judge）+ 守卫 7 例；**删死路由器族**（`AgentRouter` + 连带孤立 `StrategySelector`/types + `PlatformRouter`）
- ✅ **任务依赖阻断默认翻 hard（13-P1-1 Step 1+2）** - 先做**显式降级标注**（默认仍 soft、零阻断语义变化），再默认翻 `hard` + 模型按步 opt-out + 阻断回灌会话
- ✅ **提示词中文化（P2-2）B1–B8 全量** - 系统身份前缀 → 路由/编排/压缩 → 记忆 → 工具/子代理 → Agent 策略 → 命令（12 文件）→ 其它（建议模式 / 安全分类器 / goal 模板 / 内置技能正文）；**协议与契约保留英文**（JSON 字段名 · `VERDICT:` · `{{占位符}}` · `[SYSTEM] ` · 工具名 · 路径 · frontmatter 键），受影响断言同批同步
- ✅ **品牌残留清理（P2-1 重开）+ settings 权限接线** - `CLAUDE_CODE_*` 内部标志 → `PY_APP_*`（4）· 渠道凭证 → `CHANNEL_CLAUDE_*`（2）· `ClaudeChannel` 常量去品牌 ⇒ `app/src` 的 `CLAUDE_[A-Z_]+` **14 行 → 5 行**；**settings 的 `permissions.allow/deny/ask` 原为零消费者（写进 settings 不生效）⇒ 接入 `PermissionManager` 决策上下文**（来源优先级 user < project < local < policy），并**修掉** `getEmptyToolPermissionContext()` 的 allow/deny/ask **共享同一对象**缺陷（写 allow 会串写 deny/ask）+ 4 例回归
- ✅ **死代码降债（P2-8 批次 1–5）** - 删零消费者废弃符号 / 死 barrel / 重复实现；`utils/common.retry` 覆盖迁至 `withRetry` 后删除；**移除 5 处 blanket `no-explicit-any` 关闭**（类型化收口）
- ✅ **文件拆分 C1–C14** - 启动 preflight（C1）· 会话轻量扫描与 FTS5 分片（C2/C3）· Llama 日志与模型目录（C4）· `EventLogStorage`（C5a/C5b）· 前端 `MediaPage`（C6）· 知识维护 handler（C7）· QQ 协议常量与入站事件族（C8/C9）· `TAORLoop`（C10）· `streamMessageFlow`（C11）· `LongRunningTaskOrchestrator`（C12–C14）
- ✅ **门禁与契约文档** - 新增 **doc-code 语义一致性门禁**（A13/R11-1）并接入 `ci` + `version:check`；`lint:arch` **项目根与 cwd 解耦**（AR-2）+ pre-commit **不再容忍 exit 2**（AR-3）；新增 `core/spi` 端口实现点地图（R11-4）· 工具调用安全检查链路契约 · 编排模式目录暴露给前端（PC-6）
- ✅ **质量** - `typecheck` **0** · `eslint` **0** · `lint:arch` **违规 0 · 警告 4（基线）** · 全量 **4878 pass / 21 skip / 0 fail**（4899 tests / 519 files）

---

#### v0.4.66 (2026-10-06)

**U4 在线质量评估器全链闭环（D1–D6）+ ACP 远程暴露 fail-closed + 记忆冲突检测接线 + 死代码簇清理**

- ✅ **U4 在线质量评估器（新模块 `evals/online`）** - 纯函数 `scoreTurn()`（4 维加权：完成度 0.4 / 裁决 0.3 / 工具空转 0.15 / 成本 0.15）+ 4 条结构化可疑规则（`not-completed` / `verdict-negative` / `low-score` / `low-score-streak` 连续 3 轮）+ `deriveTurnSignals()` 从事件日志派生每轮信号（含正文摘录，处理 `assistant/text.replace` 清空重建）+ `runTurnQualityPass()`（水位去重 + 回看窗口 + 上限 5 最低分优先 + 分片让出 + 单会话错误隔离）+ 会话级摘要 `summarizeTurnQuality()`；**不消费 `BehaviorMetrics`**（其「仅观测、不得作判据」契约由反向锁定测试守住）
- ✅ **U4 D3 可疑轮 LLM 复核** - `createVerifierTurnReviewer()` 复用 `VerifierAgent`（**每轮新建实例**——`cycleCount` 为实例态，复用会使第 2 轮起恒 `ESCALATE`）；模型只取 `modelRouter.resolveRole('verifier')`，未配置即返回 `null` 跳过；实测边界：**无正文 ⇒ 跳过复核**
- ✅ **U4 D4 空闲期接线（主链零调用）** - 挂在 `ChatOrchestrator._ensureIdleScaleMonitor().onIdle`（每次空闲只触发一次）；会话范围 = 活跃会话 ∪ 最近 30 个历史会话（`rankRecentSessionIds` 按 `updatedAt` 降序去重截断）⇒ **历史会话补评**同步落地
- ✅ **U4 D5 事件契约四处同批** - `turn/quality` 新增：`shared/events/eventNames.ts` 名字 + `session/types/eventPayloads.ts` 后端载荷 + `client/src/types/events.ts` 前端载荷 + `knownEventTypes.ts` 登记清单（编译期穷尽断言强制，漏一处即 `TS2322`）
- ✅ **U4 D6 消费点 = core SPI** - 新增 `ISessionQualityPort` + 转发代理（未注册返回 `null`），实现由 `entrypoints/spiWiring.ts` 注入 ⇒ 梦境（`chronos/autoDream`）可读在线质量分而**零 infra→app 倒挂**；`AutoDream.buildSessionLines` 追加质量摘要（失败只 `warn` + `@ignore-catch`）
- ✅ **N-81 ACP 远程暴露 fail-closed** - 非回环地址 + 无 token ⇒ **拒绝启动**（不再默认放行）；配套 `acpContract.test.ts` / `acpRemoteExposure.test.ts`
- ✅ **记忆冲突检测接线** - 空闲期只检测与记录，**零数据改写**
- ✅ **死代码簇清理（N-78 / N-82 / N-83）** - 删除 `AdaptiveRouter` 整类 + `subagent/communication/` 4 文件族（`SubAgentCommunicator` 占位模拟 + `receivePermissionResponse` 无条件 `granted:true` = CS04 + fail-open）+ 权限同步双轨孤儿 3 文件 + MOA 成本死码；同步清理 `lint-architecture` 例外与 barrel 再导出
- ✅ **N-74 i18n en 补齐** - 96 键 + 键一致性守卫（防再漂移）；**媒体提取工具命名统一为下划线** + 守卫测试
- ✅ **契约测试补齐** - A2A 委派/回查 405 两态 + ACP 全契约
- ✅ **D2 迁移评估（`dependsOnMode`）** - 取证结论：`hard` 在**生产不可达**（分解 prompt 不产出该字段、无 config/UI/env 开关、调用方未传）⇒ 13-P1-1 的修复在生产上不生效、A3 缺陷原样存在；结论 = **应当翻转但不能单独翻转**（两步走方案已入台账 §20.6）；`topoBatches.ts` 注释补入该结论。**订正（2026-10-07）**：该评估的**两步均已落地（2026-10-06）** —— `topoBatches.ts` 默认已翻转为 `?? 'hard'`（Step 2）+ Step 1 显式降级 + F8 回灌，详见台账 §20.6 ⇒ 本条为**评估当时**的中间结论，**最终状态＝已翻转**
- ✅ **质量** - `typecheck` **0** · `eslint` **0** · `lint:arch` **违规 0 · 警告 4（基线）** · 全量 **4718 pass / 21 skip / 0 fail**（500 files；较上版 **+74 例**，逐数吻合）

---

#### v0.4.65 (2026-10-06)

**评测体系四项扩展（A1 / A2 / A3 / A6）+ 协议与可观测性对齐（A5 / A4）+ README 特色重写**

- ✅ **A1 可靠性口径：pass^k 曲线** - 新增 `passHatK()`（`C(c,k)/C(n,k)` 组合式**无偏估计**，逐步连乘避免溢出）+ `computeReliabilityCurve()`（逐点任务平均，**只算跑够 k 次的任务并记录参与数**，`n_t < k` 的任务**退出该点**而非记失败）；报告与 CLI 新增「可靠性曲线」段（仅 k≥2 点，k=1 退化为单点不展示）；**不改**既有 `pass1`/`passK`/`checkGate` 与 `baseline.json`；新增 `tests/evals/passHatK.test.ts` **10 例**
- ✅ **A2 真实任务级回归基线** - 新增逐用例 JUnit 解析 `parseJunitCases()`（`<testcase>` 三态 + 实体解码）+ 稳定键 `junitCaseKey()`；由**双实测自动派生** `F2P`（起点红→修后绿）/ `P2P`（起点绿→保持绿），物化期 **fail-closed**（F2P 为空即拒绝出题）；打分新增 `resolved` / `breaking` / `no-op` 与 `resolvedRate`（仅双清单任务进分母）；用例 **17 例**
- ✅ **A3 安全评测：聚合 ASR（Max 口径）** - `SecuritySummary` 增 `aggregatedAsr`/`aggregatedWon`：同一场景**任一**已完成攻击得手即该场景记"被攻破"（**空转不算**，与 `asr` 分母口径同源），与 attempt 级 ASR **并存展示**（各自标注口径，防误读）；**不改**题集 / 运行时防护 / 退出码；用例 **5 例**
- ✅ **A4 可观测性：OTel GenAI 语义约定** - LLM 请求 span **并存**写入 `gen_ai.operation.name` / `gen_ai.request.model`（span 创建时）+ `gen_ai.usage.input_tokens` / `output_tokens`（结束时）；span 名与 `Liri.*` 指标**零改名**（避免破坏覆盖去重键与客户端 trace 视图）；内容类属性按规范**默认不采集**
- ✅ **A5 A2A 对齐 v1.0.0** - 发现路径 → `/.well-known/agent-card.json`；`A2ATaskState` → **9 值 `TASK_STATE_*`**（补齐 `UNSPECIFIED` / `AUTH_REQUIRED`）；`A2A_METHODS` 值 → v1.0 PascalCase 抽象操作名；枚举改名的**编译期强约束实测**精确捕获 4 处残留状态字面量
- ✅ **A6 检索基准：真实语料 + 对照口径** - **删除模拟语料生成器**（`${topic}${w}${p}` 式假词），改用仓库自身 **143 篇真实文档**（复用既有 `FileDocsProvider`）；查询词由语料标题派生；新增 `benchRetrievalModes()` 对照 `exact-title` / `keyword` / `hybrid` / `vector` / `graph` × `recall@1/5/10` · `MRR` · 延迟 · `matchType` 分布；不可得模式**显式标记不可用 + 原因**（不填 0 冒充）
- ✅ **README 重写（非仅版本说明）** - 新增「**🌟 为什么是 Liri**」6 条工程取向（可复现优先 / 写前持久化 / 自带评测与回归门禁 / 架构门禁化 / DB 为唯一事实源 / 真实语料自测）；新增 5 个功能小节：**评测与回归门禁** · **可复现与回放** · **知识库与知识图谱** · **多智能体协作与工作流** · **协议面**
- ✅ **质量** - `typecheck` **0** · `eslint` **0** · `lint:arch` **违规 0 / 警告 4（基线）**、分层 **3886** · 全量 **4644 pass / 21 skip / 0 fail**（4665 tests / 492 files）

---

#### v0.4.64 (2026-10-06)

**A10 协作编排单一构造点 + CLI 退出码（O6）/ 知识图谱 domain round-trip（P2-12）修复 + 记忆分层文档化 + A2 立项**

- ✅ **A10 协作编排单一构造点（零行为变更）** - 原 `new CouncilOrchestrator(...)` **散落 2 处**（`chat/ChatManager.ts` / `runtime/api/domainSnapshotOps.ts`，无共享工厂）⇒ 新增 `workspace/CouncilOrchestrator.ts#getCouncilOrchestrator()` 模块内单例，两处改走该入口 ⇒ **模块外构造点 2 → 0**；`lint:arch` 与基线**逐数一致（零新边）**；立项 spec `.trae/specs/collaboration-orchestration-contract.md`（G3 窄端口按 CS03 暂缓——无消费者即死抽象）
- ✅ **O6 CLI 失败路径返回非零退出码** - 根因**实证**：退出钩子内 `process.exit(0)` 会把已确定的退出码**强制改 0**（实测 `exitCode=3` ⇒ **0**），令 commander 的 `exit(1)`（未知选项/缺参）与 action 失败码全部失效。① `cli/exitHandler.ts` 新增 `runExitCleanup()`（**只清理、不 `process.exit`**），退出钩子改调它；② CLI 局部 `handleError` 包装（import 改名 `recordError`）统一置 `process.exitCode = 1`（17 处 action 失败，**零调用点改动**）；新增 `tests/cli/exitHandler.test.ts` **3 例**
- ✅ **P2-12 知识图谱 `domain` round-trip 保真** - `KnowledgeGraph.ts#rowToEdge` 由 `row.domain || undefined` 改 **`|| ''`**（与 INSERT 侧 `edge.domain || ''` 及唯一索引 `COALESCE(domain,'')` 同源）⇒ 消除"导出时字段消失、导入又还原 `''`"的 round-trip 不保真；新增 `tests/knowledge/knowledgeGraphDomainRoundTrip.test.ts` **3 例**
- ✅ **记忆分层文档化 + 端口注释行号订正** - `app/src/memory/README.md` 重写为**分层 + 端口文档**（域边界表 / 关系图 / 四窄端口实现者行号 / 命名消歧 4 条 / 域外同名易混清单）；顺带订正 `memory/ports/MemoryPort.ts` 注释内 `MemoryManager.ts` **行号整体陈旧**（实现者 10 处 +14 行、死契约 `:63`→`:72`，共 **11 处**按实测订正；纯注释）
- ✅ **A2 立项：S1 真实任务级回归基线** - 新增 `.trae/specs/eval-s1-real-task-baseline.md`（SWE-bench 精读落地项 A2：**F2P/P2P 双清单判据** + `resolved/breaking/no-op` 语义；D1–D4 待裁定，**未动码**）；同批登记 `.trae/specs/dsh-plugin-shim-contract.md`（T-3 契约）与 `orchestration-lifecycle-contract.md §9`（`LoopLifecycle` 维持排除）
- ✅ **文档回填 + 质量** - `data-contract-unification.md **§9.14**`（P1-8 收官：E 组 type-only 仅上报 + R02-002 维持 `≥3`）· `layer-inversion-a-class-inventory.md **§3.17.20**`（P1-9 收官）· 提示词中文化报告 **v2.0**（原 6 项对账 + ~35 文件现存英文提示词面 + 排期建议）· 台账。门槛：`typecheck` **0** · `eslint` **0** · `lint:arch` **错误 0 / 警告 4（基线）** · 全量 **4612 pass / 21 skip / 0 fail**（4633 tests / 488 files；较上版 **+6 例 / +2 文件**，逐数吻合）

---
#### v0.4.63 (2026-10-06)

**技能系统收口（SK-2 + `impl` 契约）+ 媒体页任务重试与状态单一事实源 + CHANGELOG 历史补录**

- ✅ **SK-2 内置技能收敛为 prompt 型** - 内置 7 个 `type:'agent'` **空壳**（verify/loop/batch/optimize/document/refactor/test）**无条件注册** ⇒ ① 三处 placeholder **假执行**；② **同名遮蔽**（真 prompt 型 `verify` 不可达）。改为**只注册 `type:'prompt'`**，删除 `executeCommandSkill`/`executeAgentSkill`/`executeGenericSkill`，`executeSkill` 收敛 prompt-only + 边界**如实拒绝**（§1.15-6 技能仅提示词注入）；新增 SK-2 测试 **5 例**
- ✅ **`Skill.impl` 类型契约订正** - **取证**：类型一直**必填**、6 处生产构造点**全部提供** `impl`、全仓无「无 `impl` 技能」、台账无 V-14 记录 ⇒ 原规则「`impl` 可选」**失真**。订正 `project_rules §1.15-11` 为「**必填**」（规则版本 → **v7.15.0**），并收口 `SkillRegistry` 唯一防御点 `skill.impl?.kind` → `skill.impl.kind`（CS03：不为生产中不可达的形态写防御）
- ✅ **媒体页 MD-2/6/9/10/11 收口** - ① **MD-2** 删除 `VideoTaskItem`/`activeTasks` **影子副本**及其 4 个 action，`useVideoTaskPolling` 重写为**派生自 `generationTasks`** 的单一事实源（轮询直写、`submitTask` 不再补写占位条目）⇒ 消除「双写 + `remoteTaskId` 匹配」的结构性易漂移；② **MD-10** `GenerationTask` 新增 `videoParams`（留存原始请求参数）⇒ 失败视频卡新增「**重试**」（移除失败卡 + `submitVideoTask` **忠实重放**，与 `handleGenerate` 共用，§1.3 方法禁止重复）；③ **MD-6** `ActionMenu` 去掉「非图片返回 null」+ **GridView 补渲染**（原图片编辑/图生视频/下载/删除全不可达）；④ **MD-9** 新增 `scrollMediaItemIntoView`，生成后自动定位新图；⑤ **MD-11** `removeGalleryItem` 补 `saveFavorites`（消除删除后刷新收藏复活）
- ✅ **`KnowledgeSaveTool` 模块顶层 TDZ 修复（预存缺陷）** - 顶层 `getAllFragmentPrefixes()` 与 `ContextualFragment` 循环导入 ⇒ 单独运行技能测试**必现** `ReferenceError: Cannot access 'PREFIX_BY_KIND' before initialization`（全量跑靠模块加载顺序偶然通过；已 `git stash` 复现证实非本批引入）⇒ 改**惰性 + 记忆化**
- ✅ **CHANGELOG 历史补录** - 自 `v0.1` 起按 git tag/log 补录 **38 个版本段**（+411 行），全文件按版本号降序归并（数值相等时更具体者更大）；新增 `versioning.md **§3.1**` **补录标记约定**（触发条件 / 事实统计 / 顺序 / 异常标注 / 工具与粒度红线）
- ✅ **质量** - `typecheck` 0 错（前后端）· `eslint` **0 error / 136 警告**（基线）· `vitest` **506 pass / 56 files / 0 fail** · 服务端全量 **4582 pass / 21 skip / 0 fail**

---
#### v0.4.62 (2026-10-06)

**A1 Fail-Closed 受阻机制全链闭环 + §13 七项建议全部落地 + A5 跨会话资源治理（新模块）**

- ✅ **A1 Fail-Closed 受阻机制（T1–T6）全链闭环** - ① **取消判定去字符串匹配**（`PendingOption{label,outcome}` 结构化 + `isGateCancelled()`，订正 `NegotiationState` 失实自称）；② **挂起清单事件投影 + 启动重建**（`pendingSuspensions.ts` + `bootstrapPendingRecovery()`）；③ **fail-closed 结算**（不可判定 ⇒ 不放行）；④ **结算实时可见**（`suspension_settled` → chunk 映射）；⑤ 验收归档（投影等价性 + 结算收敛幂等 + spec §8 验收表）
- ✅ **§13 七项建议全部落地（《Agentic Design Patterns》21 模式复查）** - ① **13-P0-1** 验证器三条降级路径 **fail-closed**（`passed:false` + `ESCALATE`，开关 `VERIFIER_FAIL_CLOSED` 默认 true）；② **13-P0-2** `SuccessCriteria` **一等对象化**（新增 `core/successCriteria.ts`：解析 / 骨架 / 判定对齐，漏项不复行）；③ **13-P1-1** 拓扑分批**依赖失败传播**（`computeTopoSkips` + `block/continue` 传播 + `skipped` 终态）；④ **13-P1-2** 工具**幂等 / 副作用声明**（新增 `tools/toolEffects.ts`，71 个内建工具逐一声明、编译期联合防漏；非幂等禁盲重试）；⑤ **13-P1-3** 装配升级为**执行配方**（`PatternRecipe` + `self_verify` 升 `ready`，复用既有 `VerifierAgent`）；⑥ **13-P2-1** **输出侧内容护栏**（core `outputGuard` 统一契约 + 注册表；PII 打码 / 敏感拦截 / 注入回显，**默认关**）；⑦ **13-P2-2** **评估指标回流**（新增 `tasks/behaviorFeedback.ts`，任务结果率回灌 `PlanDrivenLoop` 路径选择）
- ✅ **A5 跨会话资源治理（新 app 模块 `resourceGovernor`）** - 在飞会话**只读视图**（`snapshot()`）+ 并发上限**告警**（`overLimit`，不拦截）+ `admit`/`release` 生命周期；两条请求路径（流式 `streamMessageFlow` / 非流式 `sendMessage`）接入；开关 `FEATURE_RESOURCE_GOVERNOR` **默认关**（关闭时零行为变更）。⚠️ 如实边界：**抢占 / 排队未做**（用户裁定最小范围）、**优先级透传未做**（生产侧恒 `interactive`）
- ✅ **治理与文档** - `CHANGELOG.md` **建库**（版本变更单一事实源）+ `README` 精简（只留最新一版 + 指回本文件）+ `version:check` 覆盖 README/CHANGELOG；任务计划 §2.4 **逐项裁定与执行**（onReady 失实订正 / 通道进程隔离立项 / 删死工厂 / 注释与计数订正 / 7 篇 stale 状态头）；`roughTokenCountEstimationForMessages` 标记 `@deprecated`
- ✅ **质量** - `typecheck` 0 错 · `eslint` 0 错 · `lint:arch` 违规 **0**（4 警告基线）· 全量测试 **4577 pass / 21 skip / 0 fail / 4598 tests / 484 files**

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

#### v0.4.49 (2026-09-10) （git 历史补录）

> 实质提交 **3** 条：fix 1 · build 1 · style 1

- tauri.conf.json version 0.4.48→0.4.49（bump 漏改此处）
- 单档矩阵收敛——退役 personal/pro 双档，full 全量构建为运行时 tier 预留
- eslint --fix 格式化资产选择链（单档收敛后续）

#### v0.4.48 (2026-09-09) （git 历史补录）

> 实质提交 **19** 条：fix 10 · style 4 · build 3 · feat 1 · refactor 1

- personal 双档运行时隔离 + CI/产物/updater edition 化（专项 P1-P3）
- NSIS smoke sidecar 去后缀事实修正 + Rust cache 跨档污染 + bundle 残留二次后缀
- sidecar cwd 锚定安装目录修复 bun compile external 解析 + NSIS smoke 路径事实修正
- Windows zip 打包 pkg\* 经 bash 转义致条目带 pkg/ 前缀，smoke 找不到运行时
- bun runtime shim 误复制根因修复 + portable 变体参数化 + smoke 注解诊断
- Windows smoke 解压改用 Expand-Archive（Git-Bash 无 unzip）+ 失败诊断写 step summary
- …（另有 13 条实质提交，详见 `git log v0.4.47..v0.4.48`）

#### v0.4.47 (2026-09-09) （git 历史补录）

> 实质提交 **35** 条：feat 16 · fix 9 · style 5 · chore 2 · refactor 1 · docs 1 · build 1

- 打包资源契约——ffmpeg 内置化（内置优先/PATH 兜底）
- openai-gateway 通道完善（dawate 私有化网关路由/UI/API 规格）
- 新增「私有化部署」供应商（dawate 智能体平台 v3/chat 协议）
- 文件管理与知识库协同收敛（去重呈现/记录出处回链/已入知识库状态）
- 知识库优化收官 B0-B10/F1-F5/D1-D5 + UI 走查 P1/P2 全量
- R5 引用锚点渲染（识别 #p.N/#L42-L58 → 点击打开本地文件定位）
- …（另有 29 条实质提交，详见 `git log v0.4.46..v0.4.47`）

#### v0.4.46 (2026-09-07) （git 历史补录）

> 实质提交 **40** 条：fix 20 · feat 18 · refactor 1 · chore 1

- 文件管理 P0-P2/L 修复、chat 轨迹与 PDCA 收口、research/pattern 模块批次
- 会话删除联动 PDCA 终态化收口（阶段一 4.2-5）
- project 会话判定收敛单一换算（阶段一 4.2.1）
- 注册 project 模块实体 + emoji meta（阶段一 4.2.2）
- /v1/sessions 项目会话判定收敛（阶段一 4.2.3 双读）
- PDL 快速路径注册 checkpoint 任务实体（4.0-2 N1）
- …（另有 34 条实质提交，详见 `git log v0.4.45..v0.4.46`）

#### v0.4.45 (2026-09-02)

**上下文治理与内存水位机制（OS 内存管理式）**
- ✅ **上下文分层治理落地** - D7 事件索引（events.idx 二分定位 + UTF-8 偏移 + 损坏行区间降级）；A text-batch 正文聚合（64KB/2s，事件数 10K→169/622）；B0/B1 滑动窗口快照 + 热窗 ≤10K + 缓冲下沉存储层；C 请求分层（token 动态分页点 + `session_lookup` 按需取回 + CONTEXT_LAYERING 开关）；D 摘要事件化（session/summary）+ 跨会话记忆上卷与检索适配器
- ✅ **会话中断与内存尖峰排查修复** - 优雅关闭防 torn（全会话缓冲先落盘）、图谱提取节流、MEM_PROFILE 内存画像插桩、单轮长任务 45K 分层压缩触发、MemoryStore flushBatch 竞态根治
- ✅ **内存水位触发机制** - OS kswapd 式 L0/L1/L2 分级回收（flush 脏页/后台让位/窗口收紧 45K→32K），内置事件循环滞后探针（GC STW ≥2s→L1 / ≥5s→hard）+ 反向放宽（thrashing 防护）+ 压力期自动逐点采样
- ✅ **基准验收** - P3-7f 同源长任务真实重测：事件数 PASS、单请求 inputTokens 封顶 ≈45K（较基线 124,475 降 64%）、会话数据内存 4-24MB/会话达标
- ✅ **D5② 代码/长文档取回增强** - 代码/文档类任务分层切窗时注入更强"原文可取回"提示，`session_lookup` 页预算 8K→16K chars（判定 `isCodeContextMessage`，stream/send 双路径；内存仍受 ctx 压缩点保护）

#### v0.4.44 (2026-08-31) （git 历史补录）

> 实质提交 **13** 条：fix 8 · refactor 1 · test 1 · chore 1 · ci 1 · style 1

- P3 前端交互专项 — 标题双写竞态/确认框防连点/虚拟滚动前插测量缓存
- 前端遗留专项 — 补 DELETE /v1/workspaces/:id 路由 + 删除 projectStore 死代码
- tests/ 类型错误 491 个清零并纳入 typecheck 覆盖
- child_process mock 泄漏修复 — 全量 bun test 隔离污染根因
- 修复预存测试失败 — Python 子进程编码、ReActLoop 桶 TDZ、知识库路径重设、ai 桶导出补齐
- Release 测试范围统一（bun test tests/）+ Dockerfile external yoga-layout 修复构建
- …（另有 7 条实质提交，详见 `git log v0.4.43..v0.4.44`）

#### v0.4.43 (2026-08-30) （git 历史补录）

> 实质提交 **153** 条：fix 89 · feat 25 · refactor 25 · chore 6 · style 3 · perf 2 · test 2 · docs 1

- 事件快照缓存补齐对标短板（dsh eventsSnapshot）+ 损坏行恢复 excludeTypes 修复
- 记忆索引/关系图谱接入统一信封格式(gzip+checksum)
- 记忆文件压缩 + checksum 校验（L1 深化，对标 dsh 存储工程化）
- 对标报告短板补齐 - 存储工程化 / MCP 开放接口 / 真实 embedding
- 长会话分页懒加载（阈值触发：超 100 条显示加载更早，后端 limit/before 分页）
- 错误面板新增继续按钮（先落盘再基于已生成内容续写）
- …（另有 147 条实质提交，详见 `git log v0.4.42..v0.4.43`）

#### v0.4.42 (2026-08-18) （git 历史补录）

> 实质提交 **6** 条：feat 2 · fix 2 · chore 2

- 渠道模块 26 项问题修复 + 可观测性指标 + 僵尸代码清理
- fetchWithConnectionRetry 增加详细重试日志（间隔/原因/底层 cause）
- Provider 连接错误与 SSL 证书验证兼容 Bun 运行时
- OpenAI 流式连接失败诊断增强（展开 fetch cause：DNS/端口/超时）
- 续期 20 条分层例外（BULK-001~018 + PM-001/002，60 天衰减到期）
- BaseAIProvider 重试日志 cause 断言格式化（eslint --fix）

#### v0.4.41 (2026-08-17) （git 历史补录）

> 实质提交 **5** 条：fix 3 · feat 1 · chore 1

- handleCreateCustomModel 与邮件读取关键分支加详细日志便于排查报错
- 办公模块复查 N-3~N-9 修复（邮件 UID/正文拉取、日历提醒与生命周期）
- 前后端同步 isCustom 字段（创建模型标记自定义）
- 模型管理添加模型失败（20 values for 21 columns）
- eslint 自动修复 + 版本升级 V0.4.41

#### v0.4.40 (2026-08-17) （git 历史补录）

> 实质提交 **38** 条：fix 24 · style 5 · feat 3 · ci 3 · refactor 1 · test 1 · chore 1

- extractMailBody 关键分支加日志便于排查 MIME 解析异常
- 模型价格体系——官方价格源/分时/按次计费 + 前端价格展示与一键同步
- AI 回复气泡导出（md/html/word，含数学/物理/化学公式渲染）
- 邮件详情显示真实正文（IMAP body 解析纯文本）
- 办公模块复查 N-1/N-2 打通下载与上传 + 遗留低危项
- OpenAI 流式断连自动重试 + 修复 OfficeCLIDetector prettier 格式（CI lint 失败根因）
- …（另有 32 条实质提交，详见 `git log v0.4.39..v0.4.40`）

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

#### v0.4.36 (2026-08-04) （git 历史补录）

> 实质提交 **11** 条：fix 8 · feat 2 · chore 1

- 阶段偏好改为直接选择模型（phase → modelId）
- 任务分工新增「知识库编译」任务类型，支持独立配置编译模型
- CI lint 失败 — 修复 6e61f4d4 引入的 prettier 格式违规
- 打包后 sharp 找不到 — Bun compile external 解析修复（autoload flag + chdir + 同级 node_modules）
- 语义索引构建刷屏 — rootDir 兜底 + embedding 失败熔断 + 进度日志节流
- Dream 精炼与记忆精选模型显式走 modelRouter，消除同类 Kimi-K2.6 400
- …（另有 5 条实质提交，详见 `git log v0.4.35..v0.4.36`）

#### v0.4.35 (2026-08-04) （git 历史补录）

> 实质提交 **137** 条：fix 53 · feat 45 · refactor 17 · chore 11 · docs 8 · other 3

- 全模块监控覆盖 — handleError/OTel 统一入口
- PDCA 思维注入普通聊天 + 项目桥接建议
- 隐性引擎升级通道 — 检测到 goal 自动发起完整 PDCA 循环
- Project.pdcaIds 归属字段 — PDCA 任务反向索引到项目
- 讨论记录 — ProjectHistoryStore 追加式落盘 + 两级展开面板
- PDCA 后台集成 — WorkItem 联动 + 归属打通 + 幂等 + 启动扫描
- …（另有 131 条实质提交，详见 `git log v0.4.34..v0.4.35`）

#### v0.4.34 (2026-07-16) （git 历史补录）

> 实质提交 **2** 条：fix 1 · refactor 1

- 恢复 Tauri sidecar 编译脚本（build:win:coding/build:mac/build:linux --compile）
- 废弃 standalone-exe，全量切换到 portable-bundle

#### v0.4.33 (2026-07-16) （git 历史补录）

> 实质提交 **6** 条：feat 2 · fix 2 · chore 1 · ci 1

- Office 模块（Doc/Calendar/Mail）+ CronScheduler 状态转移修复
- 便携 Bun + bundle 打包 CI/CD 完善，版本升级至 v0.4.33
- copy-bun-runtime 跨平台兼容（Linux/macOS which + bun 无 exe 后缀）
- CronScheduler inFlightJobs 去重防止 catchUpMissedJobs/tick 竞跑双次执行
- 版本同步至 v0.4.33（6 个文件统一）
- lint-test 中 bun test 允许预存 flaky 测试失败不阻断 pipeline

#### v0.4.32 (2026-07-16) （git 历史补录）

> 实质提交 **3** 条：fix 2 · feat 1

- 便携 Bun + bundle 打包架构（方案 C）
- 媒体页面图片编辑、对比、删除交互问题修复
- security-full-audit-report 全面修复整改

#### v0.4.31 (2026-07-15) （git 历史补录）

> 实质提交 **9** 条：feat 6 · chore 2 · fix 1

- media page comprehensive optimization — 33/33 tasks complete
- Loop optimization Phase 4 complete -- VerifierAgent, StreamingToolExecutor, failure modes & anti-patterns docs
- Loop module comprehensive optimization — Phase 1-3.5 planning + eslint fixes
- loop-engine optimization + chat UI redesign + media tools
- loop-engine 优化 + 聊天界面 UI 改造 + 多媒体工具
- add path utilities — traversal check, cross-platform compare, tilde expand, display path, sanitize
- …（另有 3 条实质提交，详见 `git log v0.4.30..v0.4.31`）

#### v0.4.30 (2026-07-13) （git 历史补录）

> 实质提交 **61** 条：feat 25 · fix 21 · docs 5 · refactor 3 · chore 3 · test 2 · perf 1 · bench 1

- translation page full optimization — voice input, live translate, OCR image translate, alternatives, compare mode, share, UI polish
- P1-3 content templates (4 templates), P1-6 batch move-to-base, P2-3 send-to-chat button, P2-6 search snippet expand + keyword highlight
- P1-9 soft-delete trash/restore, P1-10 knowledge export (JSON manifest download)
- P1-5 compile progress bar, P1-1 concurrent batch upload (5x), P1-2 source distribution chart
- P0-1 server-side pagination (offset/limit + pagination UI controls)
- P1-4 SaveKnowledgeModal combobox, P1-7 auto-save + draft recovery, P1-8 empty state guide buttons
- …（另有 55 条实质提交，详见 `git log v0.4.29..v0.4.30`）

#### v0.4.29 (2026-07-09) （git 历史补录）

> 实质提交 **1** 条：feat 1

- image recognition pipeline overhaul — enforce task-routing, remove hardcoded provider fallbacks, bump to v0.4.29

#### v0.4.28 (2026-07-09) （git 历史补录）

> 实质提交 **44** 条：fix 31 · refactor 5 · chore 4 · feat 3 · ci 1

- runtime architecture hardening (4 optimizations)
- ChatManager模块拆分 Step 3-6 完成 + 安全网脚本
- ChatManager模块拆分 Step 1-2 + 图片URL固化
- CanvasTool — add element validation, enhance element structure docs, support custom export path
- remove non-existent configs/ COPY from Dockerfile runtime stage
- expand Docker build context to include shared/ for @shared/* path aliases
- …（另有 38 条实质提交，详见 `git log v0.4.27..v0.4.28`）

#### v0.4.27 (2026-07-06) （git 历史补录）

> 实质提交 **25** 条：fix 24 · feat 1

- 测试环境使用 :memory: 内存数据库，消除文件系统依赖
- build.rs 动态创建 externalBin 所需的精确文件名占位符
- Build sidecar 步骤添加调试输出，诊断 liri_coding 二进制是否产出
- 增强 sidecar 复制容错性，用通配符查找二进制 + 构建后归一化文件名
- sidecar 二进制路径从 app/dist 改回 dist，匹配构建脚本 --outfile
- 修复 sidecar 复制路径 ../dist 为 ../app/dist + build.rs 在 binaries/ 下放占位文件
- …（另有 19 条实质提交，详见 `git log v0.4.26..v0.4.27`）

#### v0.4.26 (2026-07-05) （git 历史补录）

> 实质提交 **5** 条：fix 3 · chore 2

- CI编译失败 — CommandEvent match 添加 #[non_exhaustive] 通配分支
- 后端 sidecar 崩溃诊断 — 捕获 stderr/退出码，前端展示错误信息
- GrokProvider 缺少 logger 导入 + BaseAIProvider dispatcher 类型断言
- pre-commit hook 添加 ESLint 检查 + ESLint auto-fix
- 版本号更新至 v0.4.26

#### v0.4.25 (2026-07-05) （git 历史补录）

> 实质提交 **9** 条：fix 3 · chore 3 · feat 2 · docs 1

- 聊天输入区增加图片上传与多模态发送（P1-2.1）
- 重构图像模块，新增 Canvas 编辑器 -- 画笔/橡皮擦/形状/文字/选区/油漆桶等工具, ImagePage 组件拆分, ErrorBoundary, 修复 ToolCallGroup 图片显示, 删除 ImagePasteReceiver
- 修复客户端测试 — Path2D/ImageData polyfill + services.test 断言适配
- Windows 新环境部署兼容性修复 -- .env 路径、BashTool 平台适配、Git SSL
- 图像生成 Provider 路由和 fallback 链修复 -- ProviderSyncService 移除 generateImage stub, getRouter 改为模型驱动精确匹配, Router generate 修复 break 后未 return 的 Bug, RegistryImageProvider 新增 providerId getter
- 图像模块与聊天模块集成方案（P1-P3 三阶段渐进式）
- …（另有 3 条实质提交，详见 `git log v0.4.20..v0.4.25`）

#### v0.4.20 (2026-07-03) （git 历史补录）

> 实质提交 **14** 条：feat 8 · fix 5 · chore 1

- 基础设施升级完善 — 日志系统整改、监测覆盖补齐、预存类型错误修复
- 图像模块全栈优化 — 多Provider架构、生图路由、Bug修复、ESLint格式化
- v1 P1-2 agent filter tab in sidebar + v1 doc status corrections
- v2 Phase 1-3 complete - http migration, compression events, blocks fix, race fix, knownFilePaths, i18n, cache, reentry
- session system v2 optimization Phase 1-3 - http migration, compression events, blocks consistency, race fix, i18n, cache
- session system v1 optimization - memory vectorization, REST API, pruning/compaction, frontend UX
- …（另有 8 条实质提交，详见 `git log v0.4.10..v0.4.20`）

#### v0.4.10 (2026-06-28) （git 历史补录）

> 实质提交 **1** 条：fix 1

- STT model path standardization, Tauri startup, and React Hook deps

#### v0.4.9 (2026-06-28) （git 历史补录）

> 实质提交 **8** 条：fix 3 · feat 2 · i18n 2 · tools 1

- 图像工具全栈优化 + 前端全量 i18n 国际化
- P0 StdIO bridge — Python vision_worker + process lifecycle + watchdog
- use findAllByRole (async) for e2e delete button queries
- e2e tests — i18n mock, aria-label, role-based queries
- i18n full coverage + install env compat + Vite proxy + ESLint zero
- settings config page fully translated — 71 hardcoded Chinese strings fixed
- …（另有 2 条实质提交，详见 `git log v0.4.8..v0.4.9`）

#### v0.4.8 (2026-06-27) （git 历史补录）

> 实质提交 **12** 条：fix 8 · feat 3 · chore 1

- 语音模块 P0 级优化 — STT/TTS 缓存、故障转移链、音频前处理、分片合成
- ESLint 格式修复 + 聊天/会话/工作区模块功能增强
- TTS 模块功能增强 — Edge TTS 修复、日志/错误归一化、Persona 管理及前端页面
- LSP 性能测试 CI 失败 — 放宽阈值 + 添加 getAllLanguages 缓存
- 修复新环境 C:\Users\Default 路径错误导致后端无法启动
- 修复 client 端 12 个 TypeScript 错误
- …（另有 6 条实质提交，详见 `git log v0.4.7..v0.4.8`）

#### v0.4.7 (2026-06-25) （git 历史补录）

> 实质提交 **3** 条：feat 2 · fix 1

- TTS 模块补充 OTel/Logger/HandlerError 全路径监控覆盖
- 语音服务模块重构 — TTS/STT 优化 Phase 0-2 方案落地
- 提交 bun.lock 文件并修复 workflow 中 lockfile 引用路径

#### V0.4.6 (2026-06-24) （git 历史补录）

> 实质提交 **6** 条：fix 3 · feat 1 · chore 1 · style 1

- 实现多 Agent 编排系统、AI 提问渲染修复及 Prettier 格式修正
- 将 console 调用迁移至 Logger，修复 CI Console usage gate 超标问题
- 修复 AI 提问面板选项显示异常及会话上下文断裂问题，扩展多 Agent 编排事件系统
- 修复 Tauri 编译错误及添加 question block 调试工具
- 移除 .trae/rules/project_rules.md
- 修复 SwarmCoordinator.ts Prettier 格式问题（多行字符串折叠为单行）

#### v0.4.5 (2026-06-23) （git 历史补录）

> 实质提交 **5** 条：fix 3 · feat 1 · style 1

- 新增安全审计日志系统与操作回滚模块
- 修复 AI 提问面板不显示、增加危险操作警示音与任务完成提示音
- PermissionPolicies.ts platform 变量使用 UnifiedRulePlatform 类型
- 修复删除规则 TC03 缺口、cmd 平台支持及循环依赖问题
- Prettier 格式化修复 PermissionPolicies.ts 第 10 行 import 换行

#### v0.4.4 (2026-06-23) （git 历史补录）

> 实质提交 **4** 条：fix 3 · feat 1

- 实现 Agent Council 理事会功能 + 专家角色数据库持久化管理
- 修复会话标题自动生成缺失及跨轮对话失忆问题
- 统一中文文件名处理逻辑，复用 fileNaming.ts 共享工具函数
- 修复 route-table.ts 中 ctx→handlerCtx 命名错误及 CouncilTypes.ts 缺少 agentId/agentName 字段

#### v0.4.3 (2026-06-23) （git 历史补录）

> 实质提交 **12** 条：fix 4 · chore 3 · feat 2 · style 2 · ci 1

- 工具执行块头部摘要"说人话"及间距优化
- 将工作空间切换从侧栏迁移至 Header 右上角
- 修复首次安装后后端启动失败(Windows error 267) + 移除本地注册登录
- 修复 BootPipelineIntegrator 编译错误，ESLint 格式化
- 已完成工具执行块在页面加载时应自动折叠
- 移除工具参数的 Unicode 清理，防止 NFKC 归一化破坏全角文件路径
- …（另有 6 条实质提交，详见 `git log v0.4.2..v0.4.3`）

#### v0.4.2 (2026-06-21) （git 历史补录）

> 实质提交 **84** 条：fix 52 · feat 14 · refactor 8 · other 4 · chore 2 · style 2 · docs 1 · ci 1

- 实现工作模块完整骨架（Phase 0 + Phase 1-A/B/C）
- 会话来源标签 + 欢迎页开始聊天按钮
- 方案C结构化进度管道 — ProgressEvent 类型定义 + ChatManager 8处进度注入 + channel-handlers onProgress 消费
- 新增 StatusFloatingBar 组件并修复 CI YAML 语法及多项细节
- 实现状态机引擎并完成全量迁移（阶段 1-5）
- 完成 Logger 迁移和 ESLint 治理 Phase 3 — console 门禁 + no-unused-vars 清零
- …（另有 78 条实质提交，详见 `git log v0.4.1..v0.4.2`）

#### v0.4.1 (2026-06-15) （git 历史补录）

> 实质提交 **1** 条：fix 1

- Provider fetch 层添加连接自动重试，提升网络瞬断稳定性

#### v0.4.0 (2026-06-15) （git 历史补录）

> 实质提交 **11** 条：fix 7 · refactor 2 · feat 1 · perf 1

- MarkdownRenderer react-markdown 重构 + 版本升级 0.4.0
- 恢复手写 MarkdownRenderer，移除 V2 版本
- 修复 310 个预存 TS 错误并优化对话响应性能
- 添加自定义模型时增加供应商选择下拉框
- EmbeddingManager 对接 ModelRouter 读取用户配置，不再硬编码 openai
- EmbeddingManager 无 OpenAI Key 时自动降级为本地提供者
- …（另有 5 条实质提交，详见 `git log v0.3.1..v0.4.0`）

#### v0.3.1 (2026-06-14) （git 历史补录）

> 实质提交 **1** 条：bump 1

- 版本升级至 v0.3.1 + 修复细节

#### v0.3.0 (2026-06-14) （git 历史补录）

> 实质提交 **27** 条：fix 9 · feat 8 · refactor 8 · docs 1 · bump 1

- 模型全链路排查整改 + FileRegistry 增强 + 前端文件管理重构
- 知识库升级 — Domain-First 架构 + many-to-many 编译 + 轻量搜索
- FileRegistry 文件注册中心 — 全模块文件入站统一注册与 MD5 去重（WebFetch/媒体生成/FileWrite/会话制品/知识编译/附件/上传 全覆盖）
- 非流式交互支持 + 工具调用参数显示优化 + AskUserQuestionTool 修复
- 工作空间信任机制完整实现 — P1基础能力+P2前端UI+P3权限分级
- 全量提交 - AI工作流文件管理系统升级
- …（另有 21 条实质提交，详见 `git log v0.2.0..v0.3.0`）

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

#### v0.1.1 (2026-05-28) （git 历史补录）

> 实质提交 **21** 条：fix 8 · refactor 5 · feat 4 · chore 2 · ci 2

- 会话整合方案B实施 + 模块系统注册 + 新功能模块落地
- macOS 独立二进制打包支持
- Docker 多阶段编译打包 + Windows 独立 exe 编译 + 架构修复
- 通道系统全面重构与基础设施升级
- 锁定 @tauri-apps/api 版本至 2.10.x 并提交 bun.lock
- 修复 GitHub Actions 多平台构建的路径和依赖问题
- …（另有 15 条实质提交，详见 `git log v0.1..v0.1.1`）

#### v0.1.0 (2026-05-30) （git 历史补录）

> 实质提交 **13** 条：fix 5 · feat 4 · ci 2 · refactor 1 · style 1

- 模块集成与预存错误修复
- MCP 市场/Skill 市场/语音服务全功能集成 + source 字段统一为 builtin/third_party
- 用户数据目录可配置及数据迁移功能
- 为所有源代码文件添加 MIT 开源协议头
- 补齐 UI 组件 & 修复语音模块类型错误
- 修复 SettingsPage httpClient 导入错误
- …（另有 7 条实质提交，详见 `git log v0.1.1..v0.1.0`）

#### v0.1 (2026-05-25) （git 历史补录）

> 实质提交 **100** 条：feat 39 · fix 19 · refactor 18 · other 9 · docs 7 · chore 6 · style 1 · update 1

- Ink REPL 图标优化 + 通道消息防重复 + Logger 路径改进
- 通道模块化重构 — 新增 accounts/config-schema/doctor/monitor/probe/runtime 子模块体系 + streaming-message 流式消息支持
- 入站消息接收架构 + 通道配置体系 + QQ Bot Access Token 鉴权升级
- 知识库模块化升级—桶导出+混合搜索+AI写删工具
- 大规模架构重构 — SessionGateway 集成、ChatManager 会话管理层重构、Task 系统模块重组
- 实现 gaps.md 全部 12 项差距分析改进
- …（另有 94 条实质提交，详见 `git log v0.1`）
