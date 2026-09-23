# 流程定义外化 + 工作流桩/特性位收敛 Spec（P1-2 + V-3）

> 版本: 1.0 | 创建: 2026-09-13 | 状态: **首版已完成（2026-09-13）**
> 关联: GR15 / R02（类型统一）/ R06-005（命名）/ CS01 / CS03 / CS04 / PY_APP §2（不做投机性扩展）/ project_rules §1.3（无向后兼容）
> 前置：`.trae/specs/workflow-engine-seam.md`（P1-1）/ 路线图阶段二 P1-2、V-3

## 1. Problem Statement

1. **流程定义硬编码**：3 条内建流程写死在 `DocOrchestrator` 静态表（`DocOrchestrator.ts#L47-L71`：`send-report` / `reply-with-doc` / `meeting-to-all`），扩展或替换必须改源码；seam 已有 `WorkflowDefinition` 类型却未被用于承载内建流程。
2. **doc 侧重复类型**：`DocOrchestrator` 自带私有 `WorkflowStep { tool, description }`（`#L10-L13`），与 seam 的 `WorkflowStepSpec` 结构重叠（R02）。
3. **死桩 + 死特性位**：
   - `ToolFactory.createWorkflowTool()` 方法体为 `return null`（`ToolFactory.ts#L939-L941`）；
   - 由 `coreFeature('WORKFLOW_SCRIPTS')` 门控注册（`tools/utils/ToolManagerUtils.ts#L235-L238`）；
   - `WORKFLOW_SCRIPTS`（`core/featureFlags.ts#L297`）唯一消费者就是该桩；`ENABLE_WORKFLOWS`（`#L113`）**零消费者**（全仓检索仅定义 + `app/docs/CORE_MODULES.md#L405` 文档提及）。
4. **命名歧义**：`DocModule.createWorkflowTool()`（私有，创建真实的 `office:workflow` 工具，`DocModule.ts#L257`）与 `ToolFactory.createWorkflowTool()`（空桩）**同名不同物**（R06-005）。

## 2. 决策

| ID | 决策 | 理由 |
|---|---|---|
| D1 | **流程定义外化为数据**：新增 `modules/doc/orchestration/docWorkflows.ts` 导出 `DOC_WORKFLOW_DEFINITIONS: WorkflowDefinition[]`（seam 类型）；在**组合根**（`DocModule`）注入 `DocOrchestrator` | 数据成为唯一事实来源；新增/替换流程 = 改数据，不改执行逻辑 |
| D2 | **删除静态表与静态查询**：`DocOrchestrator.workflows` 与 `static getAvailableWorkflows()` 移除，改为实例方法 `getDefinitions()` | 静态表是"代码即配置"的根因；实例持有便于注入与后续按会话覆盖 |
| D3 | **去掉 doc 侧重复类型**：删除私有 `WorkflowStep`，统一用 seam 的 `WorkflowStepSpec` | R02；定义已由 seam 类型承载，无需第二套 |
| D4 | **"默认模板"= 数据文件**；**不**在本批做与 `workspace.WorkflowTemplate` 的合并 | 二者语义不同：`WorkflowTemplate`（`workspace/types.ts#L548`）的步骤带 `type: manual\|auto\|review` + `suggestedAgentRole`，是**面向人/AI 角色的清单**，不驱动工具调用；seam 的 `WorkflowDefinition` 步骤带 `tool`，驱动真实执行。绑定与落盘属 **P2-1** |
| D5 | **V-3 选「删除」**：删 `ToolFactory.createWorkflowTool()` 桩 + `ToolManagerUtils` 条件注册 + `WORKFLOW_SCRIPTS`/`ENABLE_WORKFLOWS` 特性位 + 文档提及 | 见下方四条理由 |

### D5 理由（为何选删除而非"实现为 Consumer"）

1. **删的是死路径，不是能力**：`ENABLE_WORKFLOWS` 零消费者；`WORKFLOW_SCRIPTS` 唯一消费者是恒 `return null` 的桩。
2. **选项①在无隔离时是安全隐患**：让模型自撰流程定义 → 定义可调用任意工具且**同进程执行**；deepseek-harness 的 `tool-workflow` 有 worker_thread 隔离兜底，本仓的隔离是 P2-2（未做）。
3. **能力已存在，无需第二入口**：模型侧"运行工作流"已由 `office:workflow`（`DocModule.ts#L245-L330`，经 seam 执行）提供。
4. **符合既定策略**：project_rules §1.3（无用户、无需向后兼容）+ PY_APP §2（不做投机性扩展）。

> **延后项**：模型自撰流程定义（deepseek `tool-workflow` 等价物）**待 P2-2 执行隔离落地后**以独立 spec 评估（含权限边界、可用工具白名单、脚本语言选择）。

