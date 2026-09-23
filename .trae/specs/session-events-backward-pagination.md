# Spec：会话事件流向前补页（P1-1）

> 状态：**已实施（2026-09-22）** ｜ 来源：轨迹模块对标 `dev_docs/20260922/trajectory-benchmark/Liri_Trajectory_Deficiency_Report.md` 的 **P1-1**
> 类型：**API 变更**（`GET /v1/sessions/{id}/events` 新增查询参数与响应字段）+ 前端 store/UI 行为变更

## 1. 问题

轨迹面板（`ChatInspector` 轨迹 Tab）只加载**尾部窗口**（`limit=1000, recent=1`），
`loadMore()` 仅向**更新**方向续读（`fromSeq = tailSeq + 1`）⇒ **超过 1000 条的长会话，
更早历史在前端完全不可达**。

后端 `EventLogStorage.read(query)` 早已支持 `fromSeq/toSeq/limit` 区间读取，缺的是：
① 一个语义明确的"取更早一页"入口；② "更早方向还有数据"的信号（对称于 `hasMore`）；
③ 前端的前插与滚动锚定。

对标参照（deepseek-harness）：尾部优先（50 节点/页）+ prepend 滚动锚定 + 真实浏览器几何门禁。

## 2. 决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | API 新增查询参数 **`beforeSeq`**：取 `seq < beforeSeq` 的**紧邻一页**（至多 `limit` 条） | 语义显式（"更早"而非一个通用区间游标）；与既有 `fromSeq`/`recent` 正交，互不破坏 |
| D2 | 响应新增 **`hasEarlier: boolean`** | 与 `hasMore` 对称的驱动信号；前端"加载更早"入口的前置条件 |
| D3 | 实现**不改 `EventLogStorage`**：把 `fromSeq` 预置到 `max(1, beforeSeq - limit)`、`toSeq` 收到 `beforeSeq - 1` | `read()` 语义即"从 `fromSeq` 向后至多 `limit` 条" ⇒ 该窗口恰好命中目标页，**无需新增反向读能力**（最小改动，CS03） |
| D4 | 前端 `loadOlder()` **前插**且**不触碰 `tailSeq`/`liveTailSeq`** | 补页只改变"更早边界"，尾部语义（`loadMore` 续读起点、`setLiveEvents` 的 `liveTailSeq` 守卫）必须保持不变 |
| D5 | 前端按 **seq 去重**后前插；`selectedSeq`/`filter`/`error` 不动 | 与流式追加/并发分页交错安全；补页后用户选择存活 |
| D6 | UI：**顶部哨兵**（`scrollTop <= 80` 自动补页）+ 显式「加载更早」按钮 + **滚动锚定**（补页前记录 `scrollHeight/scrollTop`，落地后按高度差补偿） | 对齐参照的 prepend 锚定；自动+手动双入口 |
| D7 | 不在本轮引入 `hasEarlier` 之外的新状态（不新增"加载更早"分页游标字段） | 游标即 `events[0].seq`，无需冗余状态 |

**不做**：不新增"一次性补齐全部历史"（参照明确否决：会让传输/投影成本前置）；不改变 `/messages` 端点既有的 `?before` 游标语义（两处命名不同为**有意**：messages 的 `before` 是 `lastEventSeq` 消息游标，events 的 `beforeSeq` 是事件 seq 边界）。

## 3. 影响文件

| 文件 | 变更 |
|---|---|
| `app/src/runtime/api/CoreAPIImpl.ts` | `getSessionEvents` 增加 `beforeSeq` 入参、返回 `hasEarlier`；窗口计算（D3）；**顺带修 N-52 同族**：`MessageToEventMigrator(log, sessionId, 'default')` → `resolveWorktreeHash()` |
| `app/src/infrastructure/http/handlers/session-handlers.ts` | `handleGetSessionEvents` 解析/校验 `beforeSeq`（非正或非数 ⇒ 400）并透传 |
| `client/src/services/trajectoryService.ts` | `SessionEventsQuery.beforeSeq`、`SessionEventsResponse.hasEarlier`、参数序列化 |
| `client/src/stores/chat/trajectoryStore.ts` | 新增 `hasEarlier` 状态与 `loadOlder()`；`loadEvents`/`loadMore`/`reset` 同步 `hasEarlier`；`loadEvents` 失败时归零 |
| `client/src/components/ChatInspector/ChatInspector.tsx` | 顶部哨兵 `onScroll`、`handleLoadOlder`（锚定捕获）、补页后 rAF 补偿 `scrollTop`、「加载更早」按钮 |
| `.trae/docs/api-spec.md` | §3 会话行：`/events` 补 `beforeSeq` 与 `hasEarlier` 说明 |

## 4. 验证

| 层 | 用例 | 结果 |
|---|---|---|
| 后端 HTTP 契约 | `app/tests/http/session-events-pagination.test.ts`（**新建 4 例**）：`beforeSeq` 透传 / 响应透传 `hasEarlier` / 非法 ⇒ 400 且不调 CoreAPI / 未传时保持既有语义 | **4 pass** |
| 前端 store | `client/src/stores/chat/__tests__/trajectoryStore.test.ts` **+3 例**：前插顺序正确且 **`tailSeq`/`liveTailSeq` 不被污染** / 去重 + **选择存活** / `hasEarlier=false` 不发请求 | **9 pass**（6 旧 + 3 新） |
| 回归 | `bun test tests/http tests/tools/AgentTool tests/chat tests/session tests/tasks` | **740 pass / 0 fail**（基线 736 + 4） |
| 类型/lint | app `bun run typecheck` + `bunx eslint`；client `tsc --noEmit` + `bunx eslint` | 全部 exit 0 |

**未验证（诚实边界）**：**无浏览器/组件级验证** —— 滚动锚定的实际几何行为（补页后视野是否真停留）
与"顶部哨兵自动加载"的交互，均**仅有代码级与 store 级证据**；参照侧有 e2e 几何门禁，我方本轮未补
（属 P2-4「测试层级单薄」范围）。

**已知语义边界**：`hasEarlier = events[0].seq > 1` 是**基于 seq 的保守判据**。当查询带了
`types` 过滤、且命中集不连续时，可能出现"`hasEarlier=true` 但再补一页为空"的情况
（seq 1..N 无命中类型）——代价仅为**多一次点击/一次空请求**，随后 `hasEarlier` 即转为 false（自限）。
如需精确判据需在存储层支持"更早方向是否存在命中"，本轮不做（避免为边缘场景增加存储复杂度）。

## 5. 合规

| 规则 | 落实 |
|---|---|
| R01 基础设施复用 | 复用 `EventLogStorage.read` 区间能力与 `resolveWorktreeHash()`，**未新建存储/反向读** |
| CS01 归一化 | 未新增分页类型；`hasEarlier` 与既有 `hasMore` 同构 |
| CS03 回退最小化 | 无"以防万一"分支；`loading`/`hasEarlier` 双重守卫即足够 |
| CS04/CS06 | 无 mock 数据；测试断言均基于真实 store/handler 行为 |
| §1.13 路径 | 修复迁移器的 worktreeHash 时统一走 `@modules/core/paths` |
| §1.6.1 接口清单 | `.trae/docs/api-spec.md` §3 已同步 |
