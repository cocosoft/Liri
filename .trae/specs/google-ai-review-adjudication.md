# Spec：Google AI 外部建议逐条裁定 + core/infra 职责契约（项目裁决依据）

> 版本 1.0 ｜ 创建 2026-10-25 ｜ 状态：🟢 **裁定已定案（施工项另行各立 spec）**
> 来源：`dev_docs/20261009/google ai 建议.md`（全 7 段主张）· 核实基线 `dev_docs/20261024/基础设施专项-现状与规划.md v1.2`（2026-10-25）
> 层归属唯一事实源：`scripts/modules-to-layers.json`；规则口径见 [`architecture-compliance.md`](../rules/architecture-compliance.md)（R06-008）· [`project_rules.md`](../rules/project_rules.md) §1.5
> 关联 spec：`bash-security-9th-review-hardening.md`（同源第九轮审查落地）· `tool-sidecar-isolation.md`（侧车三靶点）· `layer-inversion-*.md`（层倒挂清零）
>
> **本 spec 是裁决依据，不是施工单**：采纳项由各自 spec / 台账驱动；未采纳项给出量化或机制性理由，防止后续外部建议稿照抄再提。

---

## 1. 裁定总则（口径）

| 裁定 | 含义 | 触发 |
|---|---|---|
| ✅ 已实现 | 有代码 + 有测试，主张所指缺口已不存在（含「纠正原主张」） | — |
| 🟡 部分 | 有其一无其二，或实现形态与主张不同 | headless / 多租户 / 内核发布等具象触发 |
| ⏸ 延期 | 方向认可但非本轮；收益无法量化或依赖外部触发 | 各自触发条件 |
| ❌ 不采纳 | 主张与本仓事实不符（目录/机制不存在），或收益/成本不成立，或违背既有裁定 | — |

**两处结构性事实（先纠正，防照抄）**：① 外部建议稿按 `infra/storage` / `infra/accounting` / `infra/sandbox`
给方案，**三个目录在本仓均不存在**（存储连接单点是内核 `external/sqlite3.ts`；预算是 **app 层**
`query/DailyBudgetManager.ts`；沙箱属 **app 层**）；② `ChatManagerImpl._currentSessionId` 主张「类内单例
串线」**已过时**——现为按 `getRequestPrincipalKey()` 分键的 Map；`PermissionManager.currentUserRole`
进程级属性仍在但**请求级优先**（context.userRole），残余面仅未染色回退。

---

## 2. Google 建议逐条裁定

### 2.1 核心通信模型（建议稿第一段）

| # | 主张 | 裁定 | 依据 |
|---|---|---|---|
| G1 | A2A / MCP **进程级联邦网关守护进程**（Sidecar）核心通信模型 | ⏸ 延期 | 隔离形态已先行（侧车三靶点，`tool-sidecar-isolation.md §13`）；联邦网关是 headless/多节点部署触发项，本仓单机架构无此面 |
| G2 | **Code-as-Tool**：高频交互压缩为本地单轮批处理运行时内核 | ⏸ 延期 | 方向认可（降模型 I/O 轮次），但 = 公开契约级新工具面，收益需真实多步任务数据；与「81 工具单步循环」并存，不在本轮 |

### 2.2 三大漏洞诊断 + 重构建议（§一 / §二）

| # | 主张 | 裁定 | 依据 |
|---|---|---|---|
| G3 | 长任务自唤醒**单点内存挂起** ⇒ 脱水/再水化（Hydration/Dehydration）状态机 | 🟡 部分 | 长任务已托管 `ProcessRegistry`（S7 实测）；「重启后重建协程现场」确属缺口，但 **ContextPersistence 已取证为进程级快照语义**（台账），是架构难点非机械改造，待方案轮 |
| G4 | Token 预算并发 **TOCTOU** ⇒ 原子令牌桶预扣（Token Pre-allocation） | 🟡 部分 | 预算在 app 层（`query/DailyBudgetManager.ts`）、非内核捆绑 ⇒ 风险面比主张小；内核级预扣 = P2 `IBudgetLedgerPort`（无状态 DTO），**触发**：内核要独立做 USD 预扣时（`基础设施专项 v1.2 §8-P2#12`） |
| G5 | OTel 语义双写 GC 背压 ⇒ **Rust 环形零拷贝缓冲** | ❌ 不采纳 | 主事件循环延迟漂移**缺实测证据**；Rust FFI 面收益/成本不成立——参照 P3 `liri-native` 侧车结案判据（U-25：计数原生 2.04ms vs JS 0.24ms），同等成本判据下不引入新原生面 |

