# Spec：项目页计数口径统一 + URL 表达选中项目（N-62 修复）

- **状态**：**已实施并验证**（2026-09-20；V1–V4 全部通过，V2 经第二轮"同源化"修复后通过）
- **关联台账**：N-62（同一工作区会话计数不一致 + `/projects/:projectId` 形同虚设）、N-63（数据侧污染，**不在本 Spec 范围**）

## 1. 已核实证据

**㈠ 计数不一致 —— 根因已定论（前端 store 实证）**

| 事实 | 证据 |
|------|------|
| 卡片计数得 **2** | worktree `id = wt-1789397997212-vfeyzg`（name = `…\workspaces\default`）；`state.sessions` 中 `workspaceId === 该 id` 的恰 **2** 条；卡片用 `sessions.filter((s) => s.workspaceId === p.id).length`（[ProjectsPage.tsx:691-692](file:///e:/PY/Documents/CODES/PY_APP/client/src/components/views/ProjectsPage.tsx#L691-L692)） |
| 侧栏得 **0** | 侧栏过滤用 `hub?.workspaceId ?? s.workspaceId`（[SessionHistorySidebar.tsx:338-345](file:///e:/PY/Documents/CODES/PY_APP/client/src/components/ChatArea/SessionHistorySidebar.tsx#L338-L345)）；而 **998/1043** 条会话的 `workspaceId` 是**空串**，**`??` 对空串不兜底** ⇒ 取到 `""`，`"" !== projectId` ⇒ 全被过滤 |
| 第三个漂移源 | 该 worktree 自身的 `sessionIds` 为 `[]`（未被维护） |

**㈡ URL 不表达选中项目 —— 代码级证据充分**
`routes/index.tsx:137-138` 注册了 `/projects` 与 `/projects/:projectId`，但 `ProjectsPage` **不消费路由参数**（`useNavigate` / `useParams` / `location.` 在该文件 0 命中），选中仅靠本地 state（`:648-653`），初始只读 `?open=`（`:217-219`、`:298-304`）⇒ **实测点击项目后 URL 不变**，深链/刷新/后退无法恢复。

## 2. 目标与非目标

**目标**：① 同一项目的"卡片会话数"与"项目页侧栏会话条数"**必须一致**（同一判据、同一兜底语义）；② URL 能表达"当前选中项目"，深链/刷新/后退可用。

**非目标（明确排除，归 N-63）**：不修数据侧 —— 不清理 998 条空串 `workspaceId`、不修 `workspaceId` 被写入模块名、不处理前端 1043 vs 后端 864 的差异、不维护 `worktree.sessionIds`。本 Spec **只统一消费侧判据**，不改任何数据。

## 3. 改动方案

### ㈠ 判据统一（消费侧）

1. **新增共享纯函数**（放 [selectors.ts](file:///e:/PY/Documents/CODES/PY_APP/client/src/stores/selectors.ts)，该文件已有 `selectSessionsByWorkspace`）：
   ```ts
   /** N-62：会话归属工作区的唯一解析——空串/空白视为"无归属"（`??` 对空串不兜底，必须显式判空） */
   export function resolveSessionWorkspaceId(
     fromSession?: string,
     fromHub?: string,
   ): string {
     const v = (fromHub ?? "").trim() || (fromSession ?? "").trim();
     return v;
   }
   ```
   —— **Hub 值优先，但空串/空白回退到会话自身**（保持既有优先级意图，修正兜底语义）。
2. **`ProjectsPage.getSessionCount`** 改用该函数（Hub 值此处取 `rootSessions[p.id]` 不适用，故只传 session 值）：
   `Object.values(sessions).filter((s) => resolveSessionWorkspaceId(s.workspaceId) === p.id).length`
3. **`SessionHistorySidebar` 的项目作用域过滤 + §4.3-9 分组键** 同样改用该函数（两处 `??` 一并收敛）。
4. **效果**：对 `wt-1789397997212-vfeyzg`，两处都将得到 **2**（只要 Hub 值为空串即回退到会话值；若两者都为空串则该会话**不属于任何项目**，两侧同时不计入 ⇒ 仍一致）。

### ㈡ URL 表达选中项目

5. **`ProjectsPage` 消费路由参数**：
   - `const { projectId: routeProjectId } = useParams()`；
   - 初始选中优先级：**`routeProjectId` → `?open=` → 首个项目**（既有两条路径保持可用）；
   - `handleSelectProject(id)` 内追加 `navigate(\`/projects/${id}\`, { replace: true })`（**replace** 避免产生大量历史项；保留既有 search 参数）；
   - 选中项目被删除/不存在时回退到 `/projects`（`navigate(..., { replace: true })`）。
6. **兼容性**：既有 `?open=` 入口（侧栏项目 flyout 用 `/projects/${p.id}?open=${p.id}`）目标 URL 本就含 id 段 ⇒ 新逻辑直接命中，**无需改 flyout**；`/workspace/:workspaceId/:sessionId` 的重定向链路不受影响。

## 4. 风险与对策

| 风险 | 对策 |
|------|------|
| URL 变化触发组件重挂载/闪烁 | 用 `{ replace: true }` 且仅在 id 变化时 navigate；选中状态仍以本地 state 为主（URL 是**镜像**，不改为受控路由） |
| `useParams` 在 `/projects`（无 id）下为 `undefined` | 保持既有 `?open=` / 首项目回退逻辑，不改变无参行为 |
| 两侧判据统一后数字仍不一致 | 说明数据侧问题（N-63）在作祟 ⇒ **如实报告**，不在本 Spec 内绕过 |
| 误伤 `/projects/:projectId/output/:outputType` 子路由 | 该路由渲染同一组件；仅消费 param，不改子路由行为（实施后回归验证） |

## 5.1 验证结果（2026-09-20）

- **V1 深链** ✅：直访 `/projects/wt-1789397997212-vfeyzg` 选中正确，**整页刷新后仍保持**
- **V2 一致性** ✅：**第二轮修复后通过** —— 卡片与侧栏：`plan-e2e` **1 = 1**、`…\workspaces\default` **0 = 0**；重复进出 3 次数值**不再漂移**（`1 → 1 → 1 → 1 → 1`）
  - **第一轮为何失败（如实记录）**：仅统一"判据/兜底语义"不足 —— 两侧读的是**同一 root store 的两个不同字段**：卡片用 `state.sessions`（Hub Map，1426 条含幽灵），侧栏用 `state.chatSessions`（列表，864 条）。**第二轮改为同源化**：项目页 6 处展示类派生统一走 `sessionsOfProject`（基于 `chatSessions`），侧栏去 Hub 覆盖 ⇒ 同源同判据必然一致。`state.sessions`（Hub）仅留给项目初始化逻辑（用户明确本轮不处理 N-64）
  - 顺带修正：`chatSessions.updatedAt` 为 **ISO 字符串**（Hub 为 number），新增 `sessionTs()` 解析（原 4 处 `Math.max` 比较类型错误）
- **V3 回归** ✅：项目卡片点击跳转、`/workspace/:id` → `/projects/:id` 重定向、`/chat` 分组（`default 1` + `未分组 847`）均正常
- **V4 边界** ✅：`/projects/this-id-does-not-exist` → 自动回退 `/projects`，无报错
- **静态/单测**：client `typecheck` EXIT=0、vitest **26 文件 / 244 例通过**；无 `Maximum update depth exceeded` 等告警

## 5.2 未纳入本 Spec（如实登记）

- **N-63**：数据侧 —— `workspaceId` 空串（998/1043）、被写入模块名、`worktree.sessionIds` 恒空、前端/后端数量不一致
- **N-64**：进入项目页反复创建会话（本地 Hub 记录膨胀 1043 → 1426，384 条归属同一项目）—— 用户明确**本轮不立项**，故本项目初始化逻辑仍按 `state.sessions`（Hub）判定，未改动

## 6. 回滚

- ㈠：把两处调用点改回原表达式即可（纯函数保留无害）
- ㈡：移除 `useParams` 消费与 `navigate` 调用，回到"本地 state + `?open=`"现状

## 7. 实施后需同步

- 台账 N-62 状态改为已修复（含验证证据）；N-63 保持待处理（数据侧）
- `dev_docs/frontend-nav-optimization.md` §4.3-9 的"已知边界"补记该项已处理
