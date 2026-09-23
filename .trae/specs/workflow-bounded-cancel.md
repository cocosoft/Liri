# 工作流有界取消（宽限期强结算）Spec — P2-2 可交付部分

> 版本: 1.0 | 创建: 2026-09-13 | 状态: **首版已完成（2026-09-13）**
> 关联: GR15 / CS03（回退最小化）/ PY_APP §2（不做投机性扩展）
> 前置：`.trae/specs/workflow-run-lifecycle.md`（P1-4 取消贯通）/ 路线图阶段四第 15 项（可行性修正）

## 1. 背景与问题

P2-2 原计划"一 run 一 worker 隔离 + 宽限期强结算"，**取证后前半不成立**（详见路线图阶段四第 15 项）：`WorkerSandbox` 是命令执行器（`execute({args}) → {exitCode,stdout,stderr}`），而本仓工作流步骤是**进程内工具调用**（依赖 DB/MCP/会话句柄，无法序列化进 worker）。

**仍然成立的问题**：`WorkflowEngine.execute()` 在 signal 中止后仍 `await` 正在执行的步骤 → **取消延迟无界**。长步骤（大文档生成/生图）会让工具循环长时间挂住，用户中止后长时间不结算。

## 2. 决策

| ID | 决策 | 理由 |
|---|---|---|
| D1 | 在 `execute()` 内实现**有界结算**：signal 中止 → 起宽限计时（默认 5000ms，`gracePeriodMs` 可覆盖，`0`=立即）→ 到期强制结算 `cancelled` | 对齐 deepseek 的"宽限期强结算"语义，但**不引入线程**（前提不成立） |
| D2 | **不引入 run handle / `dispose()`** | 无线程即无资源可释放；无消费者的 API 会成为死代码（PY_APP §2） |
| D3 | 被放弃的 provider promise **必须挂 `catch`** 并记日志 | 否则其最终失败会成为 unhandled rejection（不可掩埋） |
| D4 | 结算文案明确"步骤将在后台跑完、其结果被丢弃" | 不假装已中断；如实告知调用方（CS02 语义一致） |
| D5 | 宽限期到期时 `completedSteps` 为空 | 无法确知在跑步骤是否完成，**不臆造**已完成列表 |

## 3. 影响文件

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/modules/workflow/types.ts` | `WorkflowExecuteOptions` 新增 `gracePeriodMs?` |
| 2 | `app/src/modules/workflow/WorkflowEngine.ts` | 类静态默认值 + `raceWithCancelGrace()` + `execute()` 接入 |

## 4. 验证方案

| 项 | 通过标准 |
|---|---|
| 中止后 provider 挂起 | 宽限 20ms → 返回 `cancelled`，**总耗时远小于 provider 的悬挂时长**（有界）；observer 收到成对 start/end |
| 宽限内正常返回 | provider 在宽限内结算 → 正常结果，**不误判** cancelled |
| `gracePeriodMs = 0` | 中止即结算 |
| 未传 signal | 行为不变（与 P1-1/P1-4 一致） |
| 被放弃 promise 后续 reject | **不产生 unhandled rejection**（bun test 会把 unhandled rejection 报为失败 → 天然断言） |
| 回归 | 既有全部单测 + 运行时集成测试绿；`typecheck`/`lint:arch` 0 |

## 5. 合规检查清单

| 规则 | 检查点 |
|---|---|
| CS03 回退最小化 | 唯一新增分支是"取消宽限到期"，有明确真实场景；无兜底 try-catch |
| CS04 Mock 零容忍 | 无假数据（测试用真实引擎） |
| CS06 证据驱动 | 可行性结论附 `WorkerSandbox.ts` 行号 |
| R06-008 分层 | 写权/生命周期仍归 seam，未新增跨层依赖 |

## 6. 实施结果（2026-09-13 已完成）

| 文件 | 改动 |
|---|---|
| `modules/workflow/types.ts` | `WorkflowExecuteOptions` 新增 `gracePeriodMs?`（含语义与默认值说明） |
| `modules/workflow/WorkflowEngine.ts` | 新增类静态 `DEFAULT_CANCEL_GRACE_MS = 5000`；`execute()` 接入 `raceWithCancelGrace()`；被放弃的 provider promise 挂 `catch` + 记日志；宽限到期分支强制结算 `cancelled`（`completedSteps: []`、文案写明步骤将在后台跑完）；新增私有 `raceWithCancelGrace()`（`settled` 守卫 + `cleanup()` 摘监听/清计时器，无泄漏） |
| `modules/__tests__/WorkflowRunObserver.test.ts` | 新增 4 个用例：① 有界性（provider 永不结算 + 中止 → 20ms 宽限后返回 `cancelled`，耗时 <1000ms）；② 不误判（provider 在宽限内返回 → `completed`）；③ `gracePeriodMs=0` 中止即结算；④ 被放弃 promise 后续 throw → 不产生 unhandled rejection、不抛给调用方 |

**验证**：`bun run typecheck` exit 0；**147 单测 0 fail**（14 文件 452 断言）；定向 ESLint 0；`scripts/lint-architecture.ts` 0 错误 / 0 警告。

**未做（明确）**：`dispose()`；真线程隔离（前提不成立，见 §1）；in-flight 步骤的**执行本身**仍不可中断（仅调用方不再等待）。