### 2.3 AST 编译期语义审计（§五 建议一/二/三）

| # | 主张 | 裁定 | 依据 |
|---|---|---|---|
| G6 | **建议一**：PathGuard 静态匹配下沉为 **Rust SWC** 代码生成意图穿透拦截器 | ❌ 不采纳（当前层） | 本仓已有 **native bash 解析器 + TS 降级双轨**（`security/bash/BashAST.ts`，`bash-security-9th-review-hardening.md` 缺陷 #1–#5 已修：哨兵三态、`||` 分割、不失败关闭）；SWC 全面重做收益不量化、非缺陷级 |
| G7 | **建议二**：**AST 依赖图**架构隔离看门狗（lint-architecture 强约束） | ✅ 已实现 | 既有 `lint:arch`（`modules-to-layers.json` + `allowedDependencies` 依赖图断言）已硬拦层倒挂；**已知盲区** R00-003（动态导入看不见）单列并强化（`code-deletion.md` CD01/CD02） |
| G8 | **建议三**：**语法觉知（Syntax-Aware）有损内存回收**（作用域块闭环裁剪） | ⏸ 延期 | 非缺陷级（结构性幻觉属长尾）；compaction 台账已知；与 G15 合并为一个待办（v0.6.0 演进） |

### 2.4 Runtime 拆分核查（§四）—— 采纳其判定

| # | 主张 | 裁定 | 依据 |
|---|---|---|---|
| G9 | Planner / Executor / Checkpoint / Tool **四窄运行时已解耦** | ✅ 已确认 | 物理落点逐一对上：`PlanDrivenLoop`+`LongRunningTaskOrchestrator` / `TAORLoop`+`SubAgentEngine` / `SessionCheckpointService`+`StreamingAutoCheckpoint`+`WorkspaceSnapshot` / `ToolRegistry`+`SandboxImpl`；C3-S3 切流（1290→816）与 56 条警告清零已达成 |
| G10 | 后续建议 ①：Tool/Sandbox Runtime 重构为**常驻单向进程 Sidecar**；② 流式消费循环 **SQLite WAL 高并发自愈用例** | ① ✅ 已实现（侧车三靶点形态）② ⏸ 延期 | ① 见 `tool-sidecar-isolation.md §13`（P2 媒体 / P1 LSP 常驻侧车 / P3 native 不侧车化结案）；② WAL 单点已统一（内核 `external/sqlite3.ts`），并发自愈用例随隔离形态走 |

### 2.5 Context 审计（§六）

| # | 主张 | 裁定 | 依据 |
|---|---|---|---|
| G11 | 三护栏（streamConsumption 迁出 / 写前持久化 / DB 单一驱动）为低风险 | ✅ 已确认 | 与 §4「已完成治理」逐项对上；`modules/compaction` 分层切窗 + 后台异步压缩存在 |
| G12 | 盲区：Tier3 压缩摘要**缺 Zod 出参 Schema** ⇒ 脏上下文回灌 | 🟡 部分 | 入参自纠已落地（`ToolInputSelfCorrector` + 3 次上限看门狗）；**出参强 Schema**（`handleContextCompactionReflectionLoop`）记待办（P2 级，反射循环形态） |
| G13 | **AI-VFS 化**：SessionContext 映射为 `channel://…` URI + `read_vfs` 系统调用 | ⏸ 延期 | v0.6.0 演进方向（首轮提示词体积收益需原型验证）；本仓已有 VFS 内核（`core/storage/vfs/VfsKernel`），改造面是「上下文边界收口」，非本轮 |

