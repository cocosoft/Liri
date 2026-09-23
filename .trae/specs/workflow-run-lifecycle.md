# 工作流 Run 生命周期 Spec（P1-4）

> 版本: 1.0 | 创建: 2026-09-13 | 状态: **首版已完成（2026-09-13）**
> 关联: GR15 / R06-008（分层：取消信号由调用方提供）/ CS01 / CS03（回退最小化）/ PY_APP §2（不做投机性扩展）
> 前置：`.trae/specs/workflow-engine-seam.md`（P1-1）/ `.trae/specs/workflow-run-record.md`（P1-3）

## 1. Problem Statement

1. **无取消能力**：`WorkflowEngine.execute()` 一旦开始必须跑完；唯一中断手段是外部杀进程（P1-1 spec D6 明确 cancel/dispose 属 P1-4）。
2. **`stopReason='cancelled'` 无生产者**：P1-3 已把该值写入事件契约与派生逻辑（`assistant/workflow_run_end` 的 `cancelled` 分支），但 seam 无任何路径能产生它——**定义了却不可达**，与本仓"禁止声明了但静默忽略"的标准冲突。
3. **工具链路已有取消信号**：`ToolUseContext.abortController`（`tools/types/Tool.ts#L132`）随工具执行传入，用户中止本轮对话即 abort；`office:workflow` 工具此前未接。

## 2. 范围决策（含对路线图措辞的收窄）

| 路线图原文（阶段二第 6 项） | 本批处置 | 理由 |
|---|---|---|
| 引入 `cancel()` | ✅ 以**取消信号贯通**落地（外部 `AbortSignal` → seam → Provider → 步骤边界） | 有真实调用方（工具上下文），非空 API |
| 引入 `dispose()` | ⏸ 延后至 **P2-2（隔离）** | 无 worker/线程时**无资源可释放**；现在实现即为投机性空方法（违反 PY_APP §2） |
| 有界宽限期（宽限后强结算） | ⏸ 延后至 **P2-2** | "强制结算"的对象是 worker/子进程；无隔离时不存在可强停的执行体，宽限期无意义 |
| `result` 永不 reject | ⚠ **部分保留**：**运行期**结果不 reject（以 `stopReason` 表达失败）；**编程错误（fatal）仍抛** | 与 P1-1 已决策的 D2「致命错误不消融」一致；若改成"一律不 reject"会与 fatal 语义冲突 |

> 结论：P1-4 首版 = **取消信号贯通**（最小可用、端到端有消费者），run 句柄 / `dispose()` / 宽限期随 P2-2 隔离一并引入。

## 3. 设计

### 3.1 API 变更（`WorkflowEngine`）

```ts
/** 执行选项（第 3 参由 `observer?` 收拢为 options 包，避免位置参数继续膨胀） */
export interface WorkflowExecuteOptions {
  observer?: WorkflowRunObserver;
  /** 外部取消信号：中止后 seam 停止推进，Provider 在步骤边界返回 cancelled */
  signal?: AbortSignal;
}

execute(name: string, params: Record<string, unknown>, options?: WorkflowExecuteOptions): Promise<WorkflowRunResult>
```

### 3.2 Provider 契约扩展

```ts
execute(definition, params, signal?: AbortSignal): Promise<WorkflowRunResult>
```

### 3.3 取消语义

| 场景 | 行为 |
|---|---|
| 调用前 signal 已 abort | 不进入 Provider；返回 `{ stopReason: 'cancelled', completedSteps: [], error: '运行在开始前已被取消' }`；**仍通知** observer start/end（保持 run 记录配对） |
| 执行中 abort | Provider 在**步骤边界**观察到 abort → 停止推进后续步骤，返回 `cancelled` + 已完成步骤 |
| Provider 未返回 cancelled 但 signal 已 abort | **以 Provider 结果为准**（不二次改写，避免与 Provider 语义打架）；仅记日志 |
| 步骤正在执行中 abort | **不可中断该步骤**（同进程直调，无隔离）→ 该步骤跑完后在下一边界生效；此为已记录的局限，P2-2 隔离后消除 |

