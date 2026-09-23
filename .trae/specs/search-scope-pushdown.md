# Spec：会话搜索的作用域下推（N-66 修复）

- **状态**：**已实施并验证**（2026-09-20；用户批准；V1–V5 全部通过）
- **关联台账**：N-66（侧栏搜索"后端有命中、UI 显示无结果"的静默不一致）

## 1. 已核实证据

**问题（台账 N-66 实测）**：搜 `参数` / `compaction` 时侧栏显示「无结果」（0 行），但直接只读 GET `/v1/sessions/messages/search` **后端确有命中**（`compaction` 返回 7 条）。

**本次新增侦察（决定修法可行性）**：

| 事实 | 证据 |
|------|------|
| 后端**只接受 `q` / `limit`**，且 `limit` **硬上限 50** | [session-handlers.ts:86-90](file:///e:/PY/Documents/CODES/PY_APP/app/src/infrastructure/http/handlers/session-handlers.ts#L86-L90)（`Math.min(..., 50)`） |
| 网关**已支持谓词过滤**，但**仅按单会话** | `SessionGateway.searchMessagesFTS(query, sessionId?, limit?)` → `engine.search(query, 'message', limit, sessionId ? (doc) => doc.metadata?.sessionId === sessionId : undefined)`（[SessionGateway.ts:1431-1443](file:///e:/PY/Documents/CODES/PY_APP/app/src/session/SessionGateway.ts#L1431-L1443)） |
| 该第 2 参数目前**未被使用** | `CoreAPIImpl.searchMessagesFTS` 调用时传 `undefined`（[CoreAPIImpl.ts:2386](file:///e:/PY/Documents/CODES/PY_APP/app/src/runtime/api/CoreAPIImpl.ts#L2386)） |
| 侧栏的过滤顺序导致静默丢弃 | `SessionHistorySidebar` 先按模块作用域过滤会话列表（`:346-386`），故非当前模块的正文命中不会出现在 UI，且**无任何提示** |

**结论**：漏显有两个成因 —— ① 后端全局取前 50 条（当前作用域命中可能排在 50 之外）；② UI 侧作用域过滤静默丢弃其余命中。**只靠前端无法修复**（无法一次按"多个会话"下推、也无法突破 50 上限），必须让**后端支持下推作用域**。

## 2. 目标与非目标

**目标**：侧栏搜索在**当前模块作用域**内检回结果 —— 即把"作用域"下推到后端查询，使 ① 不再因全局截断而漏显本作用域命中；② 不再出现"后端有、UI 无"的静默不一致。

**非目标**：
- 不改 `GlobalSearchModal` 的**全局**搜索语义（它应继续返回跨模块结果）—— 通过"是否传参"区分；
- 不引入分页/无限滚动（若要展示 > 50 条命中，另立项）；
- 不改 FTS5 分词行为（`sessions_yield` 单词不命中等属既定行为，见 N-66 附注）。

## 3. 改动方案

1. **后端 handler**（`session-handlers.ts` → `handleSearchMessagesFTS`）：新增**可选**查询参数 `moduleType`，透传至 coreAPI（既有 `q` / `limit` 行为不变，`limit` 上限仍为 50）。
2. **CoreAPI 层**（`CoreAPIImpl.searchMessagesFTS`）：签名扩展为 `(query, limit?, moduleType?)`；把 `moduleType` 透传给网关。**既有调用方**（`handleSearchMessagesFTS`）保持可用。
3. **网关**（`SessionGateway.searchMessagesFTS`）：签名扩展为 `(query, sessionId?, limit?, moduleType?)`（**前 3 参数不变**，保证既有 2 处调用点零改动）；当 `moduleType` 提供时，把谓词从"单会话相等"扩展为"**该会话属于该模块**"：
   - 谓词形式：`(doc) => this.isSessionInModule(doc.metadata?.sessionId, moduleType)`
   - **实施第 1 步须先核实**：网关内是否可直接取到会话的 `moduleType`（`this.sessions` / loader / `getSession()`）；若取不到，则需在网关内建"sessionId → moduleType"索引（从会话元数据构建，参照 N-64 已补齐的 `flattenSession` 口径：`metadata.moduleType` 优先、`workspaceId` 兜底）。**不得假定，先核实。**
4. **前端 service**（`sessionService.searchMessages`）：签名扩展为 `(q, limit?, opts?: { moduleType?: string })`，透传 `moduleType` 查询参数。
5. **侧栏**（`SessionHistorySidebar` 正文查询 effect）：传入当前作用域模块（`moduleType`）⇒ 后端只回该模块的命中。
6. **全局搜索**（`GlobalSearchModal`）：**不传** `moduleType` ⇒ 保持全局语义（零改动）。

## 4. 风险与对策

| 风险 | 对策 |
|------|------|
| 网关取不到会话 `moduleType` | 实施第 1 步先核实；取不到则建索引（口径与 N-64 的 `flattenSession` 一致，避免再造第二套判定） |
| 扩展签名破坏既有调用点 | 一律**追加可选参数**（`sessionId` / `limit` 位置不变）⇒ `SessionsHistoryTool` 与 `CoreAPIImpl` 无需改动；实施后跑 app `typecheck` + 全量测试 |
| 侧栏作用域判定与后端口径不一致 | 侧栏传入的 `moduleType` 取**已有的 `effectiveModuleType`**（不新造判定）；后端过滤按同一语义（`metadata.moduleType` 优先 + `workspaceId` 兜底） |
| 命中断言不足 | 验证以"**搜 `compaction` 在 chat 侧栏出现结果**"为硬标准（修复前为 0 行），并以"全局搜索仍返回跨模块结果"为反向对照 |
| 50 条上限仍在 | 本轮不解决（Spec §2 已列为非目标）；若出现"本作用域命中 > 50"再立项分页 |

## 5. 验证计划

- **V1（核心）**：在 `/chat` 侧栏搜 `compaction`（修复前 0 行）→ **应出现结果行**，且逐条核对这些行的会话确实属 chat 作用域；与后端带 `moduleType` 的查询结果**条数一致**
- **V2（反向对照）**：`GlobalSearchModal`（全局搜索）搜同一关键词 → **仍返回跨模块结果**（不受 `moduleType` 限制）
- **V3 回归**：§4.3-8 两项增强（正文标记 / 片段预览）仍正常；清空搜索后标记与片段消失；侧栏分组仍为 `default 1` + `未分组 847`
- **V4 静态**：app + client `typecheck` EXIT=0；app `bun test` / client vitest 0 fail
- **V5 边界**：不传 `moduleType` 时行为与修复前**完全一致**（后端与网关的默认分支）

## 6. 回滚

- 删除 `moduleType` 参数的读取与透传（4 处），回到"全局取前 50 条"的现状；侧栏调用点去掉传参即可

## 7. 实施后需同步

- 台账 N-66 状态与验证证据
- `.trae/docs/api-spec.md` 登记 `GET /v1/sessions/messages/search` 的新增查询参数 `moduleType`（§1.6.1 要求接口清单与代码同步）
