# WorkflowEngine Seam 收敛 Spec

> 版本: 1.0 | 创建: 2026-09-13 | 状态: **首版已完成（2026-09-13）**
> 关联: GR15（Spec-Driven Development）/ 对标报告 `dev_docs/20260913/工作流横向对标分析报告.md`（P1-1 + V-2 + P2-4）/ R01 / R02 / R03 / R06-005 / R06-006 / R06-007 / R06-008 / R06-010 / R06-011 / CS01 / CS05
> 前置输入: `dev_docs/20260913/工作流横向对标_不足与路线图.md`（阶段二）

## 1. Problem Statement

1. **无统一 seam**：本仓"工作流"是五类互不相通的局部实现（`DocOrchestrator` 编排型 / `DocWorkflow` 流水线型 / `workflow-template-handlers` 模板型 / `ApprovalWorkflow` 治理型；原 `LocalWorkflowTask` 已随阶段一删除）。全 `app/src` 检索 `workflowEngine|WorkflowEngine|workflowRegistry|registerWorkflow|IWorkflow|WorkflowService` → **No matches**，`DocOrchestrator` 的能力无法被非 doc 场景复用。
2. **失败语义无契约**：`DocOrchestrator.execute()` 返回 `{ success, completedSteps, output?, error? }`（`DocOrchestrator.ts#L16-L21`），无封闭停止原因、无"致命错误不得降级"约束；同名 `WorkflowResult` 在本仓另有定义（workspace 域），存在 R02 重复类型风险。
3. **V-2 零消费**：`TaskDependencyService` 已实现 `getTopologicalOrder()`（DFS + 环检测）、`hasCycle()`、`areDependenciesMet()`、`getReadyTasks()`，但全仓仅"定义 + index re-export"（`TaskDependencyService.ts#L40-L107`）。而 `dependsOn` 分散在 `EnhancedCronTask`、`TaskOrchestrator.PlanStep`、`workspace/TaskStore`、`TaskDecomposer` 四处，形成"多处声明、无人统一消费"。
4. **模板与执行器无绑定**：`workflow-template-handlers.ts` 的 4 个内建模板与任何执行器之间无代码路径。

## 2. Goals / Non-Goals

### 2.1 Goals

| Goal | 说明 | Priority |
|---|---|---|
| G1 | 建立唯一 `WorkflowEngine` seam，经 DI 容器暴露 | Must |
| G2 | 定义封闭失败契约（`WorkflowStopReason` + fatal 不消融） | Must |
| G3 | `DocOrchestrator` 迁移为 seam 的 Provider，行为不变 | Must |
| G4 | V-2：依赖调度接入 seam（**复用** `TaskDependencyService`，禁止另写拓扑排序） | Must |
| G5 | 保留既有"不假成功"纪律（D-1）并升级为 seam 级约束 | Must |
| G6 | 消除同名 `WorkflowResult` 歧义（命名避冲突） | Should |

### 2.2 Non-Goals（明确不做）

- ❌ **不做执行隔离**（worker_thread / 子进程）→ 阶段四 P2-2。
- ❌ **不做 run 记录持久化**（P1-3，另批）。
- ❌ **不做 cancel/dispose 生命周期**（P1-4，另批；本 spec 的契约预留 `cancelled` 停止原因但不实现取消 API）。
- ❌ **不迁移 `DocWorkflow`**（流水线型，纯函数 + 进度发射器，随 P2-3 并发改造一并迁移）。
- ❌ **不做并发调度**（P2-3）。
- ❌ 不实现 `workflow-template-handlers` 与执行器的绑定（P2-1）。

## 3. 决策记录（2026-09-13 用户确认）

| ID | 决策 | 理由 |
|---|---|---|
| D1 | **Seam 落在新建模块 `app/src/modules/workflow/`**，在 `ModuleDefinitions.ts` 注册，实例经 DI 暴露 | 边界清晰，符合 R06-007/R06-008；避免把 seam 藏在 doc 模块内导致反向依赖 |
| D2 | **seam 首版即含失败契约**（停用 `success: boolean` 语义，改为封闭 `WorkflowStopReason` + `fatal` 不消融），即把 P2-4 提前并入 P1-1 | 避免 seam 落地后再做破坏性契约变更 |
| D3 | **V-2 接入**：`TaskDependencyService` 作为 seam 的依赖调度实现（复用 `getTopologicalOrder` + `hasCycle`），并由 seam 提供静态校验补足其缺口（缺失引用/非法引用） | CS01 归一化：禁止新写拓扑排序；同时消除 V-2 零消费 |
| D4 | **Provider 范围**：首版只迁移 `DocOrchestrator` | 形态最接近"多步骤 + 跨模块"；`DocWorkflow` 延后到 P2-3 |
| D5 | **命名避冲突**：seam 类型名不复用 `WorkflowStep` / `WorkflowResult`（后者已在 workspace 域存在），改用 `WorkflowStepSpec` / `WorkflowRunResult` | R02（数据模型统一，禁止重复定义同名类型） |
| D6 | **无循环依赖**：`workflow` 模块不依赖 `doc`；由 `doc` 模块在 `setupOrchestrator()` 时向 seam **注册** Provider（控制反转） | 避免 `doc → workflow → doc` 环 |

