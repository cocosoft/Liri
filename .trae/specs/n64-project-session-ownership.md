# Spec：消除"进入项目反复创建空会话"（N-64 修复）· 第二版

- **状态**：**已实施并验证**（2026-09-20，用户选定"两步都改"；V1-V4 通过）
- **关联台账**：N-64
- **第一版为何作废（取证失误，如实记录）**：第一版断言"后端 `handleCreateSession` 未写 `metadata.workspaceId`"，依据是"全仓 grep 无写入点"。实际后端**有**该写入（[session-handlers.ts:213](file:///e:/PY/Documents/CODES/PY_APP/app/src/infrastructure/http/handlers/session-handlers.ts#L213)）—— 那次 grep 的 `head_limit: 20` 把结果**截断**，`session-handlers.ts` 未进入返回集，我却据"未命中"下了结论（违反 CS06 证据驱动）。**教训**：以 grep 否定存在性时，必须先限定文件范围或确认未截断。

## 1. 已核实证据链（修正版）

| # | 事实 | 证据 |
|---|------|------|
| 1 | 项目页的"创建首个会话"路径**会落库** | `ProjectsPage.init()` → `createChatSession("对话 1")` → `sessionService.create(title, { workspaceId, projectId, … })`（`sessionSlice.ts:850-858`） |
| 2 | 后端**会**持久化两个归属字段 | `if (workspaceId) metadata.workspaceId = …`、`if (projectId) metadata.projectId = …`（`session-handlers.ts:213`、`:216`） |
| 3 | 但**还有第二条创建路径**，且**纯本地** | `App.tsx:108` 全局挂载 `useAutoCreateSession()`（依赖 `[location.pathname, location.search, …]`，[:103](file:///e:/PY/Documents/CODES/PY_APP/client/src/hooks/useAutoCreateSession.ts#L103)）⇒ **每次导航都触发** → `getOrCreateSession(moduleType)`（`useAutoCreateSession.ts:97`） |
| 4 | 该路径对**用户项目 worktree** 每次都裸创建 | 系统 worktree 分支**会先复用**（`sessionSlice.ts:455-470`），而 `workspaceSource === "user"` 分支直接 `return get().createSession(moduleType, title)`（[:472-478](file:///e:/PY/Documents/CODES/PY_APP/client/src/stores/root-store/sessionSlice.ts#L472-L478)）—— 注释自述意图为"项目内多会话"，但未考虑"每次导航都触发" |
| 5 | 本地创建的 id/标题与实测**逐字吻合** | `createSession` 未传 `overrideId` ⇒ id = `sess-<ts>-<rand>`、title = `新${模块名}`（`sessionSlice.ts:258-295`）⇒ 实测正是 `sess-*` 与 `新project` |
| 6 | 且它**不被后端持久化** | 该分支不调任何后端接口 ⇒ 后端列表无此 id（实测：后端 864 个 id 全为 `session_` 前缀、`sess-` 前缀 **0** 个） |
| 7 | 与 N-63 叠加后被放大为"无限循环" | N-63 ① 已把 Hub 改为**以服务端为准** ⇒ 这些后端不存在的 `sess-*` 记录在下次 `loadChatSessions` 后被清（宽限 60s）⇒ 再进入项目又创建；修复前是 merge 语义，故累积成 384 条 |
| 8 | 用户可观测量 | 项目卡片数值随进出漂移（`2 → 3 → 5 → 117 → 383 → 384`，现已收敛为稳定值），但每次进入仍新增一条瞬时记录 |

## 2. 目标与非目标

**目标**：进入/导航到项目页**不再产生多余会话** —— 同一项目下，除"空项目首次进入自动建 1 条（落库版）"外，不应再生成旁路会话。

**非目标**：不改变"空项目首次进入自动创建首个会话"的产品行为；不清理存量数据；不动 N-62/N-63 已修项。

## 3. 改动方案

1. **`getOrCreateSession` 的用户项目分支改为"先复用"**（`sessionSlice.ts:472-478`）：与系统 worktree 分支（`:455-470`）对称 —— 先在同 worktree + 同 moduleType 的已有会话中查找，命中则 `set({ currentSessionId })` 并返回；仅当确无时才创建。
2. **`useAutoCreateSession` 跳过 project 模块**（`useAutoCreateSession.ts`）：项目会话的创建**统一由 `ProjectsPage.init()` 负责**（该路径会落库），自动创建 hook 不再介入 ⇒ 导航到项目页不再凭空多出空会话。
3. **保留已完成的 2 处改动**（独立有益、已验证编译通过）：`flattenSession` 提取 `metadata.projectId`、`Session` 类型新增 `projectId?` —— 使前端可消费**权威事实面** `projectId`（后端 `effectiveProjectId()` 即按它判定）。**本版不改任何判据**（N-62 的 `workspaceId` 判据保持，避免回归）。

## 4. 风险与对策

| 风险 | 对策 |
|------|------|
| 第 2 项使"从 URL 直达项目页"失去自动会话 | `ProjectsPage.init()` 在"该项目无会话"时会创建并落库 ⇒ 行为不变；验证 V1 覆盖该场景 |
| 第 1 项复用可能选到非预期会话 | 判据与系统分支一致（同 worktree + 同 moduleType），并取最近更新者 |
| 仍存在第三条创建路径 | 验证 V2 以"**Hub 中不再出现 `新project`/`sess-*` 残留**"为硬标准；若仍出现，如实报告并继续定位 |
| 改动触及导航主链路 | 保留回滚点：第 2 项为单行 early-return，第 1 项为分支内追加查找 |

## 5. 验证计划

- **V1（核心）**：对同一项目连续"进入 → 返回列表"**3 次**，记录每次后端 `GET /v1/sessions` 总条数与 `?projectId=<id>` 结果：**除首次外不得增长**（允许首次 +1）
- **V2**：操作全过程中，`localStorage['liri-root-store'].state.sessions` 内**不再出现标题为 `新project`、id 为 `sess-*` 的残留记录**（允许 ≤60s 宽限内的瞬时记录，但不得随进出次数线性累积）
- **V3 回归**：`/chat` 正常（分组仍 `default 1` + `未分组 847`）；项目页卡片与侧栏计数仍相等（N-62）；
- **V4 静态**：client `typecheck` EXIT=0、vitest 0 fail

## 6. 回滚

- 第 1 项：删除"先复用"查找，恢复直接 `createSession`
- 第 2 项：删除 project 模块的 early-return

## 7. 验证结果（2026-09-20 实施后实测）

- **V1（核心）** ✅：进入被测项目 **3 次**（另加 1 轮补充确认），后端 `GET /v1/sessions` 总数 **`864 → 865 → 865 → 865`** —— **仅首次 +1**（该项目进入前确为 0 会话 ⇒ 走"确无才创建"并落库 `session_muaiupbscb38ci5gjlo / 对话 1`），第 2/3/4 次均命中"复用已有会话"（后端最新记录 `createdAt` 不变）；卡片数值 **`0 → 1 → 1 → 1`** 稳定
- **V2** ✅：`localStorage` 中**标题为 `新project` 的记录 0 条**（后端 0）；修复前该现象随进出线性累积
- **V3 回归** ✅：`/chat` 分组仍为 `default 1` + `未分组 847`；项目卡片数值与项目页侧栏条数**相等**（N-62 未回归）；页面正常渲染、无 console 报错
- **V4 静态** ✅：client `typecheck` EXIT=0、vitest **26 文件 / 244 例通过**
- **顺带发现（已登记台账 N-65）**：`localStorage` 中另有 **2 条** `sess-*`/`新对话`（**chat 模块**）随每次 `/chat` 导航重建 —— 与 N-64 **同族**（同一 hook → `getOrCreateSession` 的 chat 分支、同样不落库），但被 N-63 的 60s 宽限限制 ⇒ **不累积、无后端污染**，故本轮不改，另行登记