## 4. 影响文件

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/modules/workflow/types.ts` | 新增 `WorkflowExecuteOptions` |
| 2 | `app/src/modules/workflow/WorkflowEngine.ts` | `execute` 第 3 参收拢为 options；signal 预检；透传 Provider；接口加 `signal` |
| 3 | `app/src/modules/workflow/index.ts` | 导出 `WorkflowExecuteOptions` |
| 4 | `app/src/modules/doc/orchestration/DocOrchestrator.ts` | `execute(name, params, signal?)` + **步骤边界 abort 检查**（返回 `success:false` + 取消文案） |
| 5 | `app/src/modules/doc/orchestration/DocOrchestratorProvider.ts` | 接收 signal 并透传；abort 时归一为 `stopReason='cancelled'` |
| 6 | `app/src/modules/doc/DocModule.ts` | `office:workflow` 工具签名接 `context`，把 `context.abortController.signal` 传入 seam |
| 7 | 测试 | `WorkflowRunObserver.test.ts` 改用 options 形状；新增取消用例 |

## 5. 验证方案

| 项 | 通过标准 |
|---|---|
| 类型与架构 | `bun run typecheck` 0；`lint-architecture.ts` 0 |
| 取消（预检） | 已 abort 的 signal → `stopReason='cancelled'`，Provider 未被调用 |
| 取消（执行中） | Provider 观察到 abort → seam 结果 `cancelled`；observer 仍收到 start/end 配对 |
| 步骤边界 | `DocOrchestrator` 在第 N 步前 abort → `completedSteps` 只含前 N-1 步 |
| 回归 | 既有 22 单测全绿（含 options 形状改造后） |
| ⚠ 未做 | 端到端实跑（真实会话中止触发）；in-flight 步骤不可中断（P2-2 消除） |

## 6. 合规检查清单

| 规则 | 检查点 |
|---|---|
| R06-008 分层 | 取消信号由调用方（工具上下文）提供，seam 不自建"全局取消" |
| CS01 归一化 | 复用既有 `AbortSignal`/`AbortController`，不自建取消原语 |
| CS03 回退最小化 | 无"以防万一"try-catch；仅保留观察者包含与边界可选访问 |
| CS04 Mock 零容忍 | 无 mock 数据 |
| CS06 证据驱动 | 约束附路径#行号 |

## 7. 实施结果（2026-09-13 已完成）

| 文件 | 改动 |
|---|---|
| `modules/workflow/types.ts` | 新增 `WorkflowExecuteOptions { observer?, signal? }` |
| `modules/workflow/WorkflowEngine.ts` | 第 3 参由 `observer?` 收拢为 `options?`；`signal` **预检**（不进入 Provider，但仍发 start/end 以保持 run 记录成对）；`signal` 透传 Provider；`WorkflowProvider.execute(..., signal?)` |
| `modules/workflow/index.ts` | 导出 `WorkflowExecuteOptions` |
| `modules/doc/orchestration/DocOrchestrator.ts` | `execute(name, params, signal?)` + 循环首部**步骤边界** abort 检查（返回已完成步数与取消文案） |
| `modules/doc/orchestration/DocOrchestratorProvider.ts` | 透传 signal；中止时**优先于**成功/失败判定返回 `cancelled` + 已完成步骤 |
| `modules/doc/DocModule.ts` | 工具签名接 `context`（`ToolUseContext`），传 `context?.abortController?.signal` |
| 测试 | `WorkflowRunObserver.test.ts` 改用 options 形状；新增 3 个取消用例（预检 / 执行中 / signal 透传） |

**验证**：`bun run typecheck` exit 0；单测 **25 pass / 0 fail**（3 文件 72 断言）；定向 ESLint 0；`scripts/lint-architecture.ts` **0 错误 / 0 警告**（含 R00-001 分层）。

**未做（已记录）**：端到端实跑（真实会话中止触发）；in-flight 单步不可中断（P2-2 消除）；`dispose()` 与宽限期强结算（P2-2）。
