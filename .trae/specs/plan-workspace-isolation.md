# 编排面板项目隔离 Spec

> 版本: 0.1 | 创建: 2026-08-19 | 状态: **实施中**
> 关联: GR15（Spec-Driven Development）/ CS05（根因优先）/ 数据模型变更（Plan 增加 workspaceId）/ API 变更（/v1/plans 支持项目过滤）
> 决策背景: 项目管理模块右侧"编排"Tab 显示全局计划（含 2026-08-16/17 自动化测试残留），因 Plan 数据模型无项目归属字段，导致任何项目的编排面板都混入所有计划。

## 1. 诊断证据（2026-08-19 实测）

| 现象 | 证据 |
|------|------|
| 编排面板显示"重开测试/并行测试/测试任务/串行测试" | `~/.pyapp/data/plans/` 下 75 个计划文件，描述均为 `D2 并行测试`/`D2 串行测试`/`D5 测试任务`/`D5 重开测试`，sessionId 仅 `s-d5`/`s-d5-r`/`session-d2`/`session-d2-seq`，创建于 2026-08-16/17 |
| 无项目隔离 | `Plan` 接口（`app/src/tasks/TaskOrchestrator.ts`）无 `workspaceId` 字段 |
| 列表接口返回全局数据 | `handleListPlans`（`app/src/infrastructure/http/handlers/plan-flow-handlers.ts`）调 `taskOrchestrator.getAllPlans()`，无过滤参数 |
| 前端不传项目 | `PlansPanel.tsx` 调 `planService.list()` 和 `/v1/flows`，均未携带当前项目 ID |
| 流程非持久化 | `task_flow_records` 表不存在，flows 仅内存态（`TaskFlowRegistry` store=null），无残留数据，暂不处理 |

**根因**：Plan 数据模型缺少 `workspaceId` 归属字段，创建时未记录项目归属，读取时无过滤 → 全局数据串扰所有项目视图。

## 2. 决策（用户已确认 2026-08-19「两者都做」）

- **D1**：清理 `~/.pyapp/data/plans/` 测试残留（已完成，75 个文件已删）。
- **D2**：Plan 数据模型增加 `workspaceId?: string`，创建时从会话解析并持久化。
- **D3**：`GET /v1/plans` 支持 `?workspaceId=` 过滤；`POST /v1/plans` 接受 `workspaceId`。
- **D4**：前端 `PlansPanel` 接收 `projectId`，`planService.list(workspaceId)` 带参查询，ProjectsPage 传入当前项目 ID。
- **D5**：流程（flows）本轮不处理——无持久化残留，内存态随运行消失。

## 3. 数据模型与迁移

- **Plan**（`app/src/tasks/TaskOrchestrator.ts`）新增字段 `workspaceId?: string`。
- 持久化格式：`~/.pyapp/data/plans/<planId>.json` 同步写入 `workspaceId`（无则省略）。
- **无需 DB 迁移**：plans 为文件存储，无 SQLite 表结构变更。
- 存量计划：已全部清理，无历史数据需迁移。

## 4. 实施步骤

### Phase 1 — 后端模型与注册表（✅ 目标）
- [ ] `Plan` 接口新增 `workspaceId?: string`
- [ ] `createPlan(description, steps, sessionId, existingTaskIds?, acceptanceCriteria?, workspaceId?)` 新增可选第 6 参，写入 plan 并随 `savePlan` 持久化
- [ ] 新增 `getPlansByWorkspace(workspaceId: string): Plan[]`（过滤 `plan.workspaceId === workspaceId`）
- [ ] 新增 `resolveWorkspaceId(sessionId)` 辅助方法：`createSessionGateway().getSession(sessionId)` → `metadata.workspaceId`

### Phase 2 — 后端 API（✅ 目标）
- [ ] `handleListPlans`：解析 `?workspaceId=` 查询参数，有则调 `getPlansByWorkspace`
- [ ] `handleCreatePlan`：body 增加 `workspaceId`，透传 `createPlan`

### Phase 3 — 创建点传播（✅ 目标）
- [ ] `chat/facades/TaskFacade.ts`：传 `session.metadata?.workspaceId`
- [ ] `core/loop/PlanDrivenLoop.ts`：`PlanDrivenLoopConfig` 增加 `workspaceId?`，调用方传入（从会话解析）
- [ ] `tasks/LongRunningTaskOrchestrator.ts`（445/1627 两处）：调 `resolveWorkspaceId(sessionId)` 后传入
- [ ] `infrastructure/http/handlers/plan-flow-handlers.ts`（create）：body 透传

### Phase 4 — 前端（✅ 目标）
- [ ] `planService.list(workspaceId?)`：追加 `?workspaceId=` 查询参数；`create` 支持 `workspaceId`
- [ ] `PlansPanel({ projectId })`：调用时传当前项目 ID
- [ ] `ProjectsPage`：`<PlansPanel projectId={selectedProjectId} />`
- [ ] 全局 `PlansPage` 保持不传参（显示全部）

### Phase 5 — 验证（✅ 目标）
- [ ] `typecheck`（前后端）0 error
- [ ] `lint:arch` 0 error
- [ ] `bun test`（tasks 相关）通过
- [ ] 端到端：选择项目 A，编排面板只显示 workspaceId 归属 A 的计划；无计划时显示"暂无计划"

## 5. 合规检查表

- [ ] CS01 归一化：复用 `createSessionGateway()` / `metadata.workspaceId`，不另造会话解析
- [ ] CS05 根因：数据模型加归属字段（根治），非前端过滤临时方案
- [ ] R02 数据模型统一：Plan 的 workspaceId 语义与 Session.metadata.workspaceId / 前端 worktree.id 对齐
- [ ] R03 模块边界：改动在 tasks/ chat/ core/loop/ infrastructure/http/ client components+services，不越层
- [ ] R04-001：无新增超 1000 行文件
- [ ] 路径规范：计划仍存 `resolveDataSubDir('plans')`，不新建路径

## 6. 版本记录

- **v0.1（2026-08-19）**：创建 spec；D1 清理完成。