### 2.6 Tool 链审计（§七）

| # | 主张 | 裁定 | 依据 |
|---|---|---|---|
| G14 | 风险 1：**出参裸奔**（无 Schema 校验即回灌） | 🟡 部分 | 入参 ✅（`ToolInputSelfCorrector`）；出参 `BaseTool.outputSchema` + `handleOutputReflectionLoop` 记待办（与 G12 同形态，P2 级） |
| G15 | 风险 2：静态 PathGuard 正则 vs **动态编码混淆**（Base64/零宽字符穿透） | 🟡 部分 | PathGuard 五层防护存在（725 条危险命令等）；TS 静态正则穿透面已知——**已由「AST 不确定 ⇒ 不静默放行」兜底**（第九轮 #4 修复：`too-complex`/`parse-unavailable` 转审批）+ 底层 Landlock 物理熔断；Rust SWC 全量重做不采纳（见 G6） |
| G16 | 风险 3：81 工具认知膨胀 + **单步函数调用死锁** | ⏸ 延期 | 与 G2（Code-as-Tool）同源合并；「通信轮次暴涨」需真实复合任务数据量化，不在本轮 |

### 2.7 Tool Runtime / Context Compression 深水区（§八）

| # | 主张 | 裁定 | 依据 |
|---|---|---|---|
| G17 | Landlock **单一宿主依赖**（假阳性穿透）⇒ gVisor/Wasm 二级兜底 | 🟡 部分 | `config.sandbox.permissionLevel` 有 fail-closed 回退语义；gVisor/Wasm 二级兜底 ❌ 不采纳——`基础设施专项 §9-5`「不为多租户提前改造单用户路径」，单机栈够用 |
| G18 | ProcessRegistry **孤儿进程**（僵尸蚕食） | ✅ 已实现 | 两道已落地（§6-#5）：子进程自清（`parentLiveness.ts` 2s 看门狗）+ 进程登记表对账（只清已退出、孤儿仅告警，**pid 可复用 ⇒ 强杀误杀风险按裁定不做**）；超时三态（`maxBufferChars`/`timedOut`/`error`）已订正（S5） |
| G19 | RRF 长尾**记忆蒸发**（认知退化） | 🟡 观察 | RRF `1/(k+rank)` 融合存在；「短期权重过高 ⇒ 长尾图谱蒸发」需本仓排序/记忆混合的**实测数据**支撑，记观察项（memory 域） |
| G20 | 落地 ①：沙箱 **Sidecar 微内核独立守护进程** + Timeout-Watcher 物理清子树 | ✅ 已实现（形态先行） | 侧车三靶点（P1/P2 侧车化、P3 结案）+ `sidecarRegistry` 超时看门狗 + `R21` 进程树强杀（`sandbox/**` app 层） |
| G21 | 落地 ②：**Syntax-Aware Compactor**（AST Bone-Trimming） | ⏸ 延期 | 与 G8 合并为同一待办（v0.6.0 演进） |

---

## 3. core / infra 职责契约（裁决依据，钉死边界）

### 3.1 层依赖方向（唯一事实源 `modules-to-layers.json`）

- 分层：`core`（3 模块）→ `infra`（24 模块）→ `service`（11 模块）→ `app/ui/entry`。
- 方向：任一层只依赖「自身 ＋ 更低层」；`infra → core` **允许**；`core → infra` **倒挂**（K01/K02 硬拦）。
- 层归属判定一律查 `modules-to-layers.json`，**禁止凭目录名猜**（三个命名陷阱：`app/src/infrastructure` = **service**；`app/src/sandbox` = **app**；`app/src/query` = **app**）。

### 3.2 职责铁律（Data Plane = 只实现端口，不做裁决）

**infra 只实现 SPI，禁止在内部驱动 L1/L2 认知循环，禁止越权状态裁决。**