## 4. 契约定义

### 4.1 类型（`modules/workflow/types.ts`）

```ts
/** 运行停止原因：封闭联合，engine 所有，消费方可穷举 */
export type WorkflowStopReason = 'completed' | 'cancelled' | 'error'

/** 一步的定义（声明式，可含依赖） */
export interface WorkflowStepSpec {
  id: string
  description: string
  tool: string
  params?: Record<string, unknown>
  dependsOn?: string[]
}

/** 一个工作流的定义 */
export interface WorkflowDefinition {
  name: string
  description: string
  steps: WorkflowStepSpec[]
}

/** 运行结果：value 仅在 completed 时有意义；非 completed 必须携带 error */
export interface WorkflowRunResult {
  stopReason: WorkflowStopReason
  completedSteps: string[]
  value?: unknown
  error?: string
}
```

### 4.2 错误（`WorkflowError`）

- 继承 `@modules/error` 的 `AppError`（project_rules §1.9：唯一错误入口）。
- 字段 `fatal: boolean`（默认 `true`）：**致命错误必须向上抛，禁止被降级为空结果**。
- 语义边界（对齐 deepseek-harness `WorkflowError`）：
  - `fatal = true`：定义非法（未知工作流/步骤 id 重复/依赖成环或缺失/参数非法/未注册 Provider）→ **抛错**。
  - `fatal = false`：**步骤执行失败**（工具返回 failure 或抛错）→ 归入 `WorkflowRunResult.stopReason = 'error'`，不抛。

### 4.3 引擎（`modules/workflow/WorkflowEngine.ts`）

```ts
export interface WorkflowProvider {
  readonly providerId: string
  listWorkflows(): WorkflowDefinition[]
  execute(definition: WorkflowDefinition, params: Record<string, unknown>): Promise<WorkflowRunResult>
}

export class WorkflowEngine {
  registerProvider(provider: WorkflowProvider): void      // 重复注册 → throw WorkflowError(fatal)
  unregisterProvider(providerId: string): void
  listWorkflows(): WorkflowSummary[]                       // 跨 Provider 汇总
  getDefinition(workflowName: string): WorkflowDefinition | undefined
  validate(definition: WorkflowDefinition): void           // 依赖静态校验（见 4.4）
  execute(workflowName: string, params): Promise<WorkflowRunResult>
}
```

### 4.4 依赖调度（V-2 接入）

- **复用** `TaskDependencyService`：`register()` + `getTopologicalOrder()` + `hasCycle()`（其拓扑与环检测不依赖 TaskRegistry，可直接复用）。
- seam 补足其**静态校验缺口**（TaskDependencyService 不检查引用是否存在）：步骤 id 唯一性、`dependsOn` 引用必须存在、非法引用拒绝。
- **禁止**在 seam 内新写拓扑排序或环检测（CS01）。
- 执行顺序：按拓扑序执行；无依赖声明时保持原顺序（不改变 `DocOrchestrator` 现有行为）。

