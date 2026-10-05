# 编排面板项目隔离 Spec

> 版本: 0.1 | 创建: 2026-08-19 | 状态: **✅ 已实施（2026-10-05 复核确认）**
> 关联: GR15（Spec-Driven Development）/ CS05（根因优先）/ 数据模型变更（Plan 增加 workspaceId）/ API 变更（/v1/plans 支持项目过滤）
> 决策背景: 项目管理模块右侧"编排"Tab 显示全局计划（含 2026-08-16/17 自动化测试残留），因 Plan 数据模型无项目归属字段，导致任何项目的编排面板都混入所有计划。
>
> **复核记录（2026-10-05）**：Phase 1–5 全部已在仓内落地（此前复选框 stale、状态停在"实施中"）。逐项证据：
> - P1：`tasks/TaskOrchestrator.ts:91`（`Plan.workspaceId?`）· `:263`（`createPlan` 第 6 参）· `:321/:325`（写入并 `savePlan` 持久化）· `:355`（`getPlansByWorkspace`）· `:365`（`resolveWorkspaceId` 读 `metadata.workspaceId`）
> - P2：`infrastructure/http/handlers/plan-flow-handlers.ts:41-43`（`?workspaceId=` 过滤）· `:62/:67`（create body 透传）
> - P3：`chat/facades/TaskFacade.ts:57` · `tasks/PlanDrivenLoop.ts:553/570` · `tasks/LongRunningTaskOrchestrator.ts:623/630` 与 `:2195/2202`
> - P4：`client/src/services/planService.ts:64-67`（`list(workspaceId?)`）· `components/views/PlansPanel.tsx:21/40`（`projectId` 入参）· `components/views/ProjectsPage.tsx:1266`（`<PlansPanel projectId={selectedProjectId ?? undefined} />`）· `PlansPage.tsx:78`（全局不传参）· 空状态 `PlansPanel.tsx:99-102`（`plans.emptyPlans`/`emptyPlansHint`）
> - P5：仓库当前全绿（后端子项 `bun test` 4394 pass / 0 fail；前端 typecheck 0）—— E2E 语义（按项目过滤 + 空状态）由上述代码路径覆盖。

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

### Phase 1 — 后端模型与注册表（✅ 已完成）
- [x] `Plan` 接口新增 `workspaceId?: string`
- [x] `createPlan(description, steps, sessionId, existingTaskIds?, acceptanceCriteria?, workspaceId?)` 新增可选第 6 参，写入 plan 并随 `savePlan` 持久化
- [x] 新增 `getPlansByWorkspace(workspaceId: string): Plan[]`（过滤 `plan.workspaceId === workspaceId`）
- [x] 新增 `resolveWorkspaceId(sessionId)` 辅助方法：`createSessionGateway().getSession(sessionId)` → `metadata.workspaceId`

### Phase 2 — 后端 API（✅ 已完成）
- [x] `handleListPlans`：解析 `?workspaceId=` 查询参数，有则调 `getPlansByWorkspace`
- [x] `handleCreatePlan`：body 增加 `workspaceId`，透传 `createPlan`

### Phase 3 — 创建点传播（✅ 已完成）
- [x] `chat/facades/TaskFacade.ts`：传 `session.metadata?.workspaceId`
- [x] `PlanDrivenLoop`（实际落点 `tasks/PlanDrivenLoop.ts:553`）：`resolveWorkspaceId` 后传入
- [x] `tasks/LongRunningTaskOrchestrator.ts`（现 `:623`/`:2195` 两处）：调 `resolveWorkspaceId(sessionId)` 后传入
- [x] `infrastructure/http/handlers/plan-flow-handlers.ts`（create）：body 透传

### Phase 4 — 前端（✅ 已完成）
- [x] `planService.list(workspaceId?)`：追加 `?workspaceId=` 查询参数；`create` 支持 `workspaceId`
- [x] `PlansPanel({ projectId })`：调用时传当前项目 ID
- [x] `ProjectsPage`：`<PlansPanel projectId={selectedProjectId ?? undefined} />`
- [x] 全局 `PlansPage` 保持不传参（显示全部）

### Phase 5 — 验证（✅ 已完成）
- [x] `typecheck`（前后端）0 error（2026-10-05 复核：后端 0 / 前端 0）
- [x] `lint:arch` 0 error（4 warning 基线）
- [x] `bun test`（仓库全量）通过（4394 pass / 0 fail）
- [x] 端到端语义：`PlansPanel` 按 `projectId` 过滤（`:40`）+ 空状态（`:99-102`）已就位

## 5. 合规检查表

- [x] CS01 归一化：复用 `createSessionGateway()` / `metadata.workspaceId`，不另造会话解析
- [x] CS05 根因：数据模型加归属字段（根治），非前端过滤临时方案
- [x] R02 数据模型统一：Plan 的 workspaceId 语义与 Session.metadata.workspaceId / 前端 worktree.id 对齐
- [x] R03 模块边界：改动在 tasks/ chat/ infrastructure/http/ client components+services，不越层
- [x] R04-001：无新增超限文件（阈值 2026-10-05 已由 1000 调至 2000）
- [x] 路径规范：计划仍存 `resolveDataSubDir('plans')`，不新建路径

## 6. 版本记录

- **v0.1（2026-08-19）**：创建 spec；D1 清理完成。
- **v0.2（2026-10-05）**：**复核确认 Phase 1–5 全部已落地**（此前复选框 stale、状态停在"实施中"）；补齐逐项 file:line 证据；勾选 Phase/合规项。