## 3. 影响文件

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/modules/doc/orchestration/docWorkflows.ts` | **新建**：`DOC_WORKFLOW_DEFINITIONS` + `findDocWorkflowDefinition(name)` |
| 2 | `app/src/modules/doc/orchestration/DocOrchestrator.ts` | 删静态表 / `static getAvailableWorkflows()` / 私有 `WorkflowStep`；构造注入 `WorkflowDefinition[]`；`execute` 从注入定义解析；新增 `getDefinitions()` |
| 3 | `app/src/modules/doc/orchestration/DocOrchestratorProvider.ts` | `listWorkflows()` 改为读取 `orchestrator.getDefinitions()`（单一来源） |
| 4 | `app/src/modules/doc/DocModule.ts` | `new DocOrchestrator(DOC_WORKFLOW_DEFINITIONS)`；工具 enum/描述改用 `orchestrator.getDefinitions()` |
| 5 | `app/src/tools/ToolFactory.ts` | 删 `createWorkflowTool()` 空桩 |
| 6 | `app/src/tools/utils/ToolManagerUtils.ts` | 删 `WORKFLOW_SCRIPTS` 条件注册项 |
| 7 | `app/src/core/featureFlags.ts` | 删 `ENABLE_WORKFLOWS`、`WORKFLOW_SCRIPTS` 条目及其分节注释 |
| 8 | `app/docs/CORE_MODULES.md` | 删 `ENABLE_WORKFLOWS` 文档条目 |

## 4. 验证方案

| 项 | 通过标准 |
|---|---|
| 类型/架构 | `bun run typecheck` 0；`lint-architecture.ts` 0 |
| 行为不变 | 3 条内建流程经 seam 执行仍返回 `completed` + 相同 `completedSteps`（= 工具名） |
| 单一来源 | 全仓检索 `DocOrchestrator.workflows` / `getAvailableWorkflows` → 0 命中 |
| 桩与特性位 | 全仓检索 `createWorkflowTool` 仅剩 `DocModule` 私有方法；`ENABLE_WORKFLOWS` / `WORKFLOW_SCRIPTS` → 0 命中 |
| 回归 | 既有 25 单测全绿 |
| ⚠ 未做 | 端到端实跑；`WorkflowTemplate` ↔ `WorkflowDefinition` 绑定（P2-1） |

## 5. 合规检查清单

| 规则 | 检查点 |
|---|---|
| R02 数据模型统一 | 删除 doc 侧 `WorkflowStep`，统一 seam 的 `WorkflowStepSpec`/`WorkflowDefinition` |
| R06-005 命名规范 | 删除同名空桩，消除 `createWorkflowTool` 二义 |
| CS01 归一化 | 复用 seam 定义类型与既有 `office:workflow` 入口，不新建第二套 |
| CS03 回退最小化 | 无兜底分支；删死代码不留兼容层 |
| CS04 Mock 零容忍 | 数据为真实内建流程，非示例/mock |
| CS06 证据驱动 | 每条结论附路径#行号 |

## 6. 实施结果（2026-09-13 已完成）

| # | 文件 | 结果 |
|---|---|---|
| 1 | `modules/doc/orchestration/docWorkflows.ts` | ✅ 新建：`DOC_WORKFLOW_DEFINITIONS`（3 条内建流程，seam 的 `WorkflowDefinition` 类型）+ `findDocWorkflowDefinition()` |
| 2 | `modules/doc/orchestration/DocOrchestrator.ts` | ✅ 删静态表 / `static getAvailableWorkflows()` / 私有 `WorkflowStep`；构造注入 `WorkflowDefinition[]`；新增 `getDefinitions()`；`execute` 经 `extractSteps()` 从注入定义解析 |
| 3 | `modules/doc/orchestration/DocOrchestratorProvider.ts` | ✅ `listWorkflows()` 改为 `this.orchestrator.getDefinitions()`（单一来源） |
| 4 | `modules/doc/DocModule.ts` | ✅ `new DocOrchestrator(DOC_WORKFLOW_DEFINITIONS)`；工具 enum 与日志改用 `orchestrator.getDefinitions()` |
| 5 | `tools/ToolFactory.ts` | ✅ 删除 `createWorkflowTool()` 空桩 |
| 6 | `tools/utils/ToolManagerUtils.ts` | ✅ 删除 `WORKFLOW_SCRIPTS` 条件注册项 |
| 7 | `core/featureFlags.ts` | ✅ 删除 `ENABLE_WORKFLOWS`、`WORKFLOW_SCRIPTS` 及其分节注释 |
| 8 | `app/docs/CORE_MODULES.md` | ✅ 删除 `ENABLE_WORKFLOWS` 文档条目 |

**验证**：

| 项 | 结果 |
|---|---|
| `bun run typecheck` | exit 0 |
| 单测 | **25 pass / 0 fail**（3 文件 72 断言，回归全绿） |
| 定向 ESLint | 0 error |
| `scripts/lint-architecture.ts` | 0 错误 / 0 警告（含 R02 重复类型、R06-005 命名、R00-001 分层） |
| 残留检索 | `DocOrchestrator.workflows` / `getAvailableWorkflows` / `ENABLE_WORKFLOWS` / `WORKFLOW_SCRIPTS` → **全仓 0 命中**；`createWorkflowTool` → 仅剩 `DocModule` 私有真实实现 |
| ⚠ 未做 | 端到端实跑；`WorkflowTemplate` ↔ `WorkflowDefinition` 绑定（P2-1） |