## 5. Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-1.1 | 系统 SHALL 提供唯一 `WorkflowEngine` 实例，经 DI 容器以稳定名称 `workflowEngine` 解析 | Must |
| FR-1.2 | `workflow` 模块 SHALL 在 `ModuleDefinitions.ts` 注册，`dependencies` 不含 `doc` | Must |
| FR-1.3 | 引擎 SHALL 支持多 Provider 注册与按工作流名汇总 | Must |
| FR-1.4 | 重复注册同一 `providerId` SHALL 抛 `WorkflowError(fatal)` | Must |
| FR-2.1 | 未知工作流名 SHALL 返回 `stopReason='error'` 且 `error` 非空（不抛，兼容既有工具语义） | Must |
| FR-2.2 | 未注册任何 Provider 时执行 SHALL 返回 `stopReason='error'` + 明确错误文案（不假成功） | Must |
| FR-3.1 | 定义校验失败（依赖成环 / 依赖缺失 / 步骤 id 重复）SHALL 抛 `WorkflowError(fatal=true)` | Must |
| FR-3.2 | 依赖排序 SHALL 复用 `TaskDependencyService`，不得新写拓扑排序 | Must |
| FR-4.1 | `DocOrchestrator` SHALL 迁移为 Provider，**3 个内建流程行为不变**（含 doc:create-docx → mail:send 附件注入） | Must |
| FR-4.2 | 步骤失败 SHALL 终止后续步骤，`completedSteps` 记录已完成项，`error` 携带原因 | Must |
| FR-5.1 | `office:workflow` 工具 SHALL 经 seam 执行，对外返回结构不变 | Must |
| FR-5.2 | 现有 `DocOrchestrator.execute()` SHALL 保留（Provider 内部委托），避免一次性大改 | Should |
| FR-6.1 | 新增/变更类型 SHALL NOT 复用 `WorkflowStep` / `WorkflowResult` 名称 | Must |
| FR-7.1 | 新增文件 SHALL 添加 MIT 协议头（project_rules §1.2 建议项） | Should |

## 6. Provider 划分与迁移范围

| Provider | 承载 | 首版 | 说明 |
|---|---|:--:|---|
| `doc-orchestrator` | `DocOrchestrator` 的 3 个内建流程（`send-report` / `reply-with-doc` / `meeting-to-all`） | ✅ | 由 `DocModule.setupOrchestrator()` 注册进引擎；`toolExecutor` 仍由 DocModule 注入 |
| `doc-workflow` | `DocWorkflow` 三阶段流水线 | ❌ 延后 | 随 P2-3 迁移 |

## 7. 实施步骤

### Phase 1 — Spec 与契约 ✅
- [x] 本 spec 落盘
- [x] `modules/workflow/types.ts`：契约类型（`WorkflowStopReason` / `WorkflowStepSpec` / `WorkflowDefinition` / `WorkflowRunResult` / `WorkflowSummary`）

### Phase 2 — 引擎与依赖调度 ✅
- [x] `modules/workflow/WorkflowEngine.ts`：Provider 注册/汇总/执行 + 依赖静态校验 + 拓扑排序（复用 `TaskDependencyService`）
- [x] `modules/workflow/WorkflowError.ts`：`fatal` 语义错误类（继承 `AppError`）+ `isFatalWorkflowError`

### Phase 3 — Provider 与接线 ✅
- [x] `modules/doc/orchestration/DocOrchestratorProvider.ts`（**位置修正**：按 D6 分层，Provider 必须落在 doc 侧，否则 `workflow` 模块会反向依赖 `doc`）
- [x] `modules/workflow/WorkflowModule.ts` + `index.ts`
- [x] `ModuleDefinitions.ts` 注册 `workflow` 模块（`dependencies: ['core','tasks']`）+ `doc` 依赖补 `workflow`
- [x] `app/tsconfig.json`：新增 `@modules/workflow` / `@modules/workflow/*` 别名（**paths 为显式白名单，新增模块必须登记，否则 TS2307**）
- [x] `ModuleInitializer.ts`：`_registerWorkflowEngine()`（对齐 `_registerCombinedGateway` 先例；挂载点为 `tasks` 模块初始化后置钩子）
- [x] `DocModule.setupOrchestrator()`：向引擎注册 Provider；`office:workflow` 工具改经 seam

### Phase 4 — 验证与文档 ✅
- [x] `bun run typecheck` → exit 0
- [x] 定向测试 `src/modules/__tests__/WorkflowEngine.test.ts` → **11 pass / 0 fail**（重复 id / 依赖缺失 / 成环 / 重复 Provider 均抛 fatal；拓扑序被真实消费；未注册 Provider 与未知工作流返回 error 不假成功）
- [x] 定向 ESLint（新增 + 改动文件）→ 0 error
- [x] 本文档状态更新

### 实施记录（2026-09-13）

