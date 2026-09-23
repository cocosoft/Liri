# 任务类型语义修正 Spec（V-4）

> 版本: 1.0 | 创建: 2026-09-13 | 状态: **首版已完成（2026-09-13）**
> 关联: GR15 / CS02（语义与标记一致）/ CS05（根因优先）/ project_rules §1.1（禁删除数据库结构）/ §1.3（无用户、无需向后兼容）
> 前置：`.trae/specs/`（P1 系列）/ 路线图阶段二 V-4

## 1. Problem Statement

`TaskType.WORKFLOW = 'local_workflow'`（`app/src/tasks/types.ts#L31`）在当前代码中**没有任何"工作流"语义的生产者**——删除 `LocalWorkflowTask`（V-1）后，唯一使用者是 `NoteTask`，即 `/task`、`/plan` 命令的**纯数据记录任务**（`NoteTask.ts#L11`/`#L14`，类注释明确"仅用于数据记录，不执行任何 agent"）。

后果：
1. `pillLabel` 把这类任务显示为 "1 background workflow"（`pillLabel.ts#L72-L73`）——用户看到的是"工作流"，实际是笔记/计划记录；
2. 任务 id 前缀为 `w`（`TaskRegistry.ts#L112`），同样误导；
3. 类型名与语义背离，属 CS02「语义与持久化标记一致」的反面案例。

## 2. 影响评估（决定方案的事实依据）

| 面 | 事实（附证据） | 结论 |
|---|---|---|
| 数据库结构 | `task_states.type TEXT NOT NULL`，**无 CHECK 约束**（`tasks/db/schema.ts#L2-L4`） | 改枚举值不触碰表结构，不违反 §1.1「严禁删除数据库结构」 |
| 恢复路径 | `TaskRegistry.loadTasks(): Promise<TaskState[]>`（`TaskRegistry.ts#L198`）只恢复**状态快照**；全仓无按 type 重建任务实例（`new NoteTask` 仅出现在 `registerNoteTask` 创建路径 `#L595`） | 存量行**不会被孤儿化**，仅表现为标签降级 |
| 前端 | `client/src` 检索 `local_workflow` → **0 命中** | 无前端影响 |
| id 前缀表 | `TASK_ID_PREFIXES` 仅被 `generateTaskId()` 用于**生成**新 id（`TaskRegistry.ts#L431-L436`），无反向解析 | 改前缀安全 |
| 存量行表现 | 旧行 `type` 仍为 `local_workflow` → `getPillLabel` 落 `default` 分支显示 "N background tasks" | 降级但不错乱、不报错 |
| 其他引用 | `app/scripts/seed-test-tasks.ts#L173`（开发播种脚本） | 一并更新 |

## 3. 决策

| ID | 决策 | 理由 |
|---|---|---|
| D1 | 采用**方案 ①：改名** —— `WORKFLOW = 'local_workflow'` → `NOTE = 'note'` | 语义错位在**枚举本身**；方案 ②（只改 pillLabel 文案）会把错误命名留在代码里，是贴创可贴而非根因修复（CS05） |
| D2 | id 前缀 `w` → `n` | 与类型语义一致；仅影响新生成 id |
| D3 | **不迁移存量行** | 无正式用户 + 无兼容承诺（§1.3）；旧行仅降级为通用标签，无功能损失 |
| D4 | `pillLabel` 文案改为 `1 note` / `N notes` | 与类型语义一致，且不虚构"工作流"能力 |

## 4. 影响文件

| # | 文件 | 改动 |
|---|---|---|
| 1 | `app/src/tasks/types.ts` | `WORKFLOW = 'local_workflow'` → `NOTE = 'note'`（附语义注释） |
| 2 | `app/src/tasks/NoteTask.ts` | 两处 `TaskType.WORKFLOW` → `TaskType.NOTE` |
| 3 | `app/src/tasks/TaskRegistry.ts` | `[TaskType.WORKFLOW]: 'w'` → `[TaskType.NOTE]: 'n'` |
| 4 | `app/src/tasks/pillLabel.ts` | `case 'local_workflow'` 文案 → `1 note` / `N notes` |
| 5 | `app/scripts/seed-test-tasks.ts` | 播种行 `type` 与描述/tag 同步（原先写的是已不存在的"工作流"任务） |

## 5. 验证方案

| 项 | 通过标准 |
|---|---|
| 残留检索 | 全仓 `local_workflow` / `TaskType.WORKFLOW` → 0 命中（旧报告文档除外，属阶段五） |
| 类型与架构 | `bun run typecheck` 0；`lint-architecture.ts` 0 |
| 回归 | tasks 相关测试全绿（含 `TaskRegistry` / `TaskOrchestrator` 使用方） |
| 语义一致 | `NoteTask.type === 'note'`；`getPillLabel([noteTaskState])` 返回 `1 note` |
| ⚠ 未做 | 存量行迁移（D3 明确不做）；未做 UI 实测 |

## 6. 合规检查清单

| 规则 | 检查点 |
|---|---|
| CS02 语义/标记一致 | 类型名、id 前缀、展示文案三者与"笔记任务"语义一致 |
| CS05 根因优先 | 改枚举本身，而非只改展示文案 |
| CS04 Mock 零容忍 | 仅同步既有开发播种脚本，未新增假数据到生产路径 |
| project_rules §1.1 | 未触碰数据库结构（无 CHECK / 无迁移） |
| project_rules §1.3 | 未做兼容层；存量行不迁移 |
| CS06 证据驱动 | 影响评估每条附路径#行号 |