| 能力域 | 本仓真实落点（实测） | 只做 | 禁止 |
|---|---|---|---|
| 存储实现 | 内核 `external/sqlite3.ts`（WAL/busy_timeout/temp_store 单点）+ `session/storage/**`（service）+ `state/**`（infra） | 连接、PRAGMA、迁移、FTS | 判定越权；自建第二连接点 |
| 网关通信 | `infrastructure/http/**`（service）+ `requestIdentity.ts`（Bearer → Principal → `runWithPrincipal`） | 解析 Bearer、构造 Principal、建立 ALS 作用域 | 在网关里跑业务/模型循环 |
| 进程托管 | `sandbox/**`（app，R21 进程树强杀）+ `tools/sidecar/**` + `services/mcp/**` | spawn、心跳、看门狗、取消时强杀 | 代替工具层判定权限 |
| 配置与费率 | `infra/config` · `infra/cost` · 内核 `pricing.ts`/`providerEndpoints.ts`/`ports.ts` | 静态默认值、费率计算、端点真源 | 运行期改价；把模型属性写进代码表 |

### 3.3 能力落点契约（「契约留内核、实现与装配留 infra」）

| 能力 | 契约/接口（内核） | 实现/装配（infra 侧） |
|---|---|---|
| error | `errors.ts`（AppError 基座）· `errorHandler.ts`（handleError 实现） | `app/src/error/handleError.ts` 纯转出；分类器/文案/safeLog 留 app |
| logger | `spi/LoggerService.ts`（LOGGER_SERVICE_ID + resolveLogger 延迟绑定 + 缓冲回放） | `monitoring/logs/*`；`entrypoints/spiWiring.ts:63` 注入 |
| OTel | `tracingFacade.ts` + `spi/OTelService.ts` + `events/EventBusOTelBridge.ts`（api 唯一三方依赖） | `monitoring/instrumentation.ts`（provider/exporters/env 读取） |
| paths | `paths.ts`（三层目录 + `<prefix>PROJECT_DIR/DATA_DIR/HOME`） | 无实现，仅消费方；**去产品化已完成**（宿主注入 appName/envPrefix） |

> 唯一例外：`paths` 实现也在内核 ⇒ 已完成去产品化（Q3），不再作为例外存在。

### 3.4 多租户数据面契约（2026-10-24 拍板，知识五仓 2026-10-25 收口）

- 结论 **B**：租户级 DB 文件 + 租户内 `owner_key` 行级隔离；连接维持「每 store 一句柄」（**不加池**）。
- 层边界：`resolveTenantDbPath()` 等**契约在内核**；各 store 的归属过滤是**infra/service 侧实现**；`core → infra` 依然禁止（身份贯穿走内核 `identity/requestScope` 的 ALS）。
- 不做的边界：跨租户聚合查询 · 连接池 · 旧 per-user 数据迁移。

---

## 4. 合规检查清单

| 规则 | 结论 |
|---|---|
| GR15 | ✅ 本 spec 为**决策记录**（裁定 + 契约），非实施单；采纳项各自立 spec |
| CS06 | ✅ 每条裁定的「实测」均引自 `基础设施专项 v1.2`（2026-10-25 实测基线）或本仓已提交 spec/台账；纠正两处错误主张（G 总则）有 `file:line` 支撑 |
| CD07 | ✅ 未删除任何代码；「不采纳」项不构成死面候选 |
| R06-008 | ✅ 契约表落点全部为实测层归属，无新增跨层边 |
| 命名陷阱 | ✅ 契约表显式防照抄（`infra/storage` 等三目录不存在） |

## 5. 回滚与变更

- 本 spec 是文档，无代码回滚；**裁定变更**须走本文件版本号递增（v1.x），并注明推翻旧裁定的依据。
- 采纳项施工时各自立 spec（如 `tool-sidecar-isolation.md`、`bash-security-9th-review-hardening.md`），按 CD05/CD06 独立提交。
- 待办汇总（🟡/⏸ 项，均已进入台账）：G12/G14 出参 Zod 反思回路（P2 级）· G3 ContextPersistence 快照方案 · G4 IBudgetLedgerPort（内核预扣触发）· G8/G21 Syntax-Aware Compactor（v0.6.0）· G13 AI-VFS 上下文边界（v0.6.0）· G2/G16 Code-as-Tool（需数据量化）。