| 项 | 事实 |
|---|---|
| 模块别名 | `app/tsconfig.json` 的 `paths` 是**显式白名单**（非通配），新增模块必须同时登记 `@modules/<name>` 与 `@modules/<name>/*`；首次 typecheck 报 TS2307 即此因 |
| DI 挂载点 | `ModuleInitializer.initializeModule()` 的**模块初始化后置钩子**（`session`→`_registerCombinedGateway`、`tasks`→`_registerWorkflowEngine`），非新增独立启动阶段 |
| 单例来源 | 消费方走 `getWorkflowEngine()`；DI 注册（`resolve('workflowEngine')`）供外部按名解析，两者指向同一单例，无初始化顺序耦合 |
| 行为保持 | Provider **委托**既有 `DocOrchestrator.execute()`（未重写执行逻辑）；`completedSteps` 仍为工具名；`office:workflow` 对外结构不变（`stopReason==='completed'` → `SUCCESS`） |
| 反模式防护 | Provider 对含 `dependsOn` 的定义**显式抛错拒绝**，而非静默忽略——避免重演本次对标发现的"声明了但忽略"反模式 |
| 未覆盖 | `TaskDependencyService` 的 `areDependenciesMet()`/`getReadyTasks()`（依赖 TaskRegistry 状态）**未被复用**，因 step 就绪判定需按 `completedSteps` 而非 task 表；本次仅复用其纯图算法 |

## 8. 验证方案

| 验证项 | 方法 | 通过标准 |
|---|---|---|
| 类型与构建 | `bun run typecheck` | exit 0 |
| 依赖成环 | 单测构造 A→B→A | 抛 `WorkflowError(fatal=true)` |
| 依赖缺失 | 单测 `dependsOn: ['nope']` | 抛 fatal |
| 步骤 id 重复 | 单测同 id 两步 | 抛 fatal |
| 未知工作流 | 引擎 `execute('nope')` | `stopReason='error'`，`error` 非空 |
| 未注册 Provider | 新引擎实例 `execute(x)` | `stopReason='error'`，文案指明未注册 |
| 拓扑顺序 | 单测 C 依赖 B、B 依赖 A | 执行序 A→B→C |
| 既有行为回归 | `DocOrchestrator` 3 流程经 Provider 执行 | `stopReason='completed'`，`completedSteps` 与迁移前一致 |

## 9. 合规检查清单

| 规则 | 检查点 | 状态 |
|---|---|---|
| GR15 Spec-Driven | 本 spec 先于实现创建 | ✅ |
| R01 基础设施复用 | 错误用 `AppError`；日志用 `@modules/monitoring`；**依赖调度复用 `TaskDependencyService`** | ✅ |
| R02 数据模型统一 | 不复用 `WorkflowStep`/`WorkflowResult` 名；无重复类型定义 | ✅ |
| R03 模块边界 | `workflow` 模块不依赖 `doc`；doc 反向注册 Provider | ✅ |
| R04-001 文件行数 | 单文件 ≤ 1000 行 | ✅ |
| R06-005 命名规范 | 无 `utils/helpers` 垃圾桶命名 | ✅ |
| R06-006 职责单一 | 引擎/错误/Provider/模块入口各司其职，无薄转发僵尸方法 | ✅ |
| R06-007 目录结构 | 遵循 `modules/<name>/` 结构 | ✅ |
| R06-008 分层 | 不反向依赖；不跨层直调 | ✅ |
| R06-010 模块公共 API | 外部只经 `modules/workflow/index.ts` 导入 | ✅ |
| R06-011 模块依赖规则 | `ModuleDefinitions` 声明 `dependencies` / `optionalDependencies` | ✅ |
| CS01 归一化 | 拓扑排序/环检测复用既有实现，未新写 | ✅ |
| CS03 回退最小化 | 无"以防万一"try-catch；错误分类明确 | ✅ |
| CS04 Mock 零容忍 | 无 mock/示例数据 | ✅ |
| CS05 根因优先 | 解决"无 seam"根因，而非在 doc 模块内打补丁 | ✅ |
| CS06 证据驱动 | 所有现状结论附路径#行号 | ✅ |

## 10. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 改动 `ModuleDefinitions` / `ModuleInitializer` 影响启动 | 注册逻辑对齐既有 `_registerCombinedGateway` 先例；失败按非致命处理并记日志（与先例一致） |
| `DocOrchestrator` 行为漂移 | Provider 内部**委托**既有 `execute()`，不重写执行逻辑；保留原方法 |
| 循环依赖（doc ↔ workflow） | D6：workflow 不依赖 doc，由 doc 注册 Provider |
| `TaskDependencyService` 语义被误用（其 `areDependenciesMet` 依赖 TaskRegistry） | 仅复用其**不依赖 registry** 的 `getTopologicalOrder()` / `hasCycle()`；就绪判定由 workflow 自身在运行时按 `completedSteps` 判定 |

**回滚**：删除 `modules/workflow/` 目录 + 撤销 `ModuleDefinitions` / `ModuleInitializer` / `DocModule` 三处接线（`office:workflow` 工具恢复直调 `DocOrchestrator.execute()`）。
